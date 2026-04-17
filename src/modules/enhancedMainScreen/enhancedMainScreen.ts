import type { IFeatureModule } from '../../core/moduleRegistry';
import { $, $$, injectStyles, removeStyles, waitForElement } from '../../core/dom';
import css from './styles.css?inline';

const MODULE_ID = 'enhancedMainScreen';
const HIDDEN_CLASS = 'svp-ems-hidden';
const MOVED_MENU_ATTR = 'data-svp-ems-moved';
const NAME_ORIGIN_CLASS = 'svp-ems-name-origin';
const GEAR_SYMBOL = '\u2699\uFE0E';

interface IRestoreInfo {
  settingsOriginalText: string | null;
  settingsOriginalI18nKey: string | null;
  opsOriginalText: string | null;
  opsOriginalI18nKey: string | null;
}

// Только «ключи восстановления» в замыкании — никаких прямых ссылок на DOM-узлы:
// игра может перестроить .topleft-container между enable и disable, и сохранённые
// ссылки стали бы orphan. Всё восстанавливается поиском по селекторам/маркерам.
let restoreInfo: IRestoreInfo | null = null;
let opsObserverDispose: (() => void) | null = null;

function isHTMLElement(element: unknown): element is HTMLElement {
  return element instanceof HTMLElement;
}

