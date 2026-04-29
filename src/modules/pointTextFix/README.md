# Подписи на точках (pointTextFix)

Адаптивный размер шрифта (10-16 пикселей) для текста подсветки точек в Layers > Text: читаемо на любом зуме, не вращается вместе с картой. Работает для всех каналов (Levels, Deployment, Guards). Для канала References количество ключей берётся напрямую из инвентаря и рисуется на отдельном overlay-слое, поэтому подпись обновляется сразу после изучения/переработки точки, без ожидания следующего перезапроса карты.

## Возможности для игрока

- **Адаптивный размер шрифта.** На минимальном зуме 13 - 10px (мелко, не закрывает соседей), на zoom 19+ - 16px (крупно, легко читается). Линейная интерполяция между крайними точками. Нативный 46px рисуется константой и на низких зумах перекрывает сами точки.
- **Подписи всегда горизонтальны.** Когда игрок поворачивает карту жестом одного пальца, нативный текст вращается вместе с холстом точки и становится нечитаемым. Наша обёртка компенсирует поворот через `save/translate/rotate/translate/restore` - текст остаётся горизонтальным, окружающие элементы (кольца, сектора, прогресс-бары) поворачиваются как обычно.
- **Цвет, кольца, бары, не-refs тексты - нативные.** Модуль не подменяет логику отрисовки канала, только корректирует размер и поворот. Все остальные visual-cue (цвет команды, прогресс заряда, числа Levels/Deployment/Guards) рисуются игрой как раньше.
- **References показывает актуальный счётчик из инвентаря.** Вместо нативного значения, которое сервер обновляет только на следующем `requestEntities` (после движения игрока на 30+ метров или 5-минутного таймера), модуль читает количество ключей точки прямо из `inventory-cache` и рисует число на собственном overlay-слое. После изучения/переработки/удаления подпись обновляется сразу.

## Архитектура

### Runtime-обёртка LIGHT-renderer через перехват setStyle

Стили в OL устроены как массив `Style[]`. Игровой `FeatureStyles.LIGHT(...)` (refs/game/script.js около 269) создаёт стиль с custom `renderer` функцией. Эта функция получает `state.context` (CanvasRenderingContext2D) и сама вызывает `ctx.font = 'bold 46px Manrope'`, `ctx.fillText(text, x, y)`, `ctx.strokeText(value, xc, yc)`, `ctx.beginPath/arc/stroke` и т.д.

Модуль:

1. На enable находит OL VectorSource слоя `points`, проходит по всем существующим фичам и подписывается на новые через event `addfeature`.
2. Для каждой фичи перехватывает `feature.setStyle`: новые стили перед установкой проходят через `wrapStyleArray`, который для каждого стиля с `getRenderer/setRenderer` (LIGHT-стиль) ставит обёрнутый renderer вместо нативного.
3. Подписывается на feature event `change`. Игра в `showInfo` (refs/game/script.js около 2789-2796) и attack response мутирует `style[1]` в-место (`style[1] = FeatureStyles.LIGHT(...)`) и вызывает `feature.changed()` без `setStyle`. Без обработки `change` этот новый LIGHT остался бы с нативным renderer, и после открытия/закрытия попапа текст возвращался бы к 46px.
4. После каждого `wrapFeature` явно вызывает `feature.changed()`. `style.setRenderer()` мутирует функцию рендера in-place, но не диспатчит change-event (refs/ol/ol.js около 6842 - присваивание без вызова `changed()`). Layer кеширует execution plan по revision counter feature; без явной инвалидации новый renderer не попадает в plan до внешнего trigger'а (move, zoom). Это и есть причина "после enable не применяется до ререндера" - оба сценария оборачивают renderer без своего changed().

### Подавление нативного канала References через highlight[7] backup/restore

Native LIGHT-renderer в каждом слоте читает значение канала из массива `prop.highlight` по индексу id и вызывает `if (typeof value === 'undefined') continue` (refs/game/script.js около 304). Модуль перед вызовом original renderer-а:

