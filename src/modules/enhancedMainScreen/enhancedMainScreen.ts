import type { IFeatureModule } from '../../core/moduleRegistry';
import { $, $$, injectStyles, removeStyles, waitForElement } from '../../core/dom';
import css from './styles.css?inline';

const MODULE_ID = 'enhancedMainScreen';

let cleanup: (() => void) | null = null;

function isHTMLElement(element: unknown): element is HTMLElement {
  return element instanceof HTMLElement;
}

/** Заменяет текст кнопки OPS на статус инвентаря «inv/lim» с реактивным обновлением */
function setupOpsInventory(container: Element, opsButton: HTMLElement): { destroy: () => void } {
  const invSpan = $('#self-info__inv', container);
  const limSpan = $('#self-info__inv-lim', container);
  const invEntry = invSpan?.closest('.self-info__entry');
  const originalText = opsButton.textContent;

  const update = () => {
    const inv = invSpan?.textContent ?? '?';
    const lim = limSpan?.textContent ?? '?';
    opsButton.textContent = `${inv}/${lim}`;

    // Цвет переполнения инвентаря (игра ставит color на .self-info__entry)
    if (isHTMLElement(invEntry)) {
      opsButton.style.color = invEntry.style.color;
    }
  };

  update();

  const observer = new MutationObserver(update);
  if (invSpan) observer.observe(invSpan, { childList: true, characterData: true, subtree: true });
  if (limSpan) observer.observe(limSpan, { childList: true, characterData: true, subtree: true });
  if (isHTMLElement(invEntry)) {
    observer.observe(invEntry, { attributes: true, attributeFilter: ['style'] });
  }

  return {
    destroy: () => {
      observer.disconnect();
      opsButton.textContent = originalText;
      opsButton.style.color = '';
    },
  };
}

async function setup(): Promise<() => void> {
  const container = await waitForElement('.topleft-container');
  if (!isHTMLElement(container)) return () => {};
  const selfInfo = $('.self-info', container);
  if (!isHTMLElement(selfInfo)) return () => {};
  const opsButton = $('#ops', container);
  if (!isHTMLElement(opsButton)) return () => {};

  // Reparent оригинального span ника в self-info (сохраняет .profile-link и обработчики)
  const nameSpan = $('#self-info__name', container);
  const nameSpanParent = nameSpan?.parentElement;
  const nameSpanNextSibling = nameSpan?.nextSibling ?? null;

  // Скрываем все записи self-info (ник, опыт, инвентарь, координаты), effects остаётся
  const allEntries = $$('.self-info__entry', container).filter(isHTMLElement);
  const hiddenElements = [...allEntries];

  for (const element of hiddenElements) {
    element.style.display = 'none';
  }

  // Ник — reparent оригинального span прямо в self-info
  if (nameSpan) {
    selfInfo.appendChild(nameSpan);
  }

  // Статус инвентаря → текст кнопки OPS
  const opsInventory = setupOpsInventory(container, opsButton);

  // Переместить game-menu над self-info (меню сверху, ник снизу)
  const gameMenu = $('.game-menu', container);
  if (isHTMLElement(gameMenu)) {
    container.insertBefore(gameMenu, selfInfo);
  }

  // Заменить текст кнопки Settings на символ шестерёнки (text presentation)
  // Убираем data-i18n чтобы система i18n игры не перезаписывала текст
  const settingsButton = $('#settings', container);
  const originalSettingsText = settingsButton?.textContent ?? null;
  const originalSettingsI18n = settingsButton?.getAttribute('data-i18n') ?? null;
  if (isHTMLElement(settingsButton)) {
    settingsButton.textContent = '\u2699\uFE0E';
    settingsButton.removeAttribute('data-i18n');
  }

  container.classList.add('svp-compact');

  return () => {
    opsInventory.destroy();
    // Вернуть текст и data-i18n кнопки Settings
    if (isHTMLElement(settingsButton)) {
      if (originalSettingsText !== null) {
        settingsButton.textContent = originalSettingsText;
      }
      if (originalSettingsI18n !== null) {
        settingsButton.setAttribute('data-i18n', originalSettingsI18n);
      }
    }
    // Вернуть span ника на прежнее место в оригинальной записи
    if (nameSpan && nameSpanParent) {
      if (nameSpanNextSibling) {
        nameSpanParent.insertBefore(nameSpan, nameSpanNextSibling);
      } else {
        nameSpanParent.appendChild(nameSpan);
      }
    }
    // Вернуть game-menu после self-info
    if (isHTMLElement(gameMenu)) {
      selfInfo.after(gameMenu);
    }
    for (const element of hiddenElements) {
      element.style.display = '';
    }
    container.classList.remove('svp-compact');
  };
}

export const enhancedMainScreen: IFeatureModule = {
  id: MODULE_ID,
  name: { en: 'Enhanced Main Screen', ru: 'Улучшенный главный экран' },
  description: {
    en: 'Compacts the player info bar and centers the attack button on the map screen',
    ru: 'Уменьшает панель информации игрока и центрирует кнопку атаки на экране с картой',
  },
  defaultEnabled: true,
  category: 'ui',
  init() {},
  async enable() {
    injectStyles(css, MODULE_ID);
    cleanup = await setup();
  },
  disable() {
    removeStyles(MODULE_ID);
    cleanup?.();
    cleanup = null;
  },
};