/** Переводит текст через глобальный i18next (jQuery-плагин jqueryI18next) */
function retranslateI18n(element: HTMLElement): void {
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

/**
 * Подписывает текст кнопки #ops на статус инвентаря (inv/lim) через MutationObserver.
 * Сама кнопка ищется по селектору в каждом обновлении — чтобы пережить возможную
 * перестройку топ-панели игрой. observer отстыкуется через возвращаемый dispose.
 */
function installOpsInventoryObserver(container: Element): () => void {
  const invSpan = $('#self-info__inv', container);
  const limSpan = $('#self-info__inv-lim', container);
  const invEntry = invSpan?.closest('.self-info__entry');

  const update = (): void => {
    const opsButton = $('#ops', container);
    if (!isHTMLElement(opsButton)) return;
    const inv = invSpan?.textContent ?? '?';
    const lim = limSpan?.textContent ?? '?';
    opsButton.textContent = `${inv}/${lim}`;
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

  return (): void => {
    observer.disconnect();
  };
}

async function setup(): Promise<void> {
  const container = await waitForElement('.topleft-container');
  if (!isHTMLElement(container)) return;
  const selfInfo = $('.self-info', container);
  if (!isHTMLElement(selfInfo)) return;
  const opsButton = $('#ops', container);
  if (!isHTMLElement(opsButton)) return;

  // Скрываем записи self-info через собственный класс вместо inline display.
  // Восстановление при disable — удаление класса по селектору, без зависимости от
  // сохранённого массива ссылок.
  const allEntries = $$('.self-info__entry', container).filter(isHTMLElement);
  for (const entry of allEntries) {
    entry.classList.add(HIDDEN_CLASS);
  }

  // Reparent ника в self-info. Помечаем исходную запись классом, чтобы disable мог
  // найти «куда возвращать» через селектор, а не через сохранённую ссылку на parent.
  const nameSpan = $('#self-info__name', container);
  if (isHTMLElement(nameSpan)) {
    const origin = nameSpan.closest('.self-info__entry');
    if (isHTMLElement(origin)) {
      origin.classList.add(NAME_ORIGIN_CLASS);
    }
    selfInfo.appendChild(nameSpan);
  }

  // Сохраняем оригинальные текст/ключ кнопки OPS в модульную переменную — без ссылки на узел.
  const opsOriginalText = opsButton.textContent;
  const opsOriginalI18nKey = opsButton.getAttribute('data-i18n');
  opsButton.removeAttribute('data-i18n');

  opsObserverDispose = installOpsInventoryObserver(container);

  // Переместить game-menu над self-info. Маркируем атрибутом для идемпотентного отката.
  const gameMenu = $('.game-menu', container);
  if (isHTMLElement(gameMenu)) {
    gameMenu.setAttribute(MOVED_MENU_ATTR, '1');
    container.insertBefore(gameMenu, selfInfo);
  }

  // Сохраняем оригинальные текст/ключ кнопки Settings и меняем текст на шестерёнку.
  const settingsButton = $('#settings', container);
  let settingsOriginalText: string | null = null;
  let settingsOriginalI18nKey: string | null = null;
  if (isHTMLElement(settingsButton)) {
    settingsOriginalText = settingsButton.textContent;
    settingsOriginalI18nKey = settingsButton.getAttribute('data-i18n');
    settingsButton.textContent = GEAR_SYMBOL;
    settingsButton.removeAttribute('data-i18n');
  }

  container.classList.add('svp-compact');

  restoreInfo = {
    settingsOriginalText,
    settingsOriginalI18nKey,
    opsOriginalText,
    opsOriginalI18nKey,
  };
}

/**
 * Идемпотентный откат. НЕ полагается на ссылки на DOM-узлы, сохранённые при enable:
 * игра может перестроить .topleft-container между enable и disable (SPA-рендер,
 * обновление статуса, мутации i18n-локализатора), и старые ссылки станут мёртвыми.
 * Находим всё по селекторам и откатываем по маркерам (классам, data-атрибутам),
 * оставленным в setup().
 */
function teardown(): void {
  opsObserverDispose?.();
  opsObserverDispose = null;

  const info = restoreInfo;
  restoreInfo = null;

  const container = document.querySelector('.topleft-container');
  if (!isHTMLElement(container)) return;

  container.classList.remove('svp-compact');

  // Снять класс-маркер скрытия. Заодно чистим legacy inline display:none — на случай
  // рестарта после прошлой версии модуля, которая выставляла inline style.
  const hiddenEntries = container.querySelectorAll(`.${HIDDEN_CLASS}`);
  for (const entry of hiddenEntries) {
    entry.classList.remove(HIDDEN_CLASS);
    if (isHTMLElement(entry) && entry.style.display === 'none') {
      entry.style.display = '';
    }
  }
  const allEntries = $$('.self-info__entry', container).filter(isHTMLElement);
  for (const entry of allEntries) {
    if (entry.style.display === 'none') entry.style.display = '';
  }

  // Settings
  const settingsButton = $('#settings', container);
  if (isHTMLElement(settingsButton) && info !== null) {
    const needsRestore =
      settingsButton.textContent === GEAR_SYMBOL ||
      (info.settingsOriginalI18nKey !== null && !settingsButton.hasAttribute('data-i18n'));
    if (needsRestore) {
      restoreI18nText(settingsButton, info.settingsOriginalText, info.settingsOriginalI18nKey);
    }
  }

  // OPS: если текст похож на inventory-статус (что-то/что-то) или потерян data-i18n —
  // восстанавливаем из сохранённого. style.color обнуляем безусловно (наш MutationObserver
  // мог его выставить, и игра не перезапишет сама сразу).
  const opsButton = $('#ops', container);
  if (isHTMLElement(opsButton) && info !== null) {
    const looksLikeInventoryStatus = /^\S+\/\S+$/.test(opsButton.textContent);
    const needsRestore =
      looksLikeInventoryStatus ||
      (info.opsOriginalI18nKey !== null && !opsButton.hasAttribute('data-i18n'));
    if (needsRestore) {
      restoreI18nText(opsButton, info.opsOriginalText, info.opsOriginalI18nKey);
    }
    opsButton.style.color = '';
  }

  // game-menu: вернуть после self-info по маркеру. Снять маркер.
  const movedMenu = container.querySelector(`.game-menu[${MOVED_MENU_ATTR}="1"]`);
  const selfInfo = $('.self-info', container);
  if (isHTMLElement(movedMenu) && isHTMLElement(selfInfo)) {
    selfInfo.after(movedMenu);
  }
  if (isHTMLElement(movedMenu)) {
    movedMenu.removeAttribute(MOVED_MENU_ATTR);
  }

  // Ник: вернуть в оригинальную запись, помеченную классом. Снять класс.
  const nameSpan = $('#self-info__name', container);
  if (isHTMLElement(nameSpan)) {
    const inEntry = nameSpan.closest('.self-info__entry') !== null;
    if (!inEntry) {
      const origin = container.querySelector(`.self-info__entry.${NAME_ORIGIN_CLASS}`);
      if (isHTMLElement(origin)) {
        origin.appendChild(nameSpan);
      }
    }
  }
  const nameOrigins = container.querySelectorAll(`.${NAME_ORIGIN_CLASS}`);
  for (const origin of nameOrigins) {
    origin.classList.remove(NAME_ORIGIN_CLASS);
  }
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
    await setup();
  },
  disable() {
    removeStyles(MODULE_ID);
    teardown();
  },
};
