import type { IFeatureModule } from '../../core/moduleRegistry';
import { $, $$, injectStyles, removeStyles, waitForElement } from '../../core/dom';
import css from './styles.css?inline';

const MODULE_ID = 'enhancedMainScreen';

let cleanup: (() => void) | null = null;

function isHTMLElement(element: unknown): element is HTMLElement {
  return element instanceof HTMLElement;
}

/** Переводит текст через глобальный i18next (jQuery-плагин jqueryI18next) */
function retranslateI18n(element: HTMLElement): void {
  // jqueryI18next добавляет .localize() на jQuery-объекты
  const globals = window as unknown as Record<string, unknown>;
  const jq = globals.$;
  if (typeof jq !== 'function') return;
  const wrapped = (jq as (selector: HTMLElement) => unknown)(element);
  if (typeof wrapped !== 'object' || wrapped === null) return;
  const localize = (wrapped as Record<string, unknown>).localize;
  if (typeof localize === 'function') {
    (localize as () => void).call(wrapped);
  }
}

/** Прямой перевод через глобальный i18next.t(), если доступен */
function i18nextTranslate(key: string | null): string | null {
  if (key === null) return null;
  const globals = window as unknown as Record<string, unknown>;
  const i18next = globals.i18next;
  if (typeof i18next !== 'object' || i18next === null) return null;
  const translate = (i18next as Record<string, unknown>).t;
  if (typeof translate !== 'function') return null;
  const result = (translate as (k: string) => unknown).call(i18next, key);
  return typeof result === 'string' ? result : null;
}

/**
 * Восстанавливает исходный текст кнопки и её data-i18n атрибут.
 * Приоритет: свежий перевод через i18next.t() → сохранённый originalText (фолбэк).
 * Дополнительно вызывает jqueryI18next.localize() как страховку, но не полагается на него.
 */
function restoreI18nText(
  element: HTMLElement,
  originalText: string | null,
  i18nKey: string | null,
): void {
  const translated = i18nextTranslate(i18nKey);
  const restored = translated ?? originalText;
  if (restored !== null) {
    element.textContent = restored;
  }
  if (i18nKey !== null) {
    element.setAttribute('data-i18n', i18nKey);
  }
  retranslateI18n(element);
}

/** Заменяет текст кнопки OPS на статус инвентаря «inv/lim» с реактивным обновлением */
function setupOpsInventory(container: Element, opsButton: HTMLElement): { destroy: () => void } {
  const invSpan = $('#self-info__inv', container);
  const limSpan = $('#self-info__inv-lim', container);
  const invEntry = invSpan?.closest('.self-info__entry');

  // Сохраняем оригинальные текст и data-i18n ДО мутации, чтобы на disable
  // откатиться без зависимостей от внешних библиотек.
  const opsOriginalText = opsButton.textContent;
  const opsI18nKey = opsButton.getAttribute('data-i18n');
  opsButton.removeAttribute('data-i18n');

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
      opsButton.style.color = '';
      restoreI18nText(opsButton, opsOriginalText, opsI18nKey);
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
  const settingsOriginalText = settingsButton?.textContent ?? null;
  const settingsI18nKey = settingsButton?.getAttribute('data-i18n') ?? null;
  if (isHTMLElement(settingsButton)) {
    settingsButton.textContent = '\u2699\uFE0E';
    settingsButton.removeAttribute('data-i18n');
  }

  container.classList.add('svp-compact');

  return () => {
    opsInventory.destroy();
    if (isHTMLElement(settingsButton)) {
      restoreI18nText(settingsButton, settingsOriginalText, settingsI18nKey);
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
    en: 'Compacts the top panel: nick below buttons, inventory in OPS, gear icon for Settings, attack button centered',
    ru: 'Компактная верхняя панель: ник под кнопками, инвентарь в ОРПЦ, шестерёнка вместо «Настройки», кнопка атаки по центру',
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
