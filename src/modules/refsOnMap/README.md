# Ключи на карте (refsOnMap)

Viewer ключей инвентаря: открывает карту в режиме просмотра с маркерами всех точек, по которым у пользователя есть ключи. На каждом маркере подпись с количеством ключей, цвет от фракции владельца точки. Можно выбрать ключи кликом и удалить кнопкой trash.

## Для игрока

### Доступ

Кнопка модуля появляется на вкладке ключей инвентаря (рядом с фильтром свайпом). Клик открывает viewer: нативные слои карты скрываются, рисуется свой layer с маркерами точек-носителей ключей.

### Удаление ключей

В viewer-режиме клик по маркеру переключает выделение (оранжевый цвет, увеличенный радиус). Кнопка trash в правом нижнем углу показывает счётчик `🗑 N (M)`: N - уникальные точки, M - суммарное количество ключей. Клик по trash:

1. Фильтр защищённых: ключи точек с нативным замочком или звёздочкой SBG не идут в payload, пользователь видит тост о причине.
2. Confirm-диалог: `Удалить M ключ(ей) от N точ(ек)?`.
3. Race-protection: между confirm и DELETE кэш перечитывается; точки, ставшие защищёнными за это время, выкидываются из payload, тост сообщает.
4. После DELETE счётчик ключей точки на основной карте синхронизируется через `core/refsHighlightSync`.

При выборе ТОЛЬКО защищённых точек удаление пропускается (тост, без confirm). При отсутствии поля `f` целиком (старые версии SBG без lock/favorite-семантики) или mix-кэше удаление блокируется целиком.

### Защита

Защита ключей через нативные замочек (бит 0b10) и звёздочку (бит 0b01) поля `f` стопки в `inventory-cache`. Семантика общая со всеми модулями массового удаления через `core/inventoryCache.buildProtectedPointGuids`. Подробнее про защиту см. README модуля `inventoryCleanup`.

## Техническая реализация

### Открытие viewer

`showViewer()` подменяет видимость нативных layer'ов (`points`, `lines`, `regions`), создаёт собственный `VectorSource` с features по `readFullInventoryReferences()`, выставляет zoom/rotation в фиксированные значения для предсказуемой раскладки и навешивает click-handler на map. Состояние follow-режима сохраняется и восстанавливается на close. Команды нативного UI игры (top-panel collapsible, кнопка inventory) скрываются на время viewer.

### Партиционирование при удалении

`partitionByProtection(features, protectedPointGuids)` разделяет features на `{ deletable, kept }` по принадлежности их `pointGuid` к Set'у защищённых точек. Используется дважды в `handleDeleteClick`: первый раз сразу после клика по trash для pre-confirm-фильтра, второй - после confirm с `freshProtectedPointGuids` для race-protection между confirm и DELETE.

После DELETE `keptFeatures` собирается как `[...stillProtected, ...newlyProtected]`, где `stillProtected` - features из исходного `kept`, всё ещё защищённые на момент DELETE (фильтр по `freshProtectedPointGuids` ловит обратный race protected -> open). Features, ставшие open между partition и DELETE, сбрасывают `isSelected=false`, чтобы следующий клик trash начинал с чистого выбора.

### Защитный guard

`isProtectionFlagSupportAvailable(cache)` блокирует удаление целиком при отсутствии поля `f` хотя бы у одной реф-стопки. Симметрично с `inventoryApi.deleteInventoryItems`, `slowRefsDelete.runSlowDelete`, `cleanupCalculator.calculateDeletions` - все четыре канала массового удаления опираются на одну и ту же core-функцию.

### DELETE

`deleteRefsFromServer(items)` шлёт `DELETE /api/inventory` напрямую с Bearer-токеном (минуя `inventoryApi.deleteInventoryItems`, у которого свой payload-формат). Симметрия защиты обеспечена двойным re-fetch в caller-е.

После успеха: `removeRefsFromCache(deletedGuids)` обновляет localStorage, `syncRefsCountForPoints(affectedPointGuids)` синхронизирует подписи на основной карте (после hideViewer), `updateInventoryCounter(total)` обновляет DOM-счётчик инвентаря.

## Файловая структура

| Файл                | Назначение                                                                                                              |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `refsOnMap.ts`      | Модуль: lifecycle, viewer-открытие/закрытие, layer/source, partition, DELETE, селекция                                  |
| `refsOnMap.test.ts` | Тесты viewer-открытия, селекции, partition lock/favorite, race-protection (оба направления), 0.6.0 / mix-кэш блокировка |
| `styles.css`        | Стили кнопки модуля, trash, protection-note, layer-маркеров                                                             |
