# Улучшенный текст на точках (improvedPointText)

Адаптивный размер шрифта для текста подсветки точек, выбранного в Layers > Text. Подпись не вращается вместе с картой. Для канала ключей значение обновляется сразу после изучения точки.

## Возможности для игрока

- **Адаптивный размер шрифта.** На минимальном зуме 13 - 10px (мелко, не закрывает соседей), на zoom 18+ - 16px (крупно, легко читается). Линейная интерполяция между крайними точками. Нативный 32px рисуется константой и на низких зумах перекрывает сами точки.
- **Подписи всегда горизонтальны.** Когда игрок поворачивает карту жестом одного пальца, нативный текст вращается вместе с холстом точки и становится нечитаемым. Наша обёртка компенсирует поворот через `save/translate/rotate/translate/restore` - текст остаётся горизонтальным, окружающие элементы (кольца, сектора, прогресс-бары) поворачиваются как обычно.
- **Цвет, кольца, бары - нативные.** Модуль не подменяет логику отрисовки канала, только корректирует размер и поворот текста. Все остальные visual-cue (цвет команды, прогресс заряда и т.п.) рисуются игрой как раньше.
- **Счётчик References обновляется сразу.** После discover игра не пересчитывает значение канала refs на feature, и подпись на слое Text -> References остаётся stale до следующего drawEntities (move >30 м или 5-минутный таймер). Модуль перехватывает ответ /api/discover, считает количество дропнутых ключей точки и in-place увеличивает значение в highlight-массиве; LIGHT-стиль закрыт closure'ом над тем же массивом, поэтому ререндер показывает свежее число.

## Архитектура

### Runtime-обёртка LIGHT-renderer через перехват setStyle

Стили в OL устроены как массив `Style[]`. Игровой `FeatureStyles.LIGHT(...)` (refs/game-beta/script.js около 570) создаёт стиль с custom `renderer` функцией. Эта функция получает `state.context` (CanvasRenderingContext2D) и сама вызывает `ctx.font = '32px Manrope'`, `ctx.fillText(text, x, y)` и т.д.

Модуль:

1. На enable находит OL VectorSource слоя `points`, проходит по всем существующим фичам и подписывается на новые через event `addfeature`.
2. Для каждой фичи перехватывает `feature.setStyle`: новые стили перед установкой проходят через `wrapStyleArray`, который для каждого стиля с `getRenderer/setRenderer` (LIGHT-стиль) ставит обёрнутый renderer вместо нативного.
3. Подписывается на feature event `change`. Игра в `showInfo` (refs/game-beta/script.js:2789-2796) и attack response мутирует `style[1]` в-место (`style[1] = FeatureStyles.LIGHT(...)`) и вызывает `feature.changed()` без `setStyle`. Без обработки `change` этот новый LIGHT остаётся с нативным renderer, и текст после открытия/закрытия попапа возвращается к 32px.
4. После каждого `wrapFeature` явно вызывает `feature.changed()`. `style.setRenderer()` мутирует функцию рендера in-place, но не диспатчит change-event (refs/ol/ol.js:6842 - присваивание без вызова `changed()`). Layer кеширует execution plan по revision counter feature; без явной инвалидации новый renderer не попадает в plan до внешнего trigger'а (move, zoom). Это и есть причина «после enable не применяется до ререндера» и «при движении не отрисовывается текст» - оба сценария оборачивают renderer без своего changed().

### Перехват /api/discover для актуализации канала references

Игра при successful discover увеличивает `inventory-cache[i].a` для соответствующих ref-стопок и обновляет `#i-ref` в попапе, но НЕ трогает `prop.highlight` на feature и не пересоздаёт LIGHT-стиль. Канал refs (id=7 в FeatureStyles.LIGHT, refs/game/script.js:374-377) рисует `values[7]` из closure массива - это значение остаётся прежним до следующего `drawEntities`.

Модуль ставит monkey-patch на `window.fetch` при первом `enable` (один раз за жизнь страницы; повторные `installDiscoverFetchHook` no-op). Lazy install: пользователь с отключённым модулем не получает глобальный side-effect на свои запросы. Перехватчик пропускает все запросы, кроме `/api/discover`; для них:

