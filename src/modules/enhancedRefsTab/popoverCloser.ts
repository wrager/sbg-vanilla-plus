import { waitForElement } from '../../core/dom';

/**
 * После клика по нативной кнопке Favorite, Lock или Removal menu в попапе
 * `.inventory__ref-actions` (refs/game-beta/dom/body.html:415) сам popover не
 * закрывается - игра вызывает только `apiSend('marks', 'post', ...)` и
 * перерисовывает иконку, а закрытие меню оставляет на пользователя (нужен
 * клик по троеточию ещё раз). UX-фидбек: после действия меню должно
 * скрываться автоматически.
 *
 * Игровой `destroyPopover` (refs/game-beta/script.js:4516) делает три вещи:
 * (1) `popper.classList.add('hidden')`, (2) `Popper.destroy()`, (3)
 * `popovers.ref_actions = null`. Объект `popovers` лежит в IIFE-замыкании
 * игры, прямого доступа нет. Если просто скрыть popover через `hidden`,
 * `popovers.ref_actions` остаётся не-null - и при следующем клике по
 * троеточию игра попадает в свою ветку `else` (destroyPopover закрытого
 * popover'а), сбрасывает state и закрывает его повторно. Видимый эффект -
 * "первый клик троеточия не открывает popover, нужен второй".
 *
 * Решение: симулировать клик по reference-элементу (троеточию), к которому
 * привязан Popper. Игра в своём click-handler троеточия видит активный
 * popover для того же guid и вызывает `destroyPopover` правильно (со
 * сбросом state). Чтобы получить ссылку на reference, перехватываем
 * `window.Popper.createPopper` и сохраняем последний созданный инстанс
 * для нашего popover'а.
 */

const POPOVER_SELECTOR = '.inventory__ref-actions';
const HIDDEN_CLASS = 'hidden';
const BUTTON_SELECTORS = [
  '[data-flag="favorite"]',
  '[data-flag="locked"]',
  '#inventory__ra-manage',
];

interface IPopperInstance {
  destroy: () => void;
  state?: { elements?: { reference?: Element } };
}

interface IPopperGlobal {
  createPopper?: (reference: Element, popper: Element, options?: unknown) => IPopperInstance;
}

let trackedButtons: HTMLButtonElement[] = [];
let currentPopper: IPopperInstance | null = null;
let originalCreatePopper: IPopperGlobal['createPopper'] | null = null;
// installGeneration защищает от race между waitForElement и быстрым enable->disable->enable.
let installGeneration = 0;

function getPopperGlobal(): IPopperGlobal | undefined {
  return (window as unknown as { Popper?: IPopperGlobal }).Popper;
}

function installCreatePopperHook(): void {
  if (originalCreatePopper) return;
  const popperGlobal = getPopperGlobal();
  if (!popperGlobal?.createPopper) return;
  const original = popperGlobal.createPopper;
  originalCreatePopper = original;
  popperGlobal.createPopper = function patched(
    reference: Element,
    popper: Element,
    options?: unknown,
  ): IPopperInstance {
    const instance = original.call(this, reference, popper, options);
    if (popper instanceof HTMLElement && popper.classList.contains('inventory__ref-actions')) {
      currentPopper = instance;
    }
    return instance;
  };
}

function uninstallCreatePopperHook(): void {
  if (!originalCreatePopper) return;
  const popperGlobal = getPopperGlobal();
  if (popperGlobal) popperGlobal.createPopper = originalCreatePopper;
  originalCreatePopper = null;
  currentPopper = null;
}

function closePopover(): void {
  // Через reference: симулируем клик троеточия. Игровой handler видит активный
  // popover для того же guid и вызывает destroyPopover (hidden + Popper.destroy
  // + popovers.ref_actions = null). Так следующий клик троеточия откроет
  // popover с первой попытки.
  const reference = currentPopper?.state?.elements?.reference;
  if (reference instanceof HTMLElement) {
    reference.click();
    return;
  }
  // Fallback: если перехват createPopper не успел поймать инстанс (например,
  // popover уже был открыт до enable модуля), хотя бы скрываем визуально.
  const popover = document.querySelector<HTMLElement>(POPOVER_SELECTOR);
  if (popover) popover.classList.add(HIDDEN_CLASS);
}

function onActionClick(): void {
  // microtask: пусть нативный обработчик игры (отправка marks или открытие
  // manage-меню) отработает первым. Иначе наш закрывающий клик троеточия
  // мог бы запуститься до того, как игра успеет обновить иконку Favorite/Lock
  // в popover'е.
  void Promise.resolve().then(closePopover);
}

export function installPopoverCloser(): void {
  installGeneration++;
  const myGeneration = installGeneration;
  installCreatePopperHook();

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
  uninstallCreatePopperHook();
}
