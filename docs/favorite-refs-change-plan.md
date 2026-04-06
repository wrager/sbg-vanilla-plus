# План изменений для `feature/favorite-refs`

Документ обновлён по результатам углублённого ревью Codex + Opus с проверкой по `HEAD`.

## 1. Согласованный план правок

| #   | Что                                                           | Приоритет | Детали                                                                                                                         |
| --- | ------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Оставить debug-кнопку, но убрать bypass автоочистки           | P0        | Пользователь отлаживает кнопку. В авто-потоке `discover` вернуть обязательную проверку `shouldRunCleanup`                      |
| 2   | Убрать `favoritedGuids.size > 0` как gate fast-режима         | P0        | Не блокировать кейс «модуль ready, избранных 0». Защиту от проблем IDB перевести в явный флаг надёжности снимка (см. раздел 2) |
| 3   | Тесты `slowRefsDelete.ts`                                     | P0        | `calculateSlowDeletions`, `collectOverLimit` (per-point), `fetchTeamsForGuids`, `unknown team -> skip`, mixed limits           |
| 4   | Регресс-тест: `referencesEnabled=true` + пустые избранные     | P0        | Fast-режим должен удалять ключи даже при `favoritedGuids = empty Set`                                                          |
| 5   | Guard-token для `waitForElement`                              | P0        | `starButton.ts`, `inventoryFilter.ts` — проверка в `.then()` перед `startObserving`                                            |
| 6   | `cancelAnimationFrame` в teardown                             | P0        | `settingsUi.ts`, `cleanupSettingsUi.ts`, `slowRefsDelete.ts`                                                                   |
| 7   | Исправить stale slow-button                                   | P0        | При `mode !== 'slow'` удалять кнопку сразу                                                                                     |
| 8   | `debugHooks` в opt-in dev-режим                               | P0        | `#svp-dev=1` или `localStorage['svp_debug']=1`; убрать runtime `console.log` в `favoritedPoints.ts`                            |
| 9   | Синхронизировать тексты/комментарии с фактом `fast=per-point` | P1        | Исправить «общий лимит» в UI и комментариях                                                                                    |
| 10  | Вынести toast в `core`, убрать coupling                       | P1        | Убрать CSS/DOM-связи между модулями                                                                                            |
| 11  | Убрать/сократить `as` assertions в production                 | P1        | Заменить на guards/narrowing                                                                                                   |
| 12  | Сохранить `response.url` в `lastRefProtection`                | P1        | После `new Response(...)` восстановить `url` через `Object.defineProperty`                                                     |
| 13  | Минимальные тесты `settings.ts`                               | P2        | defaults, invalid JSON, round-trip, missing field                                                                              |
| 14  | UX-hint про неактивный `favoritedPoints`                      | P2        | Актуализировать подсказку только про inactive/not-ready, не про `favorites=0`                                                  |
| 15  | Обновить glossary                                             | P2        | Добавить термин `hideLastFavRef` в `docs/glossary.md`                                                                          |

## 2. Уточнение по `favoritedGuids.size > 0` (история коммитов)

Факт из истории:

- Условие добавлено в коммите `8a1c2b4` с явной мотивацией «защита от сценария, когда IDB не загрузился или кеш пуст».
- Источник: `git show 8a1c2b4` (message + patch в `cleanupCalculator.ts`).

Вывод для фикса:

1. Нельзя просто «выкинуть защиту» без замены.
2. Нельзя оставлять `size > 0` как прокси надёжности: это ломает валидный сценарий «0 избранных».
3. Правильная замена: явный сигнал «снимок избранных надёжен» (например, флаг после успешного `loadFavorites()`), а не проверка количества записей.

## 3. Детализация по файлам

### P0-1. Debug-кнопка без bypass автоочистки

- `src/modules/inventoryCleanup/inventoryCleanup.ts:17-20`  
  Переименовать `DEBUG_FORCE_CLEANUP` в `DEBUG_SHOW_CLEANUP_BUTTON` (или эквивалент).
