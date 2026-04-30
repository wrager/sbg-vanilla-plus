# nextPointSwipeAnimation

Анимация попапа точки при свайпе влево/вправо: попап улетает в направлении жеста когда есть следующая точка, отскакивает обратно когда её нет.

## Поведение

Свайп влево или вправо на попапе точки (`.info`, вне карусели ядер) - попап улетает в направлении свайпа когда переключение реально произойдёт, иначе отскакивает обратно (фейковая анимация).

Решение dismiss vs return принимается так:

1. Наш priority (`pickNextInRange` из `core/nextPointPicker`) нашёл следующую точку в радиусе действия (45 м) - dismiss, finalize вызовет `window.showInfo`.
2. Иначе если `betterNextPointSwipe` активен (нативный handler подавлен) - return, фейковая анимация. Переключения не будет.
3. Иначе если на карте видно больше одной точки (наш `pointsSource.getFeatures().length > 1`) - dismiss без pending guid. Анимация работает в параллель с нативным handler-ом игры, который синхронно в touchend сделает navigation через `near_points`. Это путь "анимация для нативного свайпа" когда `betterNextPointSwipe` выключен пользователем.
4. Иначе - return. Ни мы, ни нативный не переключат: на карте только текущая видимая точка.

В пункте 3 мы не имеем доступа к нативному `near_points` (closure в game-script), поэтому approximate через `points_source.getFeatures().length > 1` - грубо, но достаточно: если на карте >= 2 видимых точки, нативный `near_points` в типичном сценарии уже наполнен после клика по точке на карте, и переключение состоится.

## Зачем отдельный модуль

Самостоятельная фича UI: даже без `betterNextPointSwipe` (если пользователь его выключил) попап анимируется на свайпе и пользователь визуально видит реакцию системы. Без этого модуля свайп производит навигацию без визуального feedback - попап мгновенно меняет содержимое через `showInfo`.

## Архитектура

### Touch-tracking и анимация

Через `core/popupSwipe` (общая инфраструктура свайп-жестов на `.info`). Регистрируем направления `left` и `right` с одним handler-ом:

- `canStart` - исключает touch внутри `.splide` (карусель ядер).
- `decide` - вызывает `pickNextInRange` из `core/nextPointPicker`. Если найдена точка - возвращает `'dismiss'` и сохраняет guid в `pendingNextGuid`. Если нет - `'return'`.
- `finalize` - вызывается после dismiss-анимации (transitionend). Открывает сохранённую точку через `window.showInfo`.
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
