# Фикс обновления счётчика ключей после изучения (fixRedrawRefsOnDiscover)

Обновляет счётчик ключей на подписи точки на карте сразу после изучения. Нативно игра обновляет счётчик в инвентаре и в попапе, но `prop.highlight` на feature остаётся stale до следующего перезапроса карты.

## Симптом

Игрок проводит discover на точке. В попапе строка `Ключи: N+gain` обновляется сразу. На карте подпись References (если включён канал `Layers > Text > References`) показывает старое `N` до тех пор, пока:

- игрок не сдвинется более чем на ~30 м (триггер `requestEntities`),
- или не сработает 5-минутный таймер обновления карты,
- или не произойдёт другое событие, перерисовывающее features (атака, deploy и т. п.).

Симптом проявляется и для нативного 32px-текста (когда `improvedPointText` выключен), и для нашего адаптивного текста (когда включён) - оба читают `feature.get('highlight')[7]` через closure нативного `FeatureStyles.LIGHT` renderer-а.

## Корневая причина

Обработчик discover в `refs/game/script.js:792-844`:

1. Делает POST `/api/discover` с body `{position, guid, wish}`.
2. На успехе обновляет `localStorage['inventory-cache']`, прибавляя дроп.
3. Обновляет `#i-ref` в попапе из свежего `inventory-cache`.
4. **НЕ** трогает `prop.highlight` на feature и **НЕ** вызывает `feature.changed()`.

`FeatureStyles.LIGHT` (refs/game/script.js:269) держит closure над массивом `prop.highlight = e.h`, пришедшим в момент `drawEntities`. На каждом render-frame renderer читает `values[7]` (для канала References) - значение остаётся прежним до пересоздания feature.

## Как фиксим

### Перехват /api/discover

Модуль ставит monkey-patch на `window.fetch` при первом enable. Перехватчик пропускает все запросы, кроме `/api/discover`; для них клонирует Response (чтобы не блокировать игру), парсит loot и считает прирост ключей по тому же предикату, что игра использует на refs/game/script.js:816 для обновления inventory-cache: `t === 3 && l === pointGuid`.

Body shape: server возвращает `{loot, remaining, next, xp}` напрямую, без обёртки `{response: {...}}`. Не путать с локальной переменной `response` внутри `apiSend` (refs/game/script.js:3697) - apiSend парсит body через `request.json()` и присваивает в `response` для своих consumers, но это уже обёртка apiSend на следующем уровне.

### Применение gain через короткую задержку

После того как loot прочитан и gain посчитан, модуль НЕ применяет изменение сразу. Вместо этого:

1. Запоминает текущее значение `feature.get('highlight')[7]` как `beforeValue`.
2. Через `DETECTION_DELAY_MS` (100мс) повторно читает значение.
3. Если оно изменилось vs `beforeValue` - кто-то (сама игра, когда исправит баг, или другой userscript-фиксер) уже обновил счётчик. Skip - не дублируем gain.
4. Если значение не изменилось - применяем gain in-place к массиву `highlight` и вызываем `feature.changed()`.

Это даёт forward-compat: когда разработчик игры исправит баг и сама игра в continuation после `await apiSend('discover', ...)` обновит `prop.highlight[7]` и вызовет `feature.changed()`, наш модуль автоматически станет no-op и не будет давать удвоенного gain. До исправления модуль работает штатно.

100мс - достаточно для отработки игровой continuation после `await fetch().json()` (синхронные DOM-операции) и при этом ниже порога перцептивной задержки текста на карте (~150мс).

### Доступ к feature

`pointsSource.getFeatureById(targetGuid)` находит feature по guid из request body. Если за время задержки feature был уничтожен (точка ушла из viewport, layer пересоздан) - findById вернёт null, мы пропускаем. Следующий `drawEntities` в любом случае пересоздаст feature с актуальным `e.h` от сервера.

### in-place мутация массива highlight

`feature.get('highlight')` возвращает тот же массив, что закрыт closure нативного LIGHT-renderer-а (refs/game/script.js:269-270, 303). In-place мутация `highlight[7] += gain` видна обеим сторонам:

- нативному 32px-тексту, если `improvedPointText` выключен;
- нашему адаптивному тексту через wrapped renderer, если `improvedPointText` включён.

Один источник истины, два рендер-пути читают из него.

## Совместимость с improvedPointText

Модули ортогональны:

- `improvedPointText` ON + `fixRedrawRefsOnDiscover` ON: наш адаптивный текст обновляется после discover.
- `improvedPointText` OFF + `fixRedrawRefsOnDiscover` ON: нативный 32px-текст обновляется после discover.
- `improvedPointText` ON + `fixRedrawRefsOnDiscover` OFF: наш адаптивный текст НЕ обновляется (исходный баг игры).
- `improvedPointText` OFF + `fixRedrawRefsOnDiscover` OFF: нативный 32px-текст НЕ обновляется (исходный баг игры).

## Защита от race-condition

`installGeneration` counter инкрементируется на каждом `enable`/`disable`. enable содержит `await getOlMap()`; если `disable` отработал во время await, после резолва промиса `enable` сравнивает свой generation с актуальным и выходит до записи `pointsSource`. Без этого ссылка на старый layer осталась бы вечно (disable уже отработал и не увидел её).

`discoverHookEnabled` проверяется перед обработкой response и перед `setTimeout`-callback применения gain. Disable между перехватом и тиком таймера приведёт к пропуску gain - как и должно быть.

## Файловая структура

| Файл                              | Назначение                                                                                                          |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `fixRedrawRefsOnDiscover.ts`      | Определение модуля + `installDiscoverFetchHook` + `computeRefsGainFromDiscover` + `applyRefsGainToFeature`          |
| `fixRedrawRefsOnDiscover.test.ts` | Тесты body shape (включая regression на старый wrapper-баг), forward-compat skip-логики, race-disable, lazy install |

## Настройки

Модуль не имеет настроек. Включён по умолчанию.
