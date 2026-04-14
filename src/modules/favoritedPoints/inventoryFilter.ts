import { waitForElement } from '../../core/dom';
import { t } from '../../core/l10n';
import {
  isFavorited,
  getFavoritesCount,
  getFavoritedGuids,
  addFavorite,
  removeFavorite,
  FAVORITES_CHANGED_EVENT,
} from '../../core/favoritesStore';

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

// Максимум параллельных GET /api/point для загрузки данных placeholder'ов.
// При большом списке избранных без ключей (десятки точек) залп одновременных
// запросов перегружал сервер и игровой клиент; очередь растягивает их по
// времени и держит нагрузку предсказуемой.
const MAX_CONCURRENT_POINT_FETCHES = 4;
let activePointFetches = 0;
const pointFetchQueue: (() => void)[] = [];

function scheduleLimitedPointFetch<T>(task: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const run = (): void => {
      activePointFetches++;
      task()
        .then(resolve, reject)
        .finally(() => {
          activePointFetches--;
          const next = pointFetchQueue.shift();
          if (next) next();
        });
    };
    if (activePointFetches < MAX_CONCURRENT_POINT_FETCHES) {
      run();
    } else {
      pointFetchQueue.push(run);
    }
  });
}

// Placeholder для избранных точек без ключей: видны только при активном фильтре.
const PLACEHOLDER_CLASS = 'svp-fav-placeholder';
// Класс loaded предотвращает обработку игровой функцией getRefsData (script.js:2212),
// которая упала бы с TypeError: inventory-cache не содержит записи для этой точки.
const PLACEHOLDER_LOADED_CLASS = 'loaded';
// Заголовок-разделитель над блоком placeholder'ов. Визуально отделяет избранные
// без ключей от списка обычных ключей, чтобы пользователь понимал: на эти точки
// игровой фильтр по фракции не распространяется.
const PLACEHOLDER_HEADER_CLASS = 'svp-fav-placeholder-header';

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
// Инкрементируется при каждом install/uninstall. Если waitForElement.then()
// срабатывает после uninstall (async race), generation уже другой — skip.
let installGeneration = 0;

function getCurrentTab(content: Element): string | null {
  if (!(content instanceof HTMLElement)) return null;
  return content.dataset.tab ?? null;
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
  star.title = favorited
    ? t({ en: 'Remove from favorites', ru: 'Убрать из избранного' })
    : t({ en: 'Add to favorites', ru: 'Добавить в избранное' });
}

/**
 * Обновляет визуальное состояние меток, звёзды. НЕ трогает hidden-классы —
 * это важно для случая, когда пользователь убрал точку из избранного через
 * звезду в инвентаре: элемент не должен мгновенно скрываться, только при
 * следующем переключении фильтра или открытии инвентаря.
 */
function updateItemMarks(content: Element): void {
  const items = content.querySelectorAll<HTMLElement>('.inventory__item[data-ref]');
  for (const item of items) {
    const pointGuid = item.dataset.ref;
    const favorited = pointGuid !== undefined && pointGuid !== '' && isFavorited(pointGuid);
    item.classList.toggle(FAV_ITEM_CLASS, favorited);
    injectItemStar(item);
    updateItemStarState(item);
  }
}

/** Применяет текущее состояние фильтра к классам hidden. */
function applyFilter(content: Element): void {
  const items = content.querySelectorAll<HTMLElement>('.inventory__item[data-ref]');
  for (const item of items) {
    const pointGuid = item.dataset.ref;
    const favorited = pointGuid !== undefined && pointGuid !== '' && isFavorited(pointGuid);
    if (filterEnabled && !favorited) {
      item.classList.add(GAME_HIDDEN_CLASS);
      item.classList.add(FILTER_MARK_CLASS);
    } else if (item.classList.contains(FILTER_MARK_CLASS)) {
      item.classList.remove(GAME_HIDDEN_CLASS);
      item.classList.remove(FILTER_MARK_CLASS);
    }
  }
}

// --- Placeholder'ы для избранных без ключей ---

/** Возвращает Set GUID'ов точек, для которых есть ключи в текущем DOM. */
function getKeyedGuids(content: Element): Set<string> {
  const guids = new Set<string>();
  const items = content.querySelectorAll<HTMLElement>('.inventory__item[data-ref]');
  for (const item of items) {
    if (item.classList.contains(PLACEHOLDER_CLASS)) continue;
    const guid = item.dataset.ref;
    if (guid) guids.add(guid);
  }
  return guids;
}

function createPlaceholderHeader(): HTMLElement {
  const header = document.createElement('div');
  header.className = PLACEHOLDER_HEADER_CLASS;
  header.textContent = t({
    en: 'Favorited points without keys',
    ru: 'Избранные точки без ключей',
  });
  return header;
}

/**
 * Добавляет заголовок перед первым placeholder'ом, если есть хотя бы один
 * и заголовка ещё нет. Удаляет заголовок, если placeholder'ов не осталось.
 */