1. Извлекает guid целевой точки из request body (`{position, guid, wish}`).
2. Клонирует Response и парсит JSON параллельно с игрой (не блокируя её обработку).
3. Считает прирост ключей: суммирует `a` элементов loot с `t === 3 && l === guid`. Тот же предикат, что игра использует на refs/game/script.js:816.
4. Находит feature через `pointsSource.getFeatureById(guid)` и in-place увеличивает `feature.get('highlight')[7]` на gain. LIGHT-стиль closure читает этот же массив, поэтому следующий рендер уже показывает актуальное число.
5. Вызывает `feature.changed()` для инвалидации execution plan.

Перехват активен только пока модуль enabled - флаг `discoverHookEnabled` ставится в `enable()`, снимается в `disable()`. Сам fetch-патч после первого install остаётся вечным (как `installGameVersionCapture`), но при `discoverHookEnabled = false` запрос проходит насквозь без обработки.

### Обёртка через Proxy на canvas-context

Обёрнутый renderer вызывает оригинал, передавая ему Proxy вокруг `state.context`:

- При установке `ctx.font` подменяет любое выражение `Npx` на `<adaptive>px`. Адаптивный размер: `clamp(10, zoom - 3, 16)`, умноженный на `state.pixelRatio`. Множитель повторяет поведение OL Text style (refs/ol/ol.js:8841: `textScale = pixelRatio * scale`); без него на retina-устройстве текст выходит в `pixelRatio` раз меньше эквивалентного OL Text.
- При вызове `ctx.fillText` / `ctx.strokeText` оборачивает их в `save -> translate(x, y) -> rotate(-state.rotation) -> translate(-x, -y) -> orig -> restore`. Компенсирует поворот канваса OL под map rotation. При `rotation = 0` - прямой pass-through без save/restore.
- Все прочие методы и поля (fillStyle, strokeStyle, beginPath, arc, stroke и т.д.) - проброс на реальный context. Методы привязываются через `bind`, чтобы CanvasRenderingContext2D работал на своём `this`.

### WeakSet/WeakMap для отслеживания обёрнутых

- `wrappedFeatures: WeakSet<IOlFeature>` - набор фич, которым уже установлена обёртка. Повторный `wrapFeature` на ту же фичу - no-op.
- `originalSetStyles: WeakMap<IOlFeature, fn>` - оригинальный `feature.setStyle` для восстановления на disable.
- `originalRenderers: WeakMap<WrappedRenderer, RendererFn>` - на каждый обёрнутый renderer запоминается оригинал. Используется в `unwrapFeature` для возврата к нативному рендеру.
- `featureChangeListeners: WeakMap<IOlFeature, fn>` - подписка на `change`-event для каждой фичи; на disable отписываемся.
- `WRAPPED_MARKER` - Symbol на обёрнутой функции, чтобы при повторном проходе (через `change`-event) пропускать уже обёрнутые стили без двойной обёртки.

### Защита от race-conditions

`installGeneration` counter инкрементируется на каждом enable/disable. enable содержит `await getOlMap()`; если disable отработал во время await, после резолва промиса enable сравнивает свой generation с актуальным и выходит до записи `map` / `pointsSource` и подписки на `addfeature`. Без этого подписка осталась бы вечно (disable уже отработал и не увидел её). Тот же паттерн в `popoverCloser` и `nativeGarbageGuard`.

## Файловая структура

| Файл                        | Назначение                                                                                                                                                                                  |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `improvedPointText.ts`      | Определение модуля + `wrapFeature`/`unwrapFeature`, `wrapStyleArray`, `wrapLightRenderer`, `fontSizeForZoom`; перехват /api/discover (`installDiscoverFetchHook`, `applyRefsGainToFeature`) |
| `improvedPointText.test.ts` | Тесты адаптивного шрифта, обёртки renderer'a, реакции на `change`-event, race-disable, idempotency, инвалидации render plan через feature.changed, обновления refs-канала после discover    |

## Настройки

Модуль не имеет настроек. Включён по умолчанию.