- `src/modules/inventoryCleanup/inventoryCleanup.ts:87-93`  
  Убрать bypass `shouldRunCleanup` из автоматического потока.
- `src/modules/inventoryCleanup/inventoryCleanup.ts:168-181`  
  Оставить кнопку `TEST CLEANUP` как ручной force-path.

### P0-2. Условие `size > 0`

- `src/modules/inventoryCleanup/cleanupCalculator.ts:58-65`  
  Убрать `options.favoritedGuids.size > 0` из gate fast-режима.
- `src/core/favoritesStore.ts` + вызовы из `inventoryCleanup`  
  Добавить/использовать явный флаг надёжности snapshot после успешного `loadFavorites()`.

### P0-5. Guard-token для `waitForElement`

- `src/modules/favoritedPoints/starButton.ts:127-130`
- `src/modules/favoritedPoints/inventoryFilter.ts:271-274`

### P0-6. `cancelAnimationFrame`

- `src/modules/favoritedPoints/settingsUi.ts:173-189, 193-200`
- `src/modules/inventoryCleanup/cleanupSettingsUi.ts:353-363, 367-383`
- `src/modules/inventoryCleanup/slowRefsDelete.ts:382-393, 398-402`

### P0-7. Stale slow-button

- `src/modules/inventoryCleanup/slowRefsDelete.ts:352-379`  
  `ensureButton/checkAndInject` должны удалять кнопку при `mode !== 'slow'`.

### P1-9. Тексты про fast-limit

- `src/modules/inventoryCleanup/cleanupSettings.ts:9`
- `src/modules/inventoryCleanup/cleanupSettingsUi.ts:31-32`
- `src/modules/inventoryCleanup/cleanupSettingsUi.ts:39-40`

### P1-10. Toast + coupling

- Дублирование toast:
  - `src/modules/inventoryCleanup/inventoryCleanup.ts:37-49`
  - `src/modules/inventoryCleanup/slowRefsDelete.ts:192-203`
  - `src/modules/favoritedPoints/lastRefProtection.ts:39-53`
- DOM-coupling:
  - `src/modules/inventoryCleanup/slowRefsDelete.ts:12` (`.svp-fav-filter-bar`)

### P1-11. `as` assertions (production)

- `src/modules/favoritedPoints/starButton.ts:31`
- `src/modules/favoritedPoints/inventoryFilter.ts:46`
- `src/modules/favoritedPoints/inventoryFilter.ts:157`
- `src/modules/favoritedPoints/lastRefProtection.ts:35`
- `src/modules/inventoryCleanup/cleanupCalculator.ts:82`
- `src/modules/inventoryCleanup/slowRefsDelete.ts:39`
- `src/modules/inventoryCleanup/slowRefsDelete.ts:41`
- `src/modules/inventoryCleanup/inventoryApi.ts:153`

### P1-12. Сохранение `response.url`

- `src/modules/favoritedPoints/lastRefProtection.ts:85-89`  
  После создания `Response` восстановить `url` (как в CUI helper `createResponse`).

## 4. Отброшенные идеи Codex

1. Массовый rename CSS state-классов (`is-filled` -> `svp-is-filled`) в этом цикле.
2. Полные тесты `favoritedPoints.ts`, `settingsUi.ts`, `debugHooks.ts`.
3. Отдельное UI-предупреждение про потерю `cooldown` при импорте.
4. Немедленное удаление debug-кнопки автоочистки (отклонено пользователем на период отладки).

## 5. Отброшенные идеи Opus

1. `debugHooks` always-on в production (заменено на opt-in).
2. Тесты только для `slowRefsDelete.ts` (добавлены также минимальные `settings.ts` + регрессии).
3. Утверждение, что `fast=global` в текущем `HEAD` (устарело после `7eef0ed`).
4. Изначальный тезис о полной симметрии `enable/disable` и отсутствии coupling (пересмотрен).

## 6. Статус

План актуализирован по `HEAD`; в нём зафиксированы согласованные правки и отклонённые идеи обеих сторон.