function syncPlaceholderHeader(content: Element): void {
  const firstPlaceholder = content.querySelector<HTMLElement>(`.${PLACEHOLDER_CLASS}`);
  const existingHeader = content.querySelector<HTMLElement>(`.${PLACEHOLDER_HEADER_CLASS}`);
  if (!firstPlaceholder) {
    existingHeader?.remove();
    return;
  }
  if (existingHeader) {
    // Заголовок должен стоять непосредственно перед первым placeholder'ом —
    // иначе перерисовка игры могла переместить элементы.
    if (existingHeader.nextSibling !== firstPlaceholder) {
      firstPlaceholder.parentElement?.insertBefore(existingHeader, firstPlaceholder);
    }
    return;
  }
  const header = createPlaceholderHeader();
  firstPlaceholder.parentElement?.insertBefore(header, firstPlaceholder);
}

function createPlaceholderItem(pointGuid: string): HTMLElement {
  const item = document.createElement('div');
  item.className = `inventory__item ${PLACEHOLDER_CLASS} ${PLACEHOLDER_LOADED_CLASS}`;
  item.dataset.ref = pointGuid;

  const left = document.createElement('div');
  left.className = 'inventory__item-left';

  const title = document.createElement('span');
  title.className = 'inventory__item-title';
  title.textContent = t({ en: 'Loading…', ru: 'Загрузка…' });

  const description = document.createElement('span');
  description.className = 'inventory__item-descr';
  description.style.fontStyle = 'italic';
  description.textContent = t({ en: 'No keys', ru: 'Нет ключей' });

  left.appendChild(title);
  left.appendChild(description);
  item.appendChild(left);

  return item;
}

interface IPointData {
  title: string;
  level: number;
  team: number;
  owner: string;
  energy: number;
  coresCount: number;
}

async function fetchPointData(pointGuid: string): Promise<IPointData | null> {
  try {
    const url = `/api/point?guid=${encodeURIComponent(pointGuid)}&status=1`;
    const response = await fetch(url);
    if (!response.ok) return null;
    // Формат ответа: { data: { t, te, l, o, e, co, c, gu, ... } }
    // (refs/game/script.js:2233 — getRefsData → response.data)
    const json = (await response.json()) as Record<string, unknown>;
    if (json.error) return null;
    const pointData = json.data as Record<string, unknown> | undefined;
    if (!pointData) return null;
    return {
      title: typeof pointData.t === 'string' ? pointData.t : '',
      level: Number(pointData.l ?? 0),
      team: Number(pointData.te ?? 0),
      owner: typeof pointData.o === 'string' ? pointData.o : '',
      energy: Number(pointData.e ?? 0),
      coresCount: Number(pointData.co ?? 0),
    };
  } catch {
    return null;
  }
}

function populatePlaceholder(item: HTMLElement, data: IPointData): void {
  const title = item.querySelector<HTMLElement>('.inventory__item-title');
  if (title) {
    title.textContent = data.title;
    title.style.color = `var(--team-${data.team})`;
  }
  const description = item.querySelector<HTMLElement>('.inventory__item-descr');
  if (description) {
    const levelSpan = document.createElement('span');
    levelSpan.style.color = `var(--level-${data.level})`;
    levelSpan.textContent = `Level ${data.level}`;

    const ownerSpan = document.createElement('span');
    ownerSpan.style.color = `var(--team-${data.team})`;
    ownerSpan.className = 'profile-link';
    ownerSpan.dataset.name = data.owner;
    ownerSpan.textContent = data.owner || '—';

    description.textContent = '';
    description.style.fontStyle = '';
    description.appendChild(levelSpan);
    description.appendChild(document.createTextNode('; '));
    description.appendChild(ownerSpan);
  }
}

function populatePlaceholderError(item: HTMLElement): void {
  const title = item.querySelector<HTMLElement>('.inventory__item-title');
  if (title) {
    title.textContent = t({ en: 'Failed to load', ru: 'Не удалось загрузить' });
  }
}

/** Создаёт placeholder'ы для избранных точек без ключей и запускает подгрузку данных. */
function injectPlaceholders(content: Element): void {
  const keyedGuids = getKeyedGuids(content);
  const allFavoriteGuids = getFavoritedGuids();

  for (const guid of allFavoriteGuids) {
    if (keyedGuids.has(guid)) continue;
    // Placeholder для этого GUID уже есть (перерисовка при активном фильтре).
    const existingPlaceholders = content.querySelectorAll<HTMLElement>(`.${PLACEHOLDER_CLASS}`);
    let alreadyExists = false;
    for (const existing of existingPlaceholders) {
      if (existing.dataset.ref === guid) {
        alreadyExists = true;
        break;
      }
    }
    if (alreadyExists) continue;

    const placeholder = createPlaceholderItem(guid);
    content.appendChild(placeholder);
    // Звезда инжектируется в processItems → updateItemMarks.
    // Подгрузка данных — fire-and-forget через ограниченную очередь,
    // чтобы N избранных без ключей не породили N параллельных запросов.
    void scheduleLimitedPointFetch(() => fetchPointData(guid)).then((data) => {
      // Placeholder мог быть удалён (фильтр выключен, инвентарь закрыт).
      if (!placeholder.isConnected) return;
      if (data) {
        populatePlaceholder(placeholder, data);
      } else {
        populatePlaceholderError(placeholder);
      }
    });
  }

  syncPlaceholderHeader(content);
}

