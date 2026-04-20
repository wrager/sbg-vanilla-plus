import { waitForElement } from '../../core/dom';
import { t } from '../../core/l10n';
import { findLayerByName, getOlMap } from '../../core/olMap';
import {
  STAR_CENTER_CHANGED_EVENT,
  clearStarCenter,
  getStarCenter,
  setStarCenter,
} from './starCenter';
import { STAR_ICON_SVG } from './starCenterIcon';
import { showCenterAssignedToast, showCenterClearedToast } from './starCenterToasts';

const TOGGLE_CLASS = 'svp-star-center-btn';
const POPUP_ACTION_BUTTON_CLASS = 'svp-popup-action-button';
const NEXT_POINT_CLASS = 'svp-next-point-button';
const POPUP_SELECTOR = '.info.popup';
const POPUP_CLOSE_SELECTOR = '.info .popup-close';
const BUTTONS_SELECTOR = '.i-buttons';
const POINTS_LAYER_NAME = 'points';

let popupObserver: MutationObserver | null = null;
let clickAbortController: AbortController | null = null;
let changeHandler: (() => void) | null = null;
let installGeneration = 0;
// pendingInstall защищает от race `install() → install()` до того как первый
// waitForElement резолвится: синхронный guard `popupObserver !== null`
// недостаточен, потому что observer ставится только в .then(). Без флага оба
// install'а пройдут guard, оба колбэка отвалятся по generation — observer не
// установится вовсе.
let pendingInstall = false;

function getCurrentGuid(popup: Element): string | null {
  if (popup.classList.contains('hidden')) return null;
  if (!(popup instanceof HTMLElement)) return null;
  const guid = popup.dataset.guid;
  return guid && guid.length > 0 ? guid : null;
}

function findToggle(popup: Element): HTMLButtonElement | null {
  return popup.querySelector<HTMLButtonElement>(`.${TOGGLE_CLASS}`);
}

/**
 * Достаёт название точки из features слоя `points`. Проверяет ряд вероятных
 * свойств (`title`, `name`, `label`) — конкретное имя зависит от того, как
 * игра заводит feature. Возвращает пустую строку, если не удалось найти.
 */
async function getPointName(guid: string): Promise<string> {
  try {
    const map = await getOlMap();
    const layer = findLayerByName(map, POINTS_LAYER_NAME);
    const source = layer?.getSource();
    if (!source) return '';
    for (const feature of source.getFeatures()) {
      if (feature.getId() !== guid) continue;
      const candidateKeys = ['title', 'name', 'label'] as const;
      for (const key of candidateKeys) {
        const value = feature.get?.(key);
        if (typeof value === 'string' && value.length > 0) return value;
      }
      const props = feature.getProperties?.();
      if (props) {
        for (const key of candidateKeys) {
          const value = props[key];
          if (typeof value === 'string' && value.length > 0) return value;
        }
      }
      return '';
    }
  } catch (error) {
    console.warn('[SVP drawingRestrictions] не удалось получить имя точки:', error);
  }
  return '';
}

function createButton(
  className: string,
  innerHTML: string,
  onClick: () => void,
): HTMLButtonElement {
  const button = document.createElement('button');
  // svp-popup-action-button — общий класс для всех SVP-кнопок действий в
  // попапе точки (core/popupActionButton.css задаёт единые размер/padding).
  // type="button" не задаём — соседние кнопки в .i-buttons (next-point и
  // игровые Deploy/Discover/Draw) без него, для визуального соответствия
  // полагаемся на тот же default.
  button.className = `${className} ${POPUP_ACTION_BUTTON_CLASS}`;
  button.innerHTML = innerHTML;
  if (!clickAbortController) clickAbortController = new AbortController();
  button.addEventListener(
    'click',
    (event) => {
      event.stopPropagation();
      event.preventDefault();
      onClick();
    },
    { signal: clickAbortController.signal },
  );
  return button;
}

/**
 * Вставить кнопку в `.i-buttons` слева от `.svp-next-point-button` (если есть)
 * либо в конец контейнера.
 */
function insertIntoButtons(buttons: Element, button: HTMLButtonElement): void {
  const nextPoint = buttons.querySelector(`.${NEXT_POINT_CLASS}`);
  if (nextPoint) {
    nextPoint.before(button);
  } else {
    buttons.appendChild(button);
  }
}

function updateButtons(popup: Element): void {
  const buttons = popup.querySelector(BUTTONS_SELECTOR);
  if (!buttons) return;

  const popupGuid = getCurrentGuid(popup);
  const star = getStarCenter();
  const starCenterGuid = star?.guid ?? null;
  const isCurrentCenter = popupGuid !== null && popupGuid === starCenterGuid;

  let toggle = findToggle(popup);
  if (popupGuid === null) {
    if (toggle) toggle.disabled = true;
  } else {
    if (!toggle) {
      toggle = createButton(TOGGLE_CLASS, STAR_ICON_SVG, () => {
        void onToggleClick(popup);
      });
      insertIntoButtons(buttons, toggle);
    }
    toggle.disabled = false;
    toggle.classList.toggle('is-active', isCurrentCenter);
    toggle.setAttribute('aria-pressed', isCurrentCenter ? 'true' : 'false');
    toggle.title = isCurrentCenter
      ? t({ en: 'Clear star center', ru: 'Снять центр звезды' })
      : starCenterGuid !== null
        ? t({ en: 'Reassign star center to this point', ru: 'Назначить эту точку центром звезды' })
        : t({ en: 'Set as star center', ru: 'Назначить центром звезды' });
  }
}

