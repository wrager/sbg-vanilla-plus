# Улучшенный UI вкладки ключей (enhancedRefsTab)

Делает карточку ключа во вкладке References инвентаря визуально предсказуемой и улучшает поведение выпадающего меню действий.

## Возможности для игрока

- **3-строчная карточка.** Содержимое каждой карточки разносится на три фиксированные строки независимо от длины имени владельца. Высота карточки одинаковая для всех ключей — список не «прыгает» по вертикали.
- **Авто-закрытие меню действий.** После клика по нативной кнопке Favorite / Lock / Removal menu в выпадающем меню `.inventory__ref-actions` меню скрывается автоматически. В нативе игра оставляет меню открытым — пользователь должен ещё раз кликнуть по троеточию, чтобы закрыть. Это лишний шаг.

## Архитектура

### Слой 1: 3-line layout (CSS)

`styles.css` — flexbox-разметка `.inventory__item-left` с `flex-direction: column` и фиксированной высотой строк. Никакого JS.

### Слой 2: popover closer (JS)

`popoverCloser.ts` подписывается на click-события трёх кнопок в `.inventory__ref-actions` (`[data-flag="favorite"]`, `[data-flag="locked"]`, `#inventory__ra-manage`) и после нативного обработчика добавляет класс `hidden` к popover-элементу. Это имитирует эффект игровой `destroyPopover` (refs/game-beta/script.js:4516).

**setTimeout/microtask порядок.** Наш handler срабатывает через `Promise.resolve().then(...)` — нативный обработчик игры (отправка `/api/marks` или открытие manage-меню) отрабатывает первым, наш `hidden` ставится после.

**Игровой Popper-state.** Объект `popovers.ref_actions` лежит в IIFE-замыкании игры, нам недоступен. После нашего `hidden` Popper-инстанс остаётся в памяти, но визуально меню скрыто. При следующем клике по троеточию игра либо пересоздаст Popper для другого guid, либо повторно вызовет `destroyPopover` (если guid тот же) — оба варианта корректны.

**Защита от race-conditions.** `installGeneration` инкрементируется на каждом install/uninstall. `waitForElement('.inventory__ref-actions').then(...)` сравнивает свой generation с актуальным: если между ожиданием и резолвом случился disable, install пропускается.

## Файловая структура

| Файл                      | Назначение                                                         |
| ------------------------- | ------------------------------------------------------------------ |
| `enhancedRefsTab.ts`      | Определение модуля: enable/disable, инжект/съём CSS + popover hook |
| `popoverCloser.ts`        | Click-listeners на 3 кнопки + закрытие popover через `hidden`      |
| `popoverCloser.test.ts`   | Тесты на закрытие popover для каждой кнопки + uninstall + race     |
| `enhancedRefsTab.test.ts` | Тесты CSS-инжекта (метаданные, styles inject/remove)               |
| `styles.css`              | 3-line flex-разметка карточки                                      |

## Настройки

Модуль не имеет настроек. Включён по умолчанию.
