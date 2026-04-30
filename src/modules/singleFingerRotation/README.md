# Вращение карты одним пальцем (singleFingerRotation)

Вращение карты круговым жестом одного пальца в режиме следования за игроком.

## Возможности для игрока

- **Круговой жест.** Палец движется вокруг центра экрана (с учётом padding view). Угол точки касания относительно центра считается через `atan2`, разница между текущим и предыдущим кадром добавляется к `view.rotation`. Применение через `requestAnimationFrame` - сглаживает дрожание.
- **Только в режиме Follow.** Жест активен только когда в `localStorage.follow !== 'false'`. В свободном режиме игрок панорамирует карту обычным touch'ем без вращения.
- **DragPan отключается на время жеста.** Иначе нативный pan конфликтует с нашим rotation. На touchend / touchcancel DragPan возвращается через `dragPanControl.restore()`.

## Архитектура

### Runtime-детекция нативного FixedPointRotate

В SBG 0.6.1 был добавлен нативный жест `FixedPointRotate` (refs/game-beta/script.js:711) - drag в режиме Follow вращает карту вокруг позиции игрока. После выпуска 0.6.1 игра откатила FixedPointRotate хотфиксом без bump'а версии. Детект только по версии (`isSbgGreaterThan('0.6.0')`) больше не работает: в одной и той же 0.6.1 у одних пользователей нативный жест есть, у других нет.

Решение - `view.getConstrainRotation()` как сигнал. Дефолт OL - `true` (rotation snap'ится к 0/90/180/270). SBG 0.6.1 явно ставит `false` (refs/game-beta/script.js:746), чтобы FixedPointRotate мог свободно вращать карту. Если хотфикс игры откатил FixedPointRotate, View пересоздан с дефолтным `constrainRotation: true` - наш модуль активируется.

`getConstrainRotation` - публичный API OL, стабильное имя при минификации и в разных версиях библиотеки. Не используется `interaction.constructor.name` - имена при минификации нестабильны.

Детект однократный, по состоянию на момент enable. Если игра в runtime переключит `constrainRotation` (как уже было однажды: SBG 0.6.1 ставил false, потом хотфикс вернул дефолт), модуль не отреагирует без перезапуска. Симптом "модуль не работает" или "работает параллельно с нативом" лечится перезагрузкой страницы.

### State-machine ngrsZoom-detection

В SBG 0.6.1 ввели `ol.interaction.DblClickDragZoom` (refs/game-beta/script.js:782): двойной тап + удержание второго пальца + вертикальный drag - зум. Раньше у проекта был отдельный модуль `ngrsZoom`, который перехватывал touch-события на capture-фазе и останавливал распространение для `singleFingerRotation`. После удаления модуля `singleFingerRotation` остался без блокировки и мог конфликтовать с нативным жестом.

Логика подавления повторяет константы прошлой реализации `ngrsZoom`:

- `NGRS_DOUBLE_TAP_GAP_MS = 300` - окно double-tap.
- `NGRS_DOUBLE_TAP_DISTANCE_PX = 30` - максимальный сдвиг между первым и вторым тапом.

Состояние `lastTapEndTime` / `lastTapEndX/Y` - момент и координата последнего touchend. На каждом touchstart проверяется: если `dt <= 300ms` и `distance <= 30px` от последнего touchend, ставится флаг `suppressedAfterDoubleTap = true` - вся последующая серия touch до touchend полностью игнорируется (ни rotation, ни DragPan-disable).

Раньше после второго тапа была попытка late-старта rotation по доминирующей оси первого touchmove (вертикаль = ngrsZoom, игнорируем; горизонталь = late-rotation). Не работало: drag для зума часто начинался с лёгкого горизонтального дрейфа пальца, и late-rotation срабатывал ошибочно. Теперь серия после double-tap подавляется целиком - повторяет поведение прошлой пары `ngrsZoom + singleFingerRotation`.

После touchend в double-tap-серии `lastTapEndTime` сбрасывается в 0 - следующий touchstart НЕ должен попасть в double-tap-окно как третий тап. Дополнительно тесты покрывают tap-tap-drag-end -> новый tap-drag активирует rotation как одиночный.

`Date.now()` вместо `event.timeStamp` - jest fake timers контролируют `Date.now()` (а `timeStamp` read-only).

### calculateExtent wrapper

Игра запрашивает точки через `view.calculateExtent(map.getSize())`, перезапрашивает только при смещении центра >30м или изменении зума - поворот не вызывает перезагрузку. Чтобы загруженная область покрывала любой угол поворота, оборачиваем `view.calculateExtent`: при наличии size возвращаем `original.call(view, [diagonal, diagonal])`, где diagonal - длина диагонали вьюпорта. Сохраняется ссылка на оригинал как есть (без `bind`): иначе каждый цикл enable/disable наращивал бы слой bound-обёрток, и disable не восстанавливал бы исходную функцию by-reference. Контекст передаётся через `.call(view, ...)` в самом wrapper'е.

## Файловая структура

| Файл                           | Назначение                                                               |
| ------------------------------ | ------------------------------------------------------------------------ |
| `singleFingerRotation.ts`      | Определение модуля + state-machine + native-detect + extent-wrapper      |
| `singleFingerRotation.test.ts` | Тесты gesture-логики, double-tap suppression, FixedPointRotate detection |

## Настройки

Модуль не имеет настроек. Включён по умолчанию.
