import { waitForElement } from '../../core/dom';
import {
  isFavorited,
  getFavoritesCount,
  addFavorite,
  removeFavorite,
  FAVORITES_CHANGED_EVENT,
} from './favoritesStore';

const FILTER_BAR_CLASS = 'svp-fav-filter-bar';
const FILTER_CHECKBOX_CLASS = 'svp-fav-filter-checkbox';
const FAV_ITEM_CLASS = 'svp-is-fav';
const ITEM_STAR_CLASS = 'svp-inv-item-star';

// Игровой класс «скрыт». Игровая функция getRefsData пропускает элементы с этим
// классом (script.js:2212), что предотвращает шквал /api/point запросов при фильтре.
const GAME_HIDDEN_CLASS = 'hidden';
// Маркер, что мы САМИ установили hidden — чтобы при выключении фильтра снять только
// свои hidden, не трогая те, что игра поставила для других целей.
// ВАЖНО: в названии класса НЕЛЬЗЯ использовать слово "hidden" — игровой regex
// /\b(?:loaded|loading|hidden)\b/ матчит его по границе слова (дефис = не-word char),
// и игра перестаёт подгружать данные для таких элементов даже после снятия game hidden.
const FILTER_MARK_CLASS = 'svp-fav-filtered';

const INVENTORY_CONTENT_SELECTOR = '.inventory__content';
const INVENTORY_POPUP_SELECTOR = '.inventory.popup';
const REFS_TAB = '3';

// Звезда в элементе инвентаря (SVG).
const STAR_SVG = `
<svg viewBox="0 0 576 512" width="16" height="16" aria-hidden="true">
  <path d="M287.9 0c9.2 0 17.6 5.2 21.6 13.5l68.6 141.3 153.2 22.6c9 1.3 16.5 7.6 19.3 16.3s.5 18.1-6 24.5L433.6 328.4l26.2 155.6c1.5 9-2.2 18.1-9.7 23.5s-17.3 6-25.3 1.7l-137-73.2L151 509.1c-8.1 4.3-17.9 3.7-25.3-1.7s-11.2-14.5-9.7-23.5l26.2-155.6L31.1 218.2c-6.5-6.4-8.7-15.9-6-24.5s10.3-15 19.3-16.3l153.2-22.6L266.3 13.5C270.4 5.2 278.7 0 287.9 0z"/>
</svg>
`;

let contentObserver: MutationObserver | null = null;
let popupObserver: MutationObserver | null = null;
let filterBar: HTMLElement | null = null;
let checkbox: HTMLInputElement | null = null;
let countSpan: HTMLSpanElement | null = null;
let changeHandler: (() => void) | null = null;
let filterEnabled = false;

function getCurrentTab(content: Element): string | null {
  return (content as HTMLElement).dataset.tab ?? null;
}

function updateFilterBarVisibility(content: Element): void {
  if (!filterBar) return;
  const isRefsTab = getCurrentTab(content) === REFS_TAB;
  filterBar.classList.toggle('svp-hidden', !isRefsTab);
}

function updateCountLabel(): void {
  if (countSpan) {
    countSpan.textContent = String(getFavoritesCount());
  }
}

async function onItemStarClick(
  event: Event,
  item: HTMLElement,
  starButton: HTMLButtonElement,
): Promise<void> {
  event.stopPropagation();
  event.preventDefault();
  const pointGuid = item.dataset.ref;
  if (!pointGuid) return;
  starButton.disabled = true;
  try {
    if (isFavorited(pointGuid)) {
      await removeFavorite(pointGuid);
    } else {
      await addFavorite(pointGuid);
    }
  } catch (error) {
    console.error('[SVP favoritedPoints] ошибка сохранения избранного:', error);
  } finally {
    starButton.disabled = false;
  }
}

function injectItemStar(item: HTMLElement): void {
  if (item.querySelector(`.${ITEM_STAR_CLASS}`)) return;
  // Вставляем звезду внутрь .inventory__item-left слева от заголовка —
  // чтобы не ломать сетку (grid-template-columns) самого item и не перекрывать
  // кнопку починки справа.
  const leftBlock = item.querySelector('.inventory__item-left');
  if (!leftBlock) return;
  const star = document.createElement('button');
  star.type = 'button';
  star.className = ITEM_STAR_CLASS;
  star.innerHTML = STAR_SVG;
  star.addEventListener('click', (event) => {
    void onItemStarClick(event, item, star);
  });
  leftBlock.insertBefore(star, leftBlock.firstChild);
}

