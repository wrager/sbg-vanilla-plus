# Подписи на точках (pointTextFix)

Адаптивный размер шрифта для текста подсветки точек, выбранного в Layers > Text. Подпись не вращается вместе с картой. Для канала ключей значение берётся из инвентаря и обновляется сразу.

## Возможности для игрока

- **Адаптивный размер шрифта.** На минимальном зуме 13 - 10px (мелко, не закрывает соседей), на zoom 19+ - 16px (крупно, легко читается). Линейная интерполяция между крайними точками. Нативный 46px рисуется константой и на низких зумах перекрывает сами точки.
- **Подписи всегда горизонтальны.** Native text вращается вместе с холстом точки при повороте карты. Наш overlay рисуется на отдельном слое в системных координатах OL Vector layer, текст не вращается. Дополнительно: на тех редких случаях, когда канал text стоит в нецентральном слоте (slot 0/1) и native всё-таки выпускает text, наша обёртка компенсирует поворот через `save/translate/rotate/translate/restore`.
- **Цвет подписи берётся из темы.** `getTextColor()` / `getBackgroundColor()` из `core/themeColors.ts` - те же CSS custom properties, что использует игра для основного текста и фона. На светлой/тёмной теме подпись остаётся читаемой.
- **References показывает актуальный счётчик из инвентаря.** Вместо нативного значения, которое сервер обновляет только на следующем `requestEntities` (после движения игрока на 30+ метров или 5-минутного таймера), модуль читает количество ключей точки прямо из `inventory-cache` и рисует число. После изучения/переработки/удаления подпись обновляется сразу.
- **Levels/Cores/Guards** - значения читаются из `prop.highlight` точки (тот же массив, что использует native LIGHT renderer), отрисовываются адаптивным шрифтом без поворота вместе с картой.
- **Кольца, секторы, прогресс-бары, не-text каналы Layers > Text** идут нативно. Модуль не подменяет логику отрисовки арок (channels 1-4 = decay-страйпы, channel 9 = team-color), pellets для Cores в slot 0/1, level-арок в slot 0/1 - всё это игра рисует сама.

## Архитектура

### Runtime-обёртка LIGHT-renderer через перехват setStyle

Стили в OL устроены как массив `Style[]`. Игровой `FeatureStyles.LIGHT(...)` (refs/game/script.js около 269) создаёт стиль с custom `renderer` функцией. Эта функция получает `state.context` (CanvasRenderingContext2D) и сама вызывает `ctx.font = 'bold 46px Manrope'`, `ctx.fillText(text, x, y)`, `ctx.strokeText(value, xc, yc)`, `ctx.beginPath/arc/stroke` и т.д.

Модуль:

1. На enable находит OL VectorSource слоя `points`, проходит по всем существующим фичам и подписывается на новые через event `addfeature`.
2. Для каждой фичи перехватывает `feature.setStyle`: новые стили перед установкой проходят через `wrapStyleArray`, который для каждого стиля с `getRenderer/setRenderer` (LIGHT-стиль) ставит обёрнутый renderer вместо нативного.
3. Подписывается на feature event `change`. Игра в `showInfo` (refs/game/script.js около 2789-2796) и attack response мутирует `style[1]` в-место (`style[1] = FeatureStyles.LIGHT(...)`) и вызывает `feature.changed()` без `setStyle`. Без обработки `change` этот новый LIGHT остался бы с нативным renderer, и после открытия/закрытия попапа текст возвращался бы к 46px.
4. После каждого `wrapFeature` явно вызывает `feature.changed()`. `style.setRenderer()` мутирует функцию рендера in-place, но не диспатчит change-event (refs/ol/ol.js около 6842 - присваивание без вызова `changed()`). Layer кеширует execution plan по revision counter feature; без явной инвалидации новый renderer не попадает в plan до внешнего trigger'а.

### Counter-based фильтрация native text

Каждая обёртка LIGHT-renderer'а на момент создания делает `idsAtWrapTime = readMapConfigH()` - снимок поля `h` из `localStorage['map-config']`. Это bitfield из 3 слотов по 8 бит, в каждом 0 (off) или индекс канала 1..7 (refs/game/script.js около 1738). Native LIGHT при создании передаётся точно такой же `h` в closure (refs/game/script.js около 3194), поэтому наш snapshot синхронен с frozen ids в native renderer'е.

`predictTextQueue(ids, highlight)` моделирует логику нативного цикла `for (i=0..2) { ... }` (refs/game/script.js около 301-378) и возвращает упорядоченный массив text-пар, которые native собирается выпустить:

- case 5 (Levels): text только если `is_text` (slot 2). value=0 не пропускается - native рисует "0".
- case 6 (Cores): outer `if (!value) continue` пропускает всю итерацию при value=0 (нет ни pellets, ни text). При is_text - text.
- case 7 (Refs): `if (!value) continue`. Без is_text-проверки (рисует во всех 3 слотах).
- case 8 (Guards): `if (value === -1) continue`. Без is_text-проверки.
- case 1-4, 9: text не выпускают (только арки/кольца).

