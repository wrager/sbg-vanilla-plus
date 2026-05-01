# Синхронизация счётчика ключей на карте (refsCounterSync)

Обновляет счётчик ключей на подписи точки на карте после изменений инвентаря: изучение точки, автоочистка инвентаря (быстрая и медленная), массовое удаление через «Ключи на карте». Игра нативно меняет инвентарь, но не трогает значение на feature, и подпись на карте остаётся stale до следующего перезапроса карты.

## Симптом

Игрок выполняет любое из действий, меняющих количество ключей точки:

- discover — приходят новые ключи;
- автоочистка inventoryCleanup в режиме fast при переполнении инвентаря — ключи удаляются;
- ручная очистка inventoryCleanup в режиме slow по кнопке «Очистить ключи» — ключи удаляются;
- массовое удаление через viewer модуля refsOnMap — ключи удаляются.

Счётчик в инвентаре, в попапе точки и в кэше обновляется. На карте подпись References (если включён канал `Layers > Text > References`) показывает старое значение до следующего `requestEntities`: движение >30 м, 5-минутный таймер или другое событие, перерисовывающее features (атака, deploy и т. п.).

Симптом проявляется и для нативного 32px-текста (когда `improvedPointText` выключен), и для нашего адаптивного текста (когда включён) — оба читают `feature.get('highlight')['7']` через closure нативного `FeatureStyles.LIGHT` renderer-а.

## Корневая причина

`prop.highlight` на feature ставится игрой только в `drawEntities` (refs/game/script.js:3199) при первичной загрузке точки. Никакой код игры — ни discover, ни любые другие пути изменения инвентаря — этот объект на feature не обновляет и `feature.changed()` для подписи не вызывает.

`FeatureStyles.LIGHT` renderer (refs/game/script.js:269) держит closure над тем же контейнером `prop.highlight`. На каждом render-frame читает `values[7]` (для канала References) — значение остаётся прежним до пересоздания feature через следующий `drawEntities`.

В SBG 0.6.1+ `prop.highlight` имеет форму sparse object (`{"4":false,"7":N}`), а не массива; доступ через числовой ключ работает одинаково для обоих контейнеров.

## Как фиксим

### Owner-тумблер для всей синхронизации

Модуль — единая точка контроля для всех путей синхронизации. Когда модуль выключен пользователем, sync silent-no-op для любого источника. Не нужно отдельных тумблеров на каждом пути.

Сам перехват /api/discover (см. ниже) живёт в этом модуле. Остальные пути (cleanup-fast, cleanup-slow, refsOnMap-delete) вызывают core-утилиту синхронизации напрямую из своих модулей; утилита проверяет `isModuleEnabledByUser('refsCounterSync')` и пропускает работу, если owner выключен.

### Перехват /api/discover

Модуль ставит monkey-patch на `window.fetch` при первом enable. Перехватчик пропускает все запросы, кроме `/api/discover`. Для них извлекает `guid` целевой точки из request body и через `DETECTION_DELAY_MS` (100мс) запускает синхронизацию счётчика этой точки.

### Синхронизация через core-утилиту

Сама логика обновления вынесена в `core/refsHighlightSync.ts`. Утилита `syncRefsCountForPoints(pointGuids)`:

1. Проверяет `isModuleEnabledByUser('refsCounterSync')` — если выключен, silent return.
2. Читает свежий `inventory-cache` (источник истины — количество ключей в инвентаре).
3. Для каждой точки находит feature по `getFeatureById(guid)` в `points`-layer.
4. Если `highlight['7']` уже совпадает с amount из кэша — silent skip.
5. Иначе — in-place мутация `highlight['7']` через `Reflect.set` + `feature.changed()`.

Этот же механизм используется при удалении ключей через `inventoryCleanup` (fast и slow) и через `refsOnMap` viewer — один источник истины для всех путей изменения количества ключей.

### Задержка 100мс на discover

Игра в continuation после `await fetch('/api/discover')` обновляет `localStorage['inventory-cache']` (refs/game/script.js:817). Sync читает кэш как источник истины — нужно дать игре успеть его обновить. 100мс — достаточно для синхронных DOM-операций continuation и при этом ниже порога перцептивной задержки.

Для путей удаления (cleanup, refsOnMap) задержка не нужна: наш код сам обновляет кэш через `updateInventoryCache(deletions)` синхронно после успешного `await deleteInventoryItems`, и затем сразу вызывает sync.

### Forward-compat встроен

Когда разработчик игры исправит баг и сама обновит `prop.highlight['7']` после discover, к моменту тика sync увидит, что значение в feature уже совпадает с amount в кэше, и пропустит мутацию. Никакого двойного gain не возникнет — модуль автоматически становится no-op.

## Совместимость с improvedPointText

Модули ортогональны:

- `improvedPointText` ON + `refsCounterSync` ON: наш адаптивный текст обновляется после любого изменения инвентаря.
- `improvedPointText` OFF + `refsCounterSync` ON: нативный 32px-текст обновляется после любого изменения инвентаря.
- `improvedPointText` ON/OFF + `refsCounterSync` OFF: текст НЕ обновляется (исходный баг игры) — ни наш wrap, ни нативный renderer не получают инвалидации.

## Защита от race-condition

`discoverHookEnabled` проверяется перед обработкой response и перед `setTimeout`-callback применения sync. Disable между перехватом и тиком таймера приведёт к пропуску sync — как и должно быть.

`pointsSource` находится lazy в `core/refsHighlightSync.ts` через `getOlMap()`; первый sync ждёт промис, последующие синхронны.

## Файловая структура

| Файл                      | Назначение                                                                                                                                |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `refsCounterSync.ts`      | Определение модуля + `installDiscoverFetchHook` + извлечение `guid` из request body. Sync делегируется в `core/refsHighlightSync`         |
| `refsCounterSync.test.ts` | Тесты hook-перехвата `/api/discover`, lazy install fetch-патча, disable между response и тиком, фильтрация не-discover URL и не-200 ответ |

## Настройки

Модуль не имеет настроек. Включён по умолчанию.
