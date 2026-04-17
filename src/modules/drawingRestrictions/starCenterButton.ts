import { waitForElement } from '../../core/dom';
import { t } from '../../core/l10n';
import {
  STAR_CENTER_CHANGED_EVENT,
  clearStarCenter,
  getStarCenterGuid,
  setStarCenterGuid,
} from './starCenter';

const TOGGLE_CLASS = 'svp-star-center-btn';
const CLEAR_CLASS = 'svp-star-center-clear-btn';
const POPUP_SELECTOR = '.info.popup';
const IMAGE_BOX_SELECTOR = '.i-image-box';

// 5-конечная звезда с точкой в центре — визуально отличает «назначить центром»
// от обычной избранной звезды favoritedPoints.
const TOGGLE_SVG = `
<svg viewBox="0 0 576 512" width="20" height="20" aria-hidden="true">
  <path d="M287.9 0c9.2 0 17.6 5.2 21.6 13.5l68.6 141.3 153.2 22.6c9 1.3 16.5 7.6 19.3 16.3s.5 18.1-6 24.5L433.6 328.4l26.2 155.6c1.5 9-2.2 18.1-9.7 23.5s-17.3 6-25.3 1.7l-137-73.2L151 509.1c-8.1 4.3-17.9 3.7-25.3-1.7s-11.2-14.5-9.7-23.5l26.2-155.6L31.1 218.2c-6.5-6.4-8.7-15.9-6-24.5s10.3-15 19.3-16.3l153.2-22.6L266.3 13.5C270.4 5.2 278.7 0 287.9 0z"/>
  <circle cx="287.9" cy="244" r="46" fill="#fff"/>
</svg>
`;

// Звезда с перечёркиванием (крестик поверх) — «сбросить центр звезды».
const CLEAR_SVG = `
<svg viewBox="0 0 576 512" width="20" height="20" aria-hidden="true">
  <path d="M287.9 0c9.2 0 17.6 5.2 21.6 13.5l68.6 141.3 153.2 22.6c9 1.3 16.5 7.6 19.3 16.3s.5 18.1-6 24.5L433.6 328.4l26.2 155.6c1.5 9-2.2 18.1-9.7 23.5s-17.3 6-25.3 1.7l-137-73.2L151 509.1c-8.1 4.3-17.9 3.7-25.3-1.7s-11.2-14.5-9.7-23.5l26.2-155.6L31.1 218.2c-6.5-6.4-8.7-15.9-6-24.5s10.3-15 19.3-16.3l153.2-22.6L266.3 13.5C270.4 5.2 278.7 0 287.9 0z"/>
  <line x1="96" y1="96" x2="480" y2="480" stroke="#fff" stroke-width="56" stroke-linecap="round"/>
  <line x1="480" y1="96" x2="96" y2="480" stroke="#fff" stroke-width="56" stroke-linecap="round"/>
</svg>
`;

let popupObserver: MutationObserver | null = null;
let clickAbortController: AbortController | null = null;
let changeHandler: (() => void) | null = null;
let installGeneration = 0;

function getCurrentGuid(popup: Element): string | null {
  if (popup.classList.contains('hidden')) return null;
  if (!(popup instanceof HTMLElement)) return null;
  const guid = popup.dataset.guid;
  return guid && guid.length > 0 ? guid : null;
}

function findToggle(popup: Element): HTMLButtonElement | null {
  return popup.querySelector<HTMLButtonElement>(`.${TOGGLE_CLASS}`);
}

function findClear(popup: Element): HTMLButtonElement | null {
  return popup.querySelector<HTMLButtonElement>(`.${CLEAR_CLASS}`);
}

