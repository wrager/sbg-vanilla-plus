# Свайп для закрытия попапа (swipeToClosePopup)

Закрывает попап точки `.info` жестом свайпа вверх с живой анимацией: попап едет за пальцем по Y, плавно затухает по мере удаления, при отпускании уплывает наверх и закрывается. Если жест не дотянул до порога - возвращается на место.

## Возможности для игрока

- **Попап едет за пальцем.** Во время свайпа `.info` смещается по вертикали в реальном времени и постепенно становится прозрачным (opacity = 1 - |deltaY| / 250).
- **Animate-out при достаточном свайпе.** Если смещение превысило `DISMISS_THRESHOLD = 100px` или скорость превысила `VELOCITY_THRESHOLD = 0.5 px/ms` (быстрый flick на коротком пути), попап плавно уходит наверх за экран (150мс) и закрывается через клик по `.info .popup-close`.
- **Animate-back при недотянутом свайпе.** Если жест не прошёл порог - попап возвращается в исходное положение тем же 150мс transition'ом.
- **Слайдер ядер исключён.** Свайп внутри `.deploy-slider-wrp` / `.splide` / `#cores-list` модулем игнорируется. Так splide-карусель ядер сохраняет свой жестовый интерфейс.
- **Не конфликтует с горизонтальным свайпом навигации.** Модуль `improvedNextPointSwipe` забирает горизонталь через тот же `core/popupSwipe` dispatcher; вертикаль и горизонталь распознаются по доминирующей оси первого движения.

## Архитектура

### Регистрация в core/popupSwipe

Модуль не управляет touch-listener'ами и анимациями напрямую - этим занят общий `src/core/popupSwipe.ts`. swipeToClosePopup на enable вызывает `registerDirection('up', { canStart, decide, finalize })` и `installPopupSwipe('.info')`. На disable - снимает регистрацию через возвращённый unregister и вызывает `uninstallPopupSwipe()`. Параллельную работу с другими модулями (например, improvedNextPointSwipe регистрирует `'left'`/`'right'`) обеспечивает ref-counter в core: реальный attach listener'ов происходит при первом install, реальный detach - при последнем uninstall.

### Handler

- **canStart(event)** - возвращает false если touch начался внутри `.deploy-slider-wrp` / `.splide` / `#cores-list`. Так carousel ядер сохраняет свой жестовый интерфейс.
- **decide()** - всегда `'dismiss'`. У вертикального свайпа закрытия нет ветки "вернуться" - если порог пройден, попап улетает.
- **finalize()** - после dismiss-анимации симулирует клик по `.info .popup-close`. Игровой обработчик делает корректный cleanup (`popovers`, `info_cooldown`/`score` таймеры, abort `/api/draw` запросов). Fallback - просто скрыть `.info` через класс `hidden`.
- **animationDurationMs = 150** - dismiss/return-анимация вдвое короче дефолта core (300мс). Закрытие попапа должно ощущаться как мгновенный отклик на жест, без ожидания. improvedNextPointSwipe оставляет дефолт 300мс - там анимация длиннее нужна, чтобы попап успел уехать в сторону свайпа и появиться попап следующей точки без визуального мерцания.

### State machine, анимации, observer - в core

Все детали реализации (idle/tracking/swiping/animating, `applySwipeStyles`, `animateDismiss`/`animateReturn` через CSS-transition `svp-swipe-animating`, `requestAnimationFrame`, safety-timer, popup observer на `class` и `data-guid`) живут в `src/core/popupSwipe.ts`. Модуль swipeToClosePopup описывает только своё поведение (canStart, decide, finalize), не дублируя инфраструктуру.

### touch-action

При первом install через core touch-action на `.info` переписывается с inline `pan-y` (его ставит игра) на `none` - обе оси теперь под контролем core/popupSwipe. На полный uninstall (последний refs->0) восстанавливается оригинальное значение. CSS-rule в `styles.css` оставлен для `.deploy-slider-wrp`: `touch-action: manipulation` нужен слайдеру ядер для собственных жестов.

## Файловая структура

| Файл                        | Назначение                                                                                                                     |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `swipeToClosePopup.ts`      | Определение модуля + регистрация direction='up' с canStart-фильтром на cores-slider, decide=dismiss, finalize=клик popup-close |
| `swipeToClosePopup.test.ts` | Тесты isWithinCoresSlider + интеграция с core/popupSwipe (enable/disable, finalize-клик, фильтр слайдера)                      |
| `styles.css`                | CSS-transition под `.svp-swipe-animating` + touch-action: manipulation для слайдера ядер                                       |

## Настройки

Модуль не имеет настроек. Включён по умолчанию.
