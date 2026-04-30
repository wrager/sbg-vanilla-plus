import type { IFeatureModule } from '../../core/moduleRegistry';
import { installClickFallback } from '../../core/clickSynthesis';
import { waitForElement } from '../../core/dom';

const MODULE_ID = 'nextPointSwipeFix';
const POPUP_SELECTOR = '.info.popup';

// WeakMap-style на element -> uninstall. Использовать Map чтобы итерироваться
// по элементам при disable (WeakMap не итерируется). Ссылки на DOM-узлы
// держатся, пока модуль активен; на disable все снимаются.
const installedFallbacks = new Map<HTMLButtonElement, () => void>();
let popupObserver: MutationObserver | null = null;
// Защита от race-disable во время await waitForElement: если disable вызвался
// раньше резолва, generation расходится и мы выходим до observe.
let installGeneration = 0;

function applyFallback(button: HTMLButtonElement): void {
  if (installedFallbacks.has(button)) return;
  installedFallbacks.set(button, installClickFallback(button));
}

function applyToAllButtonsIn(root: ParentNode): void {
  for (const button of root.querySelectorAll<HTMLButtonElement>('button')) {
    applyFallback(button);
  }
}

function startObservingPopup(popup: HTMLElement): void {
  // Все существующие кнопки на момент enable.
  applyToAllButtonsIn(popup);

  // Кнопки внутри попапа динамически пересоздаются на каждом showInfo:
  // .i-stat__cores empty+append, deploy_slider.refresh пересоздаёт slides и
  // т. п. Observer догоняет добавление новых button-элементов чтобы fallback
  // покрыл и их.
  popupObserver = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node instanceof HTMLButtonElement) {
          applyFallback(node);
        } else if (node instanceof Element) {
          applyToAllButtonsIn(node);
        }
      }
    }
  });
  popupObserver.observe(popup, { childList: true, subtree: true });
}

export const nextPointSwipeFix: IFeatureModule = {
  id: MODULE_ID,
  name: {
    en: 'Next point swipe fix',
    ru: 'Фикс кнопок после переключения точки',
  },
  description: {
    en: 'Restores click events on point popup buttons that browser probabilistically suppresses after switching to the next point',
    ru: 'Восстанавливает срабатывание кнопок попапа точки после переключения на следующую точку, которые браузер иногда подавляет',
  },
  defaultEnabled: true,
  category: 'fix',
  init() {},
  enable() {
    installGeneration++;
    const myGeneration = installGeneration;
    return waitForElement(POPUP_SELECTOR).then((popup) => {
      if (myGeneration !== installGeneration) return;
      if (!(popup instanceof HTMLElement)) return;
      startObservingPopup(popup);
    });
  },
  disable() {
    installGeneration++;
    popupObserver?.disconnect();
    popupObserver = null;
    for (const uninstall of installedFallbacks.values()) {
      uninstall();
    }
    installedFallbacks.clear();
  },
};
