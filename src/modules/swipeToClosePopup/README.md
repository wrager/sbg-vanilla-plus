# Свайп для закрытия попапа (swipeToClosePopup)

Закрывает попап точки `.info` жестом свайпа вверх с живой анимацией: попап едет за пальцем по Y, плавно затухает по мере удаления, при отпускании уплывает наверх и закрывается. Если жест не дотянул до порога - возвращается на место.

## Возможности для игрока

- **Попап едет за пальцем.** Во время свайпа `.info` смещается по вертикали в реальном времени и постепенно становится прозрачным (opacity = 1 - |deltaY| / 250).
- **Animate-out при достаточном свайпе.** Если смещение превысило `DISMISS_THRESHOLD = 100px` или скорость превысила `VELOCITY_THRESHOLD = 0.5 px/ms` (быстрый flick на коротком пути), попап плавно уходит наверх за экран (300мс) и закрывается через клик по `.info .popup-close`.
- **Animate-back при недотянутом свайпе.** Если жест не прошёл порог - попап возвращается в исходное положение тем же 300мс transition'ом.
- **Слайдер ядер исключён.** Свайп внутри `.deploy-slider-wrp` / `.splide` / `#cores-list` модулем игнорируется. Так splide-карусель ядер сохраняет свой жестовый интерфейс.
- **Не конфликтует с нативным горизонтальным свайпом.** В SBG 0.6.1 на `.info` уже висит Hammer на свайп влево/вправо для перехода к соседним точкам (refs/game/script.js:722-752). Наш TouchEvent-handler работает с теми же touch-events независимо: распознаём вертикаль, отдаём горизонталь.

## Архитектура

### TouchEvent + passive: false

Раньше пробовал PointerEvent - не работает. Pointer events зависят от `touch-action` так же, как touch events: при `touch-action: pan-y` (его ставит нативный Hammer игры) браузер забирает вертикальный жест и шлёт `pointercancel`, не давая распознать свайп. TouchEvent с `passive: false` на `touchmove` + `event.preventDefault()` позволяет ВЗЯТЬ жест у браузера: он не скроллит, события идут до конца жеста без cancel'а.

### Override touch-action

На enable inline `touch-action` у `.info` переписывается на `pan-x`: горизонталь отдаётся нативному Hammer'у игры (свайп между соседними точками), вертикаль забираем себе. Inline-стиль перебивает CSS-rule (специфичность 1000), поэтому override делается через JS, а не только через CSS. На disable оригинальное значение восстанавливается. CSS-rule в `styles.css` (`.info.popup { touch-action: pan-x }`) оставлен как fallback на случай отсутствия inline'а.

### State machine

`idle` -> `tracking` -> `swiping` -> `animating`.

- **idle.** Нет жеста.
- **tracking.** Палец опустили, ждём первого движения за `DIRECTION_THRESHOLD = 10px`. Если жест вертикальный и вверх - `swiping`. Если горизонтальный или вниз - `idle`, отдаём другим обработчикам (нативный horizontal-Hammer работает с теми же touch-events).
- **swiping.** На каждом `touchmove` `event.preventDefault()` (берём жест у браузера) + `applySwipeStyles(deltaY)` рендерит translate Y и opacity. На `touchend` решаем: `animateDismiss` или `animateReturn`.
- **animating.** Пока CSS-transition отрабатывает; новые жесты не принимаем (см. `state !== 'idle'` в `onTouchStart`).

### Распознавание свайпа

На `touchend`:

```
if (currentDeltaY < 0 && (-currentDeltaY > DISMISS_THRESHOLD || velocity > VELOCITY_THRESHOLD))
```

Закрываем, если: направление вверх (`deltaY < 0`) И (смещение вверх больше 100px ИЛИ скорость больше 0.5 px/ms). Velocity вычисляется как `|deltaY| / elapsedMs` и срабатывает на быстрых flick-жестах с малым смещением.

### Animate-out / animate-back через CSS-transition

Класс `.svp-swipe-animating` включает CSS-transition'ы `translate 0.3s ease-out, opacity 0.3s ease-out`. Без этого класса (во время touchmove) transition выключен - попап мгновенно за пальцем. С классом - стиль меняется плавно за `ANIMATION_DURATION = 300ms`.

`requestAnimationFrame` отделяет добавление класса от смены translate: браузер успевает зафиксировать стартовый стиль, transition отрабатывает от текущей позиции до целевой. Без rAF transition мог бы пропуститься (браузер мерджит изменения в один tick).

`animateDismiss` ставит translate до `-window.innerHeight` и opacity 0, после `transitionend` (или таймаута safety) симулирует клик по `.info .popup-close` - игровой обработчик делает корректный cleanup (`popovers`, `info_cooldown`/`score` таймеры, abort `/api/draw` запросов).

`animateReturn` сбрасывает translate в 0 и opacity в 1, после transitionend убирает класс. Стилей не остаётся.

### Safety-таймер

`setTimeout(ANIMATION_DURATION + 50ms)` страхует случаи, когда `transitionend` не пришёл (вкладка ушла в фон, prefers-reduced-motion, redraw-сбой). Если таймер сработал раньше события - всё равно завершает анимацию и закрывает попап.

### Исключение слайдера ядер

В `onTouchStart` `event.target.closest('.deploy-slider-wrp, .splide, #cores-list')` - если совпало, в `tracking` не переходим. Та же стратегия, что нативный horizontal-Hammer применяет (refs/game/script.js:732-737).

### MutationObserver на `.info`

Реагирует на:

- `class`-атрибут с `attributeOldValue: true`: ловит переход hidden -> не-hidden (открытие новой точки). Если попап открылся с остатками от незавершённого жеста (translate/opacity не очищены) - чистим, чтобы попап не появился со смещением.
- `data-guid`: смена точки без полного закрытия (свайп между соседними точками) - тоже чистим стили.

### Защита от race-conditions

`installGeneration` инкрементируется на каждом enable/disable. `waitForElement('.info').then(...)` сравнивает свой generation с актуальным: если между ожиданием и резолвом случился disable, install пропускается и listener'ы не вешаются.

## Файловая структура

| Файл                        | Назначение                                                                                                                                   |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `swipeToClosePopup.ts`      | Определение модуля + state machine, touch-handler'ы, applySwipeStyles, animateDismiss/animateReturn, MutationObserver, override touch-action |
| `swipeToClosePopup.test.ts` | Тесты thresholds, исключения слайдера, touch-flow, animate-states, safety-таймер, enable/disable, override touch-action                      |
| `styles.css`                | CSS: touch-action на `.info` и `.deploy-slider-wrp`, transition'ы под `.svp-swipe-animating`                                                 |

## Настройки

Модуль не имеет настроек. Включён по умолчанию.
