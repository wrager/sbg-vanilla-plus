# nextPointSwipeAnimation

Анимация попапа точки при свайпе влево/вправо: попап улетает в направлении жеста когда есть следующая точка, отскакивает обратно когда её нет.

## Поведение

Свайп влево или вправо на попапе точки (`.info`, вне карусели ядер) - попап улетает в направлении свайпа когда переключение реально произойдёт, иначе отскакивает обратно (фейковая анимация).

Решение dismiss vs return зависит от того, активен ли `betterNextPointSwipe`:

**`betterNextPointSwipe` активен** (нативный handler подавлен через Hammer-override):

1. Наш priority (`pickNextInRange` из `core/nextPointPicker`) нашёл следующую точку в радиусе действия (45 м) - dismiss, finalize вызовет `window.showInfo` после анимации.
2. Не нашёл - return, фейковая анимация. Переключения не будет.

**`betterNextPointSwipe` выключен** (нативный handler жив):

3. В нашем `nearPointsSnapshot` есть >= 2 точек - dismiss без pending guid. Анимация идёт параллельно нативному handler-у игры, который синхронно в touchend сделает navigation через свой `near_points`. Наш `finalize` ничего не делает.
4. Иначе - return. Ни native не переключит, ни мы не должны.

`nearPointsSnapshot` - наша копия игрового `near_points`. Игра обновляет `near_points` в `map.singleclick`-handler-е (`refs/game/script.js:540-560`): если клик пришёл по фиче слоя `points`, она перезаписывает массив на `visible.filter(isInRange(player))` - снимок точек в радиусе игрока на момент тапа. Native swipe handler на touchend читает уже этот снимок (`refs/game/script.js:741`), не пересчитывая на месте: если игрок успел двинуться между тапом и свайпом, native всё равно использует старый снимок. Мы подписываемся на тот же `map.singleclick` и поддерживаем зеркальный `nearPointsSnapshot`, чтобы предиктор dismiss/return совпадал с фактическим решением native handler-а на 100%, без расхождений из-за движения игрока.

Когда `betterNextPointSwipe` выключен, наша priority logic (`pickNextInRange`) НЕ срабатывает - пользователь специально отключил «улучшенный свайп», ожидая чисто нативного поведения. Иначе модуль анимации продолжал бы тихо делать work `betterNextPointSwipe` под видом "только анимации".

## Зачем отдельный модуль

Самостоятельная фича UI: даже без `betterNextPointSwipe` (если пользователь его выключил) попап анимируется на свайпе и пользователь визуально видит реакцию системы. Без этого модуля свайп производит навигацию без визуального feedback - попап мгновенно меняет содержимое через `showInfo`.

## Архитектура

### Touch-tracking и анимация

Через `core/popupSwipe` (общая инфраструктура свайп-жестов на `.info`). Регистрируем направления `left` и `right` с одним handler-ом:

- `canStart` - исключает touch внутри `.splide` (карусель ядер).
- `decide` - решает по `isModuleActive('betterNextPointSwipe')`: если активен - использует `pickNextInRange` из `core/nextPointPicker` и сохраняет guid в `pendingNextGuid` для последующего `window.showInfo`; если неактивен - проверяет наш `nearPointsSnapshot.size > 1` (зеркало игрового `near_points`) и возвращает `dismiss` без pending guid (native сам сделает navigation).
- `finalize` - вызывается после dismiss-анимации (transitionend). Если `pendingNextGuid` есть - открывает точку через `window.showInfo`; если нет - no-op (native handler уже открыл точку).
- `animationDurationMs: 120` - короче дефолтных 300 мс из core: горизонтальный жест должен ощущаться мгновенным.

State machine `core/popupSwipe` (`idle -> tracking -> swiping -> animating -> idle`) сериализует жесты, поэтому `pendingNextGuid` не подвержен race conditions.

### Совместимость с betterNextPointSwipe

**Оба модуля активны (default)**: `betterNextPointSwipe` через runtime-override `Hammer.Manager.prototype.emit` подавляет нативный handler игры. Когда он замечает что `nextPointSwipeAnimation` тоже активен (через `isModuleActive`), он не вызывает свою синхронную navigation - анимация сама выполнит её в `finalize` после dismiss-анимации. Без этого navigation сработала бы дважды.

**Только anim, без better**: нативный Hammer-handler игры жив и сработает синхронно на touchend свайпа - native showInfo. Наш `decide` это распознаёт через approximate `visibleCount > 1` и возвращает `dismiss` без pending guid. Animation идёт параллельно нативному, finalize ничего не делает (native сам открыл точку). Native showInfo синхронно меняет `popup.dataset.guid`; чтобы popupSwipe-observer не отменил нашу dismiss-анимацию через `cleanupAnimation`, swipeHandler выставляет `keepAnimatingOnDataGuidChange: true` - observer пропускает data-guid mutation в state=animating. Animation досматривает до transitionend, потом resetElementStyles показывает попап с уже подменённым нативом содержимым новой точки.

**Только better, без anim**: animation не зарегистрирована, betterNextPointSwipe мгновенно выполняет navigation в Hammer-override без анимации.

**Оба выключены**: чистый нативный свайп игры без UI feedback с нашей стороны.

### Логика выбора

В `core/nextPointPicker.ts`. Те же чистые функции, что и в `betterNextPointSwipe`. Каждый модуль держит свой `visited` Set - при отключении одного из модулей цепочки visited не пересекаются.

## Файловая структура

| Файл                              | Назначение                                                                                 |
| --------------------------------- | ------------------------------------------------------------------------------------------ |
| `nextPointSwipeAnimation.ts`      | Определение модуля + регистрация direction в core/popupSwipe + decide/finalize + canStart  |
| `nextPointSwipeAnimation.test.ts` | Тесты на metadata, canStart-фильтр, decide/finalize, visited tracking, race-disable, циклы |

## Настройки

Модуль не имеет настроек. Включён по умолчанию.