1. Читает `feature.get('highlight')`.
2. Если это array - сохраняет `highlight[7]` в локальную переменную и заменяет на `undefined` (синхронно с вызовом, в closure обёртки).
3. Вызывает original renderer'а - case 7 в native LIGHT для всех 3 слотов получает `undefined` и пропускается. Native текст References не рисуется.
4. После original (включая throw) восстанавливает оригинальное значение через `try { ... } finally { ... }`. Другие места игры, читающие `prop.highlight` (showInfo, attack response, drawEntities при следующем `requestEntities`), видят правильное значение.

Это синхронное подавление: на первом же кадре после enable нативный refs пропадает.

### Overlay-слой для refs из inventory-cache

Параллельно создаётся свой `ol.layer.Vector` (имя `svp-point-text-fix`, `zIndex: 5`). Source - пустой при enable, заполняется label-feature'ами через `renderLabels()`:

1. Считаем `buildRefCounts()` - количество ключей по точке: `inventory-cache` ключи (`t === 3`), агрегация по `l` (guid точки), сумма `a`.
2. Для каждой feature в `pointsSource` с положительным count создаём label-feature с `Point`-геометрией в координатах исходной точки и `Style` с `Text` (адаптивный размер `fontSizeForZoom(zoom)`, fill из `getTextColor()`, stroke из `getBackgroundColor()` для читаемости на любом фоне).
3. На zoom < `MIN_ZOOM` (13) - не рисуем, чтобы не загромождать карту.

Триггеры ре-рендера:

- **`pointsSource.on('change')`** - debounced 100мс. Срабатывает после `requestEntities` / `drawEntities` (новая партия точек подгружена при движении игрока).
- **`view.on('change:resolution')`** - без debounce. Зум изменился, нужно перерисовать с новым размером шрифта.
- **`MutationObserver` на `#self-info__inv`** - текст счётчика инвентаря в шапке. Игра обновляет его при любом изменении инвентаря (изучение, переработка, удаление, атака с дропом). Дешевле и точнее, чем слушать `localStorage` события.

### WeakSet/WeakMap для отслеживания обёрнутых

- `wrappedFeatures: WeakSet<IOlFeature>` - набор фич, которым уже установлена обёртка. Повторный `wrapFeature` на ту же фичу - no-op.
- `originalSetStyles: WeakMap<IOlFeature, fn>` - оригинальный `feature.setStyle` для восстановления на disable.
- `originalRenderers: WeakMap<WrappedRenderer, RendererFn>` - на каждый обёрнутый renderer запоминается оригинал. Используется в `unwrapFeature` для возврата к нативному рендеру.
- `featureChangeListeners: WeakMap<IOlFeature, fn>` - подписка на `change`-event для каждой фичи; на disable отписываемся.
- `WRAPPED_MARKER` - Symbol на обёрнутой функции, чтобы при повторном проходе (через `change`-event) пропускать уже обёрнутые стили без двойной обёртки.

### Защита от race-conditions

`installGeneration` counter инкрементируется на каждом enable/disable. enable содержит `await getOlMap()`; если disable отработал во время await, после резолва промиса enable сравнивает свой generation с актуальным и выходит до подписки на `addfeature`/добавления layer'а. Без этого подписки/layer оставались бы вечно. Тот же паттерн в `popoverCloser` и `nativeGarbageGuard`.

## Файловая структура

| Файл                   | Назначение                                                                                                                                                                                 |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pointTextFix.ts`      | Определение модуля + `wrapFeature`/`unwrapFeature`, `wrapStyleArray`, `wrapLightRenderer` с backup/restore highlight[7], `fontSizeForZoom`, overlay-слой и `buildRefCounts`                |
| `pointTextFix.test.ts` | Тесты адаптивного шрифта, обёртки renderer, реакции на `change`-event, race-disable, idempotency, инвалидации render plan через feature.changed, backup/restore highlight[7], overlay-слоя |

## Настройки

Модуль не имеет настроек. Включён по умолчанию.
