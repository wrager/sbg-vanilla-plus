# nextPointSwipeAnimation

Анимация попапа точки при свайпе влево/вправо: попап улетает в направлении жеста когда есть следующая точка, отскакивает обратно когда её нет.

## Поведение

Свайп влево или вправо на попапе точки (`.info`, вне карусели ядер):

- **Если следующая точка есть** в радиусе действия (45 м, по приоритету `betterNextPointSwipe`) - попап улетает в направлении свайпа с opacity 0, через 120 мс открывается следующая точка через `window.showInfo`.
- **Если следующей точки нет** - попап с тем же translation отскакивает обратно с opacity 1, остаётся открытым на текущей точке.

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

Когда оба модуля активны (default), `betterNextPointSwipe` через runtime-override `Hammer.Manager.prototype.emit` подавляет нативный handler игры. Когда он замечает что `nextPointSwipeAnimation` тоже активен (через `isModuleActive`), он не вызывает свою синхронную navigation - анимация сама выполнит её в `finalize`. Без этого navigation сработала бы дважды (Hammer override + animation finalize).

Если выключить `betterNextPointSwipe`, оставив только анимацию: нативный Hammer-handler игры жив и тоже срабатывает на свайп - возможна двойная navigation (нативный showInfo через `near_points` плюс наша через `pickNextInRange`). Это нелогичная конфигурация модулей; обычно либо оба активны (полная замена нативного с анимацией), либо оба выключены (чистый нативный свайп).

### Логика выбора

В `core/nextPointPicker.ts`. Те же чистые функции, что и в `betterNextPointSwipe`. Каждый модуль держит свой `visited` Set - при отключении одного из модулей цепочки visited не пересекаются.

## Файловая структура

| Файл                              | Назначение                                                                                 |
| --------------------------------- | ------------------------------------------------------------------------------------------ |
| `nextPointSwipeAnimation.ts`      | Определение модуля + регистрация direction в core/popupSwipe + decide/finalize + canStart  |
| `nextPointSwipeAnimation.test.ts` | Тесты на metadata, canStart-фильтр, decide/finalize, visited tracking, race-disable, циклы |

## Настройки

Модуль не имеет настроек. Включён по умолчанию.
