import { waitForElement } from '../../core/dom';
import { isFavorited, getFavoritesCount, FAVORITES_CHANGED_EVENT } from './favoritesStore';

const FILTER_BAR_CLASS = 'svp-fav-filter-bar';
const FILTER_CHECKBOX_CLASS = 'svp-fav-filter-checkbox';
const FILTER_ATTR = 'data-svp-fav-filter';
const FAV_ITEM_CLASS = 'svp-is-fav';

const INVENTORY_CONTENT_SELECTOR = '.inventory__content';
const REFS_TAB = '3';

// Чекбокс хранится в localStorage — чтобы состояние сохранялось между открытиями инвентаря.
const STATE_KEY = 'svp_favFilterEnabled';

let contentObserver: MutationObserver | null = null;
let filterBar: HTMLElement | null = null;
let checkbox: HTMLInputElement | null = null;
let countSpan: HTMLSpanElement | null = null;
let changeHandler: (() => void) | null = null;

function loadFilterState(): boolean {
  return localStorage.getItem(STATE_KEY) === '1';
}

function saveFilterState(enabled: boolean): void {
  if (enabled) {
    localStorage.setItem(STATE_KEY, '1');
  } else {
    localStorage.removeItem(STATE_KEY);
  }
}

function getCurrentTab(content: Element): string | null {
  return (content as HTMLElement).dataset.tab ?? null;
}

/** Проставляет класс избранного на всех видимых ключах. Идемпотентно. */
function markFavoriteItems(content: Element): void {
  const items = content.querySelectorAll<HTMLElement>('.inventory__item[data-ref]');
  for (const item of items) {
    const pointGuid = item.dataset.ref;
    if (pointGuid && isFavorited(pointGuid)) {
      item.classList.add(FAV_ITEM_CLASS);
    } else {
      item.classList.remove(FAV_ITEM_CLASS);
    }
  }
}

function updateFilterBarVisibility(content: Element): void {
  if (!filterBar) return;
  const isRefsTab = getCurrentTab(content) === REFS_TAB;
  filterBar.classList.toggle('svp-hidden', !isRefsTab);
}

function applyFilterAttribute(content: Element, enabled: boolean): void {
  if (enabled) {
    (content as HTMLElement).setAttribute(FILTER_ATTR, '1');
  } else {
    (content as HTMLElement).removeAttribute(FILTER_ATTR);
  }
}

function updateCountLabel(): void {
  if (countSpan) {
    countSpan.textContent = String(getFavoritesCount());
  }
}

function createFilterBar(content: Element): HTMLElement {
  const bar = document.createElement('div');
  bar.className = FILTER_BAR_CLASS;

  const label = document.createElement('label');
  label.className = 'svp-fav-filter-label';

  checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = FILTER_CHECKBOX_CLASS;
  checkbox.checked = loadFilterState();
  checkbox.addEventListener('change', () => {
    const enabled = checkbox?.checked ?? false;
    saveFilterState(enabled);
    applyFilterAttribute(content, enabled);
  });

  const text = document.createElement('span');
  text.textContent = 'Только избранные';

  countSpan = document.createElement('span');
  countSpan.className = 'svp-fav-filter-count';
  updateCountLabel();

  label.appendChild(checkbox);
  label.appendChild(text);
  label.appendChild(document.createTextNode(' ('));
  label.appendChild(countSpan);
  label.appendChild(document.createTextNode(')'));

  bar.appendChild(label);
  return bar;
}

function ensureFilterBarInjected(content: Element): void {
  if (filterBar && filterBar.isConnected) return;
  filterBar = createFilterBar(content);
  // Вставляем перед списком предметов, внутри .inventory (родитель content).
  content.parentElement?.insertBefore(filterBar, content);
  updateFilterBarVisibility(content);
  applyFilterAttribute(content, loadFilterState());
}

function onContentMutation(content: Element): void {
  updateFilterBarVisibility(content);
  if (getCurrentTab(content) === REFS_TAB) {
    markFavoriteItems(content);
    updateCountLabel();
  }
}

function startObserving(content: Element): void {
  ensureFilterBarInjected(content);
  // Первичная проставка классов — если таб уже активен.
  onContentMutation(content);

  contentObserver = new MutationObserver(() => {
    onContentMutation(content);
  });
  // childList — ловит перерисовку списка (drawInventory делает .empty().forEach(createItem)).
  // attributes data-tab — ловит переключение между табами.
  contentObserver.observe(content, {
    attributes: true,
    attributeFilter: ['data-tab'],
    childList: true,
  });

  // Событие из store: пользователь нажал звезду (или отладочный API) — обновить метки.
  changeHandler = () => {
    onContentMutation(content);
  };
  document.addEventListener(FAVORITES_CHANGED_EVENT, changeHandler);
}

export function installInventoryFilter(): void {
  if (contentObserver) return;
  const existing = document.querySelector(INVENTORY_CONTENT_SELECTOR);
  if (existing) {
    startObserving(existing);
    return;
  }
  waitForElement(INVENTORY_CONTENT_SELECTOR)
    .then((content) => {
      startObserving(content);
    })
    .catch((error: unknown) => {
      console.warn('[SVP favoritedPoints] контейнер инвентаря не найден:', error);
    });
}

export function uninstallInventoryFilter(): void {
  contentObserver?.disconnect();
  contentObserver = null;
  if (changeHandler) {
    document.removeEventListener(FAVORITES_CHANGED_EVENT, changeHandler);
    changeHandler = null;
  }
  filterBar?.remove();
  filterBar = null;
  checkbox = null;
  countSpan = null;
  // Убрать атрибут и классы из DOM игры.
  const content = document.querySelector(INVENTORY_CONTENT_SELECTOR);
  if (content) {
    content.removeAttribute(FILTER_ATTR);
    const marked = content.querySelectorAll(`.${FAV_ITEM_CLASS}`);
    for (const item of marked) {
      item.classList.remove(FAV_ITEM_CLASS);
    }
  }
}

/** Вызывать после изменений в избранных, чтобы обновить текущий вид. */
export function refreshInventoryFilter(): void {
  const content = document.querySelector(INVENTORY_CONTENT_SELECTOR);
  if (!content) return;
  if (getCurrentTab(content) === REFS_TAB) {
    markFavoriteItems(content);
  }
  updateCountLabel();
}
