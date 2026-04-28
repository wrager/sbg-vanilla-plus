# Закрытие меню действий ключа (betterRefPopoverClosing)

Авто-закрытие выпадающего меню действий `.inventory__ref-actions` (Favorite / Lock / Removal menu) после клика по любой из кнопок.

## Возможности для игрока

- **Авто-закрытие меню после действия.** В нативной игре после клика по Favorite / Lock / Removal menu меню остаётся открытым, и пользователь должен ещё раз кликнуть по троеточию, чтобы его закрыть. Модуль закрывает меню сам.

## Архитектура

`popoverCloser.ts` подписывается на click-события трёх кнопок в `.inventory__ref-actions` (`[data-flag="favorite"]`, `[data-flag="locked"]`, `#inventory__ra-manage`) и после клика **симулирует клик по reference-элементу** (троеточие, к которому привязан Popper). Игровой handler троеточия видит активный popover для того же guid и вызывает свой `destroyPopover` ([refs/game/script.js:3517-3522](../../../refs/game/script.js#L3517)) - со сбросом `popovers.ref_actions = null`.

**Почему не `classList.add('hidden')`.** Если просто скрыть popover-элемент, объект `popovers.ref_actions` в IIFE-замыкании игры остаётся не-null. При следующем клике по троеточию игра попадает в ветку `else` своего обработчика (destroyPopover закрытого popover-а), сбрасывает state - и закрывает повторно. Эффект для пользователя: первый клик троеточия не открывает popover, нужен второй.

**Перехват `Popper.createPopper`.** Чтобы получить ссылку на reference-элемент, на enable патчим глобальный `window.Popper.createPopper`: для нашего popover-а (`.inventory__ref-actions`) сохраняем последний созданный инстанс, чтобы в момент клика Favorite/Lock/Manage достать `instance.state.elements.reference` и кликнуть его. На disable оригинальный `createPopper` восстанавливается.

**setTimeout вместо microtask.** HTML-спецификация event dispatch выполняет microtask checkpoint после каждого bubble-listener-а на одном target. Если откладывать закрытие через `Promise.resolve().then(...)`, оно сработает МЕЖДУ нашим listener-ом и игровым sync handler-ом favorite/lock - игра увидит `popovers.ref_actions === null` (мы только что сбросили через `reference.click()`) и сделает early return до `apiSend`, action на сервер не уйдёт. `setTimeout(closePopover, 0)` планирует task, который запускается после полного завершения click-события: к этому моменту sync-часть игрового handler-а уже отработала, `apiSend` в полёте.

**Fallback.** Если `Popper` ещё не был перехвачен в момент действия (popover был открыт до enable модуля - редкий race), просто добавляется `hidden` к popover. Лучше визуальное закрытие без сброса state, чем оставленное открытым меню.

**Защита от race-conditions.** `installGeneration` инкрементируется на каждом install/uninstall. `waitForElement('.inventory__ref-actions').then(...)` сравнивает свой generation с актуальным: если между ожиданием и резолвом случился disable, install пропускается.

## Файловая структура

| Файл                         | Назначение                                                          |
| ---------------------------- | ------------------------------------------------------------------- |
| `betterRefPopoverClosing.ts` | Определение модуля: enable/disable + popover hook                   |
| `popoverCloser.ts`           | Click-listeners на 3 кнопки + закрытие popover через клик троеточия |
| `popoverCloser.test.ts`      | Тесты на закрытие popover для каждой кнопки + uninstall + race      |

## Настройки

Модуль не имеет настроек. Включён по умолчанию.