В Proxy на ctx обёртки на каждом `ctx.fillText`/`ctx.strokeText` ведётся counter `textCallCounter`. Native LIGHT всегда выпускает text парой (`strokeText` сразу после `fillText`, refs/game/script.js около 376-377), порядок пар детерминирован. `pairIdx = Math.floor(textCallCounter / 2)` маппит i-ю пару на её slot/channel в queue. Если `queue[pairIdx].slot === 2` - наш overlay рисует это значение сам, native call пропускаем (`return`). Иначе - pass-through на реальный context с поворот-compensation для slot 0/1 (редкие случаи channel 7/8 в нецентральном слоте).

### Подмена `ctx.font` на адаптивный размер

В Proxy на ctx, set-trap для `font`: подменяет любое `Npx` в строке на `fontSizeForZoom(zoom) * pixelRatio`. Множитель повторяет поведение OL Text style (refs/ol/ol.js около 8841): `textScale = pixelRatio * scale`, далее `ctx.scale(textScale)` перед fillText. Custom renderer вызывается с уже подготовленным контекстом БЕЗ этой scale-трансформации, поэтому без ручного умножения на pixelRatio текст выходил бы в `pixelRatio` раз меньше эквивалентного OL Text. Применяется к редким slot 0/1 native text (через wrap), пока slot 2 пропускается полностью.

### Overlay-слой: рисует значение выбранного канала

Параллельно создаётся свой `ol.layer.Vector` (имя `svp-point-text-fix`, `zIndex: 5`). Source - пустой при enable, заполняется label-feature'ами через `renderLabels()`:

1. Читает `slot2 = (h >> 16) & 0xff` через `readMapConfigH()`.
2. Если slot2 не в {5, 6, 7, 8} - layer пуст, ничего не рисуем.
3. Для slot2 = 7 строит `buildRefCounts()` из `inventory-cache` (агрегация по `t === 3 && l === guid`).
4. Для каждой feature в pointsSource:
   - `computeLabelText(feature, slot2, refCounts)` возвращает строку или null.
   - slot2 = 5: `feature.get('highlight')[5]` (Level), включая 0 (mirror native).
   - slot2 = 6: `feature.get('highlight')[6]`, пропуск 0.
   - slot2 = 7: `refCounts.get(featureId)` из inventory-cache (актуальный).
   - slot2 = 8: `feature.get('highlight')[8]`, пропуск -1.
5. На zoom < `MIN_ZOOM` (13) - не рисуем.

Style label: `ol.style.Text` с font = `${fontSizeForZoom(zoom)}px Manrope`, fill из `getTextColor()`, stroke из `getBackgroundColor()` шириной 3 для читаемости на любом фоне.

### Триггеры ре-рендера overlay

- **`pointsSource.on('change')`** - debounced 100мс. Срабатывает после `requestEntities`/`drawEntities` (новая партия точек после движения игрока). Также фактически срабатывает после смены map-config через Layers > Text picker - игра вызывает `requestEntities()` сразу после save (refs/game/script.js около 1742), что приводит к `points_source.clear()` + ре-добавлению.
- **`view.on('change:resolution')`** - без debounce. Зум поменялся - перерисовываем под новый шрифт.
- **`MutationObserver` на `#self-info__inv`** - текст счётчика инвентаря в шапке. Игра обновляет его при любом изменении инвентаря (изучение, переработка, удаление, атака с дропом). Релевантно когда slot2 = 7 (Refs); для других каналов просто перерисовка по тем же данным.

### WeakSet/WeakMap для отслеживания обёрнутых

- `wrappedFeatures: WeakSet<IOlFeature>` - набор фич, которым уже установлена обёртка.
- `originalSetStyles: WeakMap<IOlFeature, fn>` - оригинальный `feature.setStyle` для восстановления на disable.
- `originalRenderers: WeakMap<WrappedRenderer, RendererFn>` - на каждый обёрнутый renderer запоминается оригинал. Используется в `unwrapFeature`.
- `featureChangeListeners: WeakMap<IOlFeature, fn>` - подписка на `change`-event для каждой фичи.
- `WRAPPED_MARKER` - Symbol на обёрнутой функции, чтобы при повторном проходе (через `change`-event) пропускать уже обёрнутые стили.

### Защита от race-conditions

`installGeneration` counter инкрементируется на каждом enable/disable. enable содержит `await getOlMap()`; если disable отработал во время await, после резолва промиса enable сравнивает свой generation с актуальным и выходит до создания layer и подписок. Тот же паттерн в `popoverCloser` и `nativeGarbageGuard`.

## Файловая структура

| Файл                   | Назначение                                                                                                                                                                                                                    |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pointTextFix.ts`      | Определение модуля + `wrapFeature`/`unwrapFeature`, `wrapStyleArray`, `wrapLightRenderer` с counter-based filter, `predictTextQueue`, `readMapConfigH`, `computeLabelText`, `fontSizeForZoom`, `buildRefCounts`, overlay-слой |
| `pointTextFix.test.ts` | Тесты адаптивного шрифта, обёртки renderer, counter-based фильтра text-вызовов, predictTextQueue по всем каналам, computeLabelText по slot2, render labels с разными slot2, race-disable, idempotency                         |

## Настройки

Модуль не имеет настроек. Включён по умолчанию.