function updateButtons(popup: Element): void {
  const toggle = findToggle(popup);
  const clear = findClear(popup);
  if (!toggle || !clear) return;

  const popupGuid = getCurrentGuid(popup);
  const starCenterGuid = getStarCenterGuid();
  const isCurrentCenter = popupGuid !== null && popupGuid === starCenterGuid;

  if (popupGuid === null) {
    toggle.disabled = true;
    toggle.classList.remove('is-active');
    toggle.title = '';
    clear.disabled = true;
    clear.hidden = true;
    return;
  }

  toggle.disabled = false;
  toggle.classList.toggle('is-active', isCurrentCenter);
  toggle.setAttribute('aria-pressed', isCurrentCenter ? 'true' : 'false');
  toggle.title = isCurrentCenter
    ? t({ en: 'Clear star center', ru: 'Снять центр звезды' })
    : starCenterGuid !== null
      ? t({ en: 'Reassign star center to this point', ru: 'Назначить эту точку центром звезды' })
      : t({ en: 'Set as star center', ru: 'Назначить центром звезды' });

  // Кнопка сброса видна только когда центр назначен И это не текущая точка.
  const clearVisible = starCenterGuid !== null && !isCurrentCenter;
  clear.hidden = !clearVisible;
  clear.disabled = !clearVisible;
  clear.title = clearVisible ? t({ en: 'Clear star center', ru: 'Сбросить центр звезды' }) : '';
}

function onToggleClick(popup: Element): void {
  const guid = getCurrentGuid(popup);
  if (guid === null) return;
  const starCenterGuid = getStarCenterGuid();
  if (guid === starCenterGuid) {
    clearStarCenter();
  } else {
    setStarCenterGuid(guid);
  }
  // Событие svp:star-center-changed само триггерит updateButtons.
}

function onClearClick(popup: Element): void {
  clearStarCenter();
  // popup остаётся открытым, updateButtons пересчитает состояние через listener.
  void popup;
}

function injectButtons(popup: Element): void {
  const imageBox = popup.querySelector(IMAGE_BOX_SELECTOR);
  if (!imageBox) return;
  if (findToggle(popup)) {
    updateButtons(popup);
    return;
  }

  const toggle = document.createElement('button');
  toggle.className = TOGGLE_CLASS;
  toggle.type = 'button';
  toggle.innerHTML = TOGGLE_SVG;

  const clear = document.createElement('button');
  clear.className = CLEAR_CLASS;
  clear.type = 'button';
  clear.innerHTML = CLEAR_SVG;

  clickAbortController = new AbortController();
  toggle.addEventListener(
    'click',
    (event) => {
      event.stopPropagation();
      event.preventDefault();
      onToggleClick(popup);
    },
    { signal: clickAbortController.signal },
  );
  clear.addEventListener(
    'click',
    (event) => {
      event.stopPropagation();
      event.preventDefault();
      onClearClick(popup);
    },
    { signal: clickAbortController.signal },
  );

  // Вставляем ПОСЛЕ кнопки-звёздочки избранного (.svp-fav-star) внутри .i-image-box,
  // чтобы визуально сгруппировать все «точечные» действия.
  const favStar = imageBox.querySelector('.svp-fav-star');
  if (favStar) {
    favStar.after(clear);
    favStar.after(toggle);
  } else {
    imageBox.appendChild(toggle);
    imageBox.appendChild(clear);
  }

  updateButtons(popup);
}

function startObserving(popup: Element): void {
  injectButtons(popup);

  popupObserver = new MutationObserver(() => {
    injectButtons(popup);
  });
  popupObserver.observe(popup, {
    attributes: true,
    attributeFilter: ['class', 'data-guid'],
  });

  changeHandler = (): void => {
    updateButtons(popup);
  };
  document.addEventListener(STAR_CENTER_CHANGED_EVENT, changeHandler);
}

export function installStarCenterButton(): void {
  if (popupObserver) return;
  installGeneration++;
  const generation = installGeneration;
  const existing = document.querySelector(POPUP_SELECTOR);
  if (existing) {
    startObserving(existing);
    return;
  }
  waitForElement(POPUP_SELECTOR)
    .then((popup) => {
      if (generation !== installGeneration) return;
      startObserving(popup);
    })
    .catch((error: unknown) => {
      console.warn('[SVP drawingRestrictions] попап точки не найден:', error);
    });
}

export function uninstallStarCenterButton(): void {
  installGeneration++;
  popupObserver?.disconnect();
  popupObserver = null;
  clickAbortController?.abort();
  clickAbortController = null;
  if (changeHandler) {
    document.removeEventListener(STAR_CENTER_CHANGED_EVENT, changeHandler);
    changeHandler = null;
  }
  document.querySelectorAll(`.${TOGGLE_CLASS}, .${CLEAR_CLASS}`).forEach((element) => {
    element.remove();
  });
}
