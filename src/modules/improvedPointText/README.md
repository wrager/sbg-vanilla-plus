# Улучшенный текст на точках (improvedPointText)

Адаптивный размер шрифта для текста подсветки точек, выбранного в Layers > Text. Подпись не вращается вместе с картой.

## Возможности для игрока

- **Адаптивный размер шрифта.** На минимальном зуме 13 - 10px (мелко, не закрывает соседей), на zoom 18+ - 16px (крупно, легко читается). Линейная интерполяция между крайними точками. Нативный 32px рисуется константой и на низких зумах перекрывает сами точки.
- **Подписи всегда горизонтальны.** Когда игрок поворачивает карту жестом одного пальца, нативный текст вращается вместе с холстом точки и становится нечитаемым. Наша обёртка компенсирует поворот через `save/translate/rotate/translate/restore` - текст остаётся горизонтальным, окружающие элементы (кольца, сектора, прогресс-бары) поворачиваются как обычно.
- **Цвет, кольца, бары - нативные.** Модуль не подменяет логику отрисовки канала, только корректирует размер и поворот текста. Все остальные visual-cue (цвет команды, прогресс заряда и т.п.) рисуются игрой как раньше.

Обновление счётчика ключей на подписи точки сразу после discover, cleanup или удаления через refsOnMap - в отдельном модуле `refsCounterSync` (категория багфиксов) через core-утилиту `core/refsHighlightSync`. Независимо от `improvedPointText`: когда оба активны, наш wrap читает обновлённое значение из того же `prop.highlight` контейнера, который мутирует утилита.

## Архитектура

### Runtime-обёртка LIGHT-renderer через перехват setStyle

Стили в OL устроены как массив `Style[]`. Игровой `FeatureStyles.LIGHT(...)` (refs/game-beta/script.js около 570) создаёт стиль с custom `renderer` функцией. Эта функция получает `state.context` (CanvasRenderingContext2D) и сама вызывает `ctx.font = '32px Manrope'`, `ctx.fillText(text, x, y)` и т.д.

Модуль:

1. На enable находит OL VectorSource слоя `points`, проходит по всем существующим фичам и подписывается на новые через event `addfeature`.
2. Для каждой фичи перехватывает `feature.setStyle`: новые стили перед установкой проходят через `wrapStyleArray`, который для каждого стиля с `getRenderer/setRenderer` (LIGHT-стиль) ставит обёрнутый renderer вместо нативного.
3. Подписывается на feature event `change`. Игра в `showInfo` (refs/game-beta/script.js:2789-2796) и attack response мутирует `style[1]` в-место (`style[1] = FeatureStyles.LIGHT(...)`) и вызывает `feature.changed()` без `setStyle`. Без обработки `change` этот новый LIGHT остаётся с нативным renderer, и текст после открытия/закрытия попапа возвращается к 32px.
4. После каждого `wrapFeature` явно вызывает `feature.changed()`. `style.setRenderer()` мутирует функцию рендера in-place, но не диспатчит change-event (refs/ol/ol.js:6842 - присваивание без вызова `changed()`). Layer кеширует execution plan по revision counter feature; без явной инвалидации новый renderer не попадает в plan до внешнего trigger'а (move, zoom). Это и есть причина «после enable не применяется до ререндера» и «при движении не отрисовывается текст» - оба сценария оборачивают renderer без своего changed().
5. Симметрично, `unwrapFeature` после восстановления оригинального renderer тоже вызывает `feature.changed()`. Без этого после disable модуля layer execution plan продолжал бы использовать кэшированный wrapped renderer до следующего внешнего trigger-а (move, zoom, server update) - пользователь видел бы наш адаптивный шрифт ещё какое-то время после выключения. С явным `changed()` нативный 32px-текст возвращается на следующем render-frame.

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

| Файл                        | Назначение                                                                                                                                        |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `improvedPointText.ts`      | Определение модуля + `wrapFeature`/`unwrapFeature`, `wrapStyleArray`, `wrapLightRenderer`, `fontSizeForZoom`                                      |
| `improvedPointText.test.ts` | Тесты адаптивного шрифта, обёртки renderer'a, реакции на `change`-event, race-disable, idempotency, инвалидации render plan через feature.changed |

## Настройки

Модуль не имеет настроек. Включён по умолчанию.