async function onToggleClick(popup: Element): Promise<void> {
  const guid = getCurrentGuid(popup);
  if (guid === null) return;
  const star = getStarCenter();
  if (star?.guid === guid) {
    // Снятие центра через ту же точку, где он назначен. Имя уже в LS — покажем
    // его в toast перед очисткой. #draw-count при этом уже был корректный
    // ([N], т.к. попап центра отключает keepByStar): после снятия фильтр тоже
    // отключён (centerGuid === null), состояние не меняется — переоткрытие
    // попапа не нужно.
    const name = star.name;
    clearStarCenter();
    showCenterClearedToast(name);
    return;
  }
  const wasDifferentCenter = star !== null && star.guid !== guid;
  const name = await getPointName(guid);
  setStarCenter(guid, name);
  showCenterAssignedToast(name);
  if (wasDifferentCenter) {
    // Переназначение центра (был на другой точке → теперь на текущей).
    // `#draw-count` показывает отфильтрованное число из предыдущего /api/draw,
    // `point_state.possible_lines` тоже отражает старый фильтр, но оба закрыты
    // в closure игры — мы не можем их обновить напрямую. Закрываем попап
    // (closePopup ставит `#draw-count = '[N/A]'` и сбрасывает draw-request)
    // и переоткрываем через `window.showInfo(guid)` — игра сделает свежий
    // /api/draw, наш drawFilter применит новые правила (фильтр звезды
    // отключён, т.к. currentPopup = center), счётчик и слайдер станут
    // корректными и синхронными.
    refreshPopupForDrawCounter(guid);
  }
}

/**
 * Закрывает попап точки и переоткрывает его через `window.showInfo(guid)`,
 * чтобы заставить игру сделать свежий `/api/draw`-запрос и обновить
 * `#draw-count` с `point_state.possible_lines` под актуальные правила
 * drawFilter. Используется при переназначении центра звезды через попап
 * другой точки — без этого `#draw-count` остаётся со старым значением.
 *
 * `window.showInfo` экспонируется патчем `src/core/gameScriptPatcher.ts`
 * (вставка `window.showInfo = showInfo` перед `class Bitfield` в теле
 * game-скрипта, см. `refs/game/script.js:1687` для реализации).
 */
function refreshPopupForDrawCounter(popupGuid: string): void {
  const popupClose = document.querySelector<HTMLButtonElement>(POPUP_CLOSE_SELECTOR);
  if (!popupClose) return;
  if (typeof window.showInfo !== 'function') {
    // gameScriptPatcher не применился (устаревший селектор, сетевая ошибка).
    // Тогда закрывать попап смысла нет — пользователь не увидит обновления.
    return;
  }

  // closePopup игры ставит `#draw-count = '[N/A]'` и abort'ит in-flight
  // draw-request — это триггер рефетча при следующем showInfo.
  popupClose.click();

  // showInfo с guid делает apiQuery('point', { guid }) и после его резолва
  // вновь отображает попап + инициирует draw-refetch (наш drawFilter уже
  // видит новый starCenter, поэтому result будет корректным для режима
  // звезды). Передаём guid (string) — ветка с `typeof data === 'string'`.
  window.showInfo(popupGuid);
}

function startObserving(popup: Element): void {
  updateButtons(popup);

  popupObserver = new MutationObserver(() => {
    updateButtons(popup);
  });
  // Наблюдаем и за атрибутами попапа (смена data-guid/class), и за subtree —
  // игра пересоздаёт `.i-buttons` при открытии новой точки, и кнопку
  // `.svp-next-point-button` инжектит отдельный модуль; нам нужно успевать
  // переставляться относительно неё.
  popupObserver.observe(popup, {
    attributes: true,
    attributeFilter: ['class', 'data-guid'],
    childList: true,
    subtree: true,
  });

  changeHandler = (): void => {
    updateButtons(popup);
  };
  document.addEventListener(STAR_CENTER_CHANGED_EVENT, changeHandler);
}

export function installStarCenterButton(): void {
  if (popupObserver || pendingInstall) return;
  installGeneration++;
  const generation = installGeneration;
  const existing = document.querySelector(POPUP_SELECTOR);
  if (existing) {
    startObserving(existing);
    return;
  }
  pendingInstall = true;
  waitForElement(POPUP_SELECTOR)
    .then((popup) => {
      if (generation !== installGeneration) return;
      startObserving(popup);
      pendingInstall = false;
    })
    .catch((error: unknown) => {
      console.warn('[SVP drawingRestrictions] попап точки не найден:', error);
      pendingInstall = false;
    });
}

export function uninstallStarCenterButton(): void {
  installGeneration++;
  pendingInstall = false;
  popupObserver?.disconnect();
  popupObserver = null;
  clickAbortController?.abort();
  clickAbortController = null;
  if (changeHandler) {
    document.removeEventListener(STAR_CENTER_CHANGED_EVENT, changeHandler);
    changeHandler = null;
  }
  document.querySelectorAll(`.${TOGGLE_CLASS}`).forEach((element) => {
    element.remove();
  });
}
