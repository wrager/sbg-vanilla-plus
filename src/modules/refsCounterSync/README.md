# Синхронизация счётчика ключей на карте (refsCounterSync)

Обновляет счётчик ключей на подписи точки на карте сразу после изучения. Нативно игра обновляет счётчик в инвентаре и в попапе, но `prop.highlight` на feature остаётся stale до следующего перезапроса карты.

## Симптом

Игрок проводит discover на точке. В попапе строка `Ключи: N+gain` обновляется сразу. На карте подпись References (если включён канал `Layers > Text > References`) показывает старое `N` до тех пор, пока:

- игрок не сдвинется более чем на ~30 м (триггер `requestEntities`),
- или не сработает 5-минутный таймер обновления карты,
- или не произойдёт другое событие, перерисовывающее features (атака, deploy и т. п.).

Симптом проявляется и для нативного 32px-текста (когда `improvedPointText` выключен), и для нашего адаптивного текста (когда включён) - оба читают `feature.get('highlight')['7']` через closure нативного `FeatureStyles.LIGHT` renderer-а.

## Корневая причина

Обработчик discover в `refs/game/script.js:792-844`:

1. Делает POST `/api/discover` с body `{position, guid, wish}`.
2. На успехе обновляет `localStorage['inventory-cache']`, прибавляя дроп.
3. Обновляет `#i-ref` в попапе из свежего `inventory-cache`.
4. **НЕ** трогает `prop.highlight` на feature и **НЕ** вызывает `feature.changed()`.

`FeatureStyles.LIGHT` (refs/game/script.js:269) держит closure над контейнером `prop.highlight = e.h`, пришедшим в момент `drawEntities`. На каждом render-frame renderer читает `values[7]` (для канала References) - значение остаётся прежним до пересоздания feature.

В SBG 0.6.1+ `e.h` имеет форму sparse object (`{"4":false,"7":N}`), а не массива; доступ через числовой ключ работает одинаково для обоих контейнеров.

## Как фиксим

### Перехват /api/discover

Модуль ставит monkey-patch на `window.fetch` при первом enable. Перехватчик пропускает все запросы, кроме `/api/discover`. Для них извлекает `guid` целевой точки из request body и через `DETECTION_DELAY_MS` (100мс) запускает синхронизацию счётчика этой точки.

### Синхронизация через core-утилиту

Сама логика обновления вынесена в `core/refsHighlightSync.ts`. Утилита `syncRefsCountForPoints([targetGuid])`:

1. Читает свежий `inventory-cache` (источник истины - количество ключей в инвентаре).
2. Находит feature по `getFeatureById(targetGuid)` в `points`-layer.
3. Если `highlight['7']` уже совпадает с amount из кэша - silent skip.
4. Иначе - in-place мутация `highlight['7']` через `Reflect.set` + `feature.changed()`.

Этот же механизм используется при удалении ключей через `inventoryCleanup` (fast и slow) и через `refsOnMap` viewer - один источник истины для всех путей изменения количества ключей.

### Задержка 100мс

Игра в continuation после `await fetch('/api/discover')` обновляет `localStorage['inventory-cache']` (refs/game/script.js:817). Sync читает кэш как источник истины - нужно дать игре успеть его обновить. 100мс - достаточно для синхронных DOM-операций continuation и при этом ниже порога перцептивной задержки.

### Forward-compat встроен

Когда разработчик игры исправит баг и сама обновит `prop.highlight['7']` после discover, к моменту тика sync увидит, что значение в feature уже совпадает с amount в кэше, и пропустит мутацию. Никакого двойного gain не возникнет - модуль автоматически становится no-op.

## Совместимость с improvedPointText

Модули ортогональны:

- `improvedPointText` ON + `refsCounterSync` ON: наш адаптивный текст обновляется после discover.
- `improvedPointText` OFF + `refsCounterSync` ON: нативный 32px-текст обновляется после discover.
- `improvedPointText` ON + `refsCounterSync` OFF: наш адаптивный текст НЕ обновляется (исходный баг игры).
- `improvedPointText` OFF + `refsCounterSync` OFF: нативный 32px-текст НЕ обновляется (исходный баг игры).

## Защита от race-condition

`discoverHookEnabled` проверяется перед обработкой response и перед `setTimeout`-callback применения sync. Disable между перехватом и тиком таймера приведёт к пропуску sync - как и должно быть.

`pointsSource` находится lazy в `core/refsHighlightSync.ts` через `getOlMap()`; первый sync ждёт промис, последующие синхронны.

## Файловая структура

| Файл                      | Назначение                                                                                                                                |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `refsCounterSync.ts`      | Определение модуля + `installDiscoverFetchHook` + извлечение `guid` из request body. Sync делегируется в `core/refsHighlightSync`         |
| `refsCounterSync.test.ts` | Тесты hook-перехвата `/api/discover`, lazy install fetch-патча, disable между response и тиком, фильтрация не-discover URL и не-200 ответ |

## Настройки

Модуль не имеет настроек. Включён по умолчанию.
