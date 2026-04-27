import { waitForElement } from '../../core/dom';

/**
 * После клика по нативной кнопке Favorite, Lock или Removal menu в попапе
 * `.inventory__ref-actions` (refs/game-beta/dom/body.html:415) сам popover не
 * закрывается - игра вызывает только `apiSend('marks', 'post', ...)` и
 * перерисовывает иконку, а закрытие меню оставляет на пользователя (нужен
 * клик по троеточию ещё раз). UX-фидбек: после действия меню должно
 * скрываться автоматически - пользователь уже сделал выбор.
 *
 * Игра скрывает popover функцией `destroyPopover` (refs/game-beta/script.js:4516):
 * добавляет класс `hidden` к popper-элементу, разрушает Popper-инстанс и
 * сбрасывает `popovers.ref_actions = null`. Сам объект `popovers` лежит в
 * IIFE-замыкании, нам недоступен. Имитируем эффект через `classList.add('hidden')`
 * - визуально меню закрывается. Игровой Popper-state остаётся, но при следующем
 * клике по троеточию игра либо пересоздаст Popper для другого guid, либо
 * повторно вызовет destroyPopover (если guid тот же) - в обоих случаях
 * корректно.
 */

const POPOVER_SELECTOR = '.inventory__ref-actions';
const HIDDEN_CLASS = 'hidden';
const BUTTON_SELECTORS = [
  '[data-flag="favorite"]',
  '[data-flag="locked"]',
  '#inventory__ra-manage',
];

let trackedButtons: HTMLButtonElement[] = [];
// installGeneration защищает от race между waitForElement и быстрым enable->disable->enable.
let installGeneration = 0;

function closePopover(): void {
  const popover = document.querySelector<HTMLElement>(POPOVER_SELECTOR);
  if (popover) popover.classList.add(HIDDEN_CLASS);
}

function onActionClick(): void {
  // microtask: пусть нативный обработчик игры (отправка marks или открытие
  // menage-меню) отработает первым. Если закрыть popover синхронно, игра в
  // своём handler делает querySelector внутри popover для обновления иконки -
  // на скрытом элементе это может работать, но class manipulation после нашего
  // hide может привести к конфликту. Микротаск гарантирует порядок.
  void Promise.resolve().then(closePopover);
}

export function installPopoverCloser(): void {
  installGeneration++;
  const myGeneration = installGeneration;

  void waitForElement(POPOVER_SELECTOR).then((popover) => {
    if (myGeneration !== installGeneration) return;
    const buttons = popover.querySelectorAll<HTMLButtonElement>(BUTTON_SELECTORS.join(', '));
    trackedButtons = Array.from(buttons);
    for (const button of trackedButtons) {
      button.addEventListener('click', onActionClick);
    }
  });
}

export function uninstallPopoverCloser(): void {
  installGeneration++;
  for (const button of trackedButtons) {
    button.removeEventListener('click', onActionClick);
  }
  trackedButtons = [];
}