/** Удаляет все placeholder'ы и заголовок из контейнера. */
function removePlaceholders(content: Element): void {
  const placeholders = content.querySelectorAll(`.${PLACEHOLDER_CLASS}`);
  for (const placeholder of placeholders) {
    placeholder.remove();
  }
  content.querySelector(`.${PLACEHOLDER_HEADER_CLASS}`)?.remove();
}

/** Полный пересчёт: метки + фильтр. Вызывается при смене фильтра/табa/перерисовке. */
function processItems(content: Element): void {
  updateItemMarks(content);
  applyFilter(content);
}

function setFilterEnabled(content: Element, enabled: boolean): void {
  filterEnabled = enabled;
  if (checkbox) checkbox.checked = enabled;
  if (enabled) {
    injectPlaceholders(content);
  } else {
    removePlaceholders(content);
  }
  processItems(content);
  // Сбрасываем скролл на начало списка — при смене фильтра пользователь
  // всегда видит топ релевантного набора ключей, а не зависает на позиции,
  // которая после фильтрации может оказаться в пустоте.
  if (content instanceof HTMLElement) {
    content.scrollTop = 0;
  }
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
  text.textContent = t({ en: 'Only ', ru: 'Только ' });

  const starIcon = document.createElement('span');
  starIcon.className = 'svp-fav-filter-star-icon';
  starIcon.innerHTML =
    '<svg viewBox="0 0 576 512" width="12" height="12" aria-hidden="true">' +
    '<path d="M287.9 0c9.2 0 17.6 5.2 21.6 13.5l68.6 141.3 153.2 22.6c9 1.3 16.5 7.6 19.3 16.3s.5 18.1-6 24.5L433.6 328.4l26.2 155.6c1.5 9-2.2 18.1-9.7 23.5s-17.3 6-25.3 1.7l-137-73.2L151 509.1c-8.1 4.3-17.9 3.7-25.3-1.7s-11.2-14.5-9.7-23.5l26.2-155.6L31.1 218.2c-6.5-6.4-8.7-15.9-6-24.5s10.3-15 19.3-16.3l153.2-22.6L266.3 13.5C270.4 5.2 278.7 0 287.9 0z"/>' +
    '</svg>';

  countSpan = document.createElement('span');
  countSpan.className = 'svp-fav-filter-count';
  updateCountLabel();

  const countWrapper = document.createElement('span');
  countWrapper.appendChild(document.createTextNode('('));
  countWrapper.appendChild(countSpan);
  countWrapper.appendChild(document.createTextNode(')'));

  label.appendChild(checkbox);
  label.appendChild(text);
  label.appendChild(starIcon);
  label.appendChild(countWrapper);

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

/** Реакция на мутации контента (смена таба, перерисовка списка игрой). */
function onContentMutation(content: Element): void {
  updateFilterBarVisibility(content);
  if (getCurrentTab(content) === REFS_TAB) {
    // При перерисовке игрой (childList) наши placeholder'ы удаляются —
    // если фильтр активен, нужно пересоздать их.
    if (filterEnabled) {
      injectPlaceholders(content);
    }
    processItems(content);
    updateCountLabel();
  }
}

/** Реакция на изменение избранных (звезда, debug API). Только метки, не фильтр. */
function onFavoritesChanged(content: Element): void {
  if (getCurrentTab(content) === REFS_TAB) {
    updateItemMarks(content);
  }
  updateCountLabel();
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
  // импорт, отладочный API — обновить ТОЛЬКО метки/звёзды, не перестраивать
  // фильтр (иначе снятая звезда мгновенно скроет элемент из текущего вида).
  changeHandler = () => {
    onFavoritesChanged(content);
  };
  document.addEventListener(FAVORITES_CHANGED_EVENT, changeHandler);
}

export function installInventoryFilter(): void {
  if (contentObserver) return;
  installGeneration++;
  const generation = installGeneration;
  const existing = document.querySelector(INVENTORY_CONTENT_SELECTOR);
  if (existing) {
    startObserving(existing);
    return;
  }
  waitForElement(INVENTORY_CONTENT_SELECTOR)
    .then((content) => {
      if (generation !== installGeneration) return;
      startObserving(content);
    })
    .catch((error: unknown) => {
      console.warn('[SVP favoritedPoints] контейнер инвентаря не найден:', error);
    });
}

export function uninstallInventoryFilter(): void {
  installGeneration++;
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
    removePlaceholders(content);
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