function updateItemStarState(item: HTMLElement): void {
  const star = item.querySelector<HTMLButtonElement>(`.${ITEM_STAR_CLASS}`);
  if (!star) return;
  const pointGuid = item.dataset.ref;
  const favorited = pointGuid !== undefined && isFavorited(pointGuid);
  star.classList.toggle('is-filled', favorited);
  star.setAttribute('aria-pressed', favorited ? 'true' : 'false');
  star.title = favorited ? 'Убрать из избранного' : 'Добавить в избранное';
}

/** Проставляет метки, звезду и скрывает/показывает элементы согласно фильтру. */
function processItems(content: Element): void {
  const items = content.querySelectorAll<HTMLElement>('.inventory__item[data-ref]');
  for (const item of items) {
    const pointGuid = item.dataset.ref;
    const favorited = pointGuid !== undefined && pointGuid !== '' && isFavorited(pointGuid);

    if (favorited) {
      item.classList.add(FAV_ITEM_CLASS);
    } else {
      item.classList.remove(FAV_ITEM_CLASS);
    }

    injectItemStar(item);
    updateItemStarState(item);

    if (filterEnabled && !favorited) {
      item.classList.add(GAME_HIDDEN_CLASS);
      item.classList.add(FILTER_MARK_CLASS);
    } else if (item.classList.contains(FILTER_MARK_CLASS)) {
      item.classList.remove(GAME_HIDDEN_CLASS);
      item.classList.remove(FILTER_MARK_CLASS);
    }
  }
}

function setFilterEnabled(content: Element, enabled: boolean): void {
  filterEnabled = enabled;
  if (checkbox) checkbox.checked = enabled;
  processItems(content);
  // Игра подгружает данные ключей только на событии scroll (script.js:876).
  // После смены фильтра набор видимых ключей меняется — тригерим scroll,
  // чтобы игра запросила данные для ключей, попавших в viewport.
  content.dispatchEvent(new Event('scroll', { bubbles: true }));
}

function createFilterBar(content: Element): HTMLElement {
  const bar = document.createElement('div');
  bar.className = FILTER_BAR_CLASS;

  const label = document.createElement('label');
  label.className = 'svp-fav-filter-label';

  checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = FILTER_CHECKBOX_CLASS;
  checkbox.checked = false;
  checkbox.addEventListener('change', () => {
    setFilterEnabled(content, checkbox?.checked ?? false);
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
}

function onContentMutation(content: Element): void {
  updateFilterBarVisibility(content);
  if (getCurrentTab(content) === REFS_TAB) {
    processItems(content);
    updateCountLabel();
  }
}

function onInventoryPopupMutation(popup: Element, content: Element): void {
  // Попап инвентаря открылся заново — сбросить фильтр.
  if (!popup.classList.contains('hidden')) {
    if (filterEnabled) {
      setFilterEnabled(content, false);
    }
  }
}

function startObserving(content: Element): void {
  ensureFilterBarInjected(content);
  onContentMutation(content);

  contentObserver = new MutationObserver(() => {
    onContentMutation(content);
  });
  contentObserver.observe(content, {
    attributes: true,
    attributeFilter: ['data-tab'],
    childList: true,
  });

  // Сброс состояния чекбокса при каждом новом открытии инвентаря.
  const popup = document.querySelector(INVENTORY_POPUP_SELECTOR);
  if (popup) {
    popupObserver = new MutationObserver(() => {
      onInventoryPopupMutation(popup, content);
    });
    popupObserver.observe(popup, {
      attributes: true,
      attributeFilter: ['class'],
    });
  }

  // Событие из store: пользователь нажал звезду (в попапе или в инвентаре),
  // импорт, отладочный API — обновить метки.
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
  popupObserver?.disconnect();
  popupObserver = null;
  if (changeHandler) {
    document.removeEventListener(FAVORITES_CHANGED_EVENT, changeHandler);
    changeHandler = null;
  }
  filterBar?.remove();
  filterBar = null;
  checkbox = null;
  countSpan = null;
  filterEnabled = false;

  const content = document.querySelector(INVENTORY_CONTENT_SELECTOR);
  if (content) {
    const items = content.querySelectorAll<HTMLElement>('.inventory__item[data-ref]');
    for (const item of items) {
      item.classList.remove(FAV_ITEM_CLASS);
      if (item.classList.contains(FILTER_MARK_CLASS)) {
        item.classList.remove(GAME_HIDDEN_CLASS);
        item.classList.remove(FILTER_MARK_CLASS);
      }
      item.querySelector(`.${ITEM_STAR_CLASS}`)?.remove();
    }
  }
}
