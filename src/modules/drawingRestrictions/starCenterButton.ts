import { waitForElement } from '../../core/dom';
import { t } from '../../core/l10n';
import { findLayerByName, getOlMap } from '../../core/olMap';
import { showToast } from '../../core/toast';
import {
  STAR_CENTER_CHANGED_EVENT,
  clearStarCenter,
  getStarCenter,
  setStarCenter,
} from './starCenter';
import { STAR_ICON_SVG } from './starCenterIcon';

const TOGGLE_CLASS = 'svp-star-center-btn';
const POPUP_ACTION_BUTTON_CLASS = 'svp-popup-action-button';
const NEXT_POINT_CLASS = 'svp-next-point-button';
const POPUP_SELECTOR = '.info.popup';
const BUTTONS_SELECTOR = '.i-buttons';
const POINTS_LAYER_NAME = 'points';

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

function showCenterClearedToast(name: string): void {
  if (name.length === 0) {
    showToast(t({ en: 'Star center cleared', ru: 'Центр звезды снят' }), 3000);
    return;
  }
  showToast(
    t({
      en: `Star center cleared: ${name}`,
      ru: `Центр звезды снят: ${name}`,
    }),
    3000,
  );
}

function showCenterAssignedToast(name: string): void {
  // Формулировка повторяет CUI (onPointPopupOpened): «Точка X выбрана центром
  // для рисования звезды.» — узнаваемость для игроков, пришедших из CUI.
  if (name.length === 0) {
    showToast(
      t({
        en: 'Point selected as star center for drawing.',
        ru: 'Точка выбрана центром для рисования звезды.',
      }),
      3000,
    );
    return;
  }
  showToast(
    t({
      en: `Point "${name}" selected as star center for drawing.`,
      ru: `Точка "${name}" выбрана центром для рисования звезды.`,
    }),
    3000,
  );
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
    // его в toast перед очисткой.
    const name = star.name;
    clearStarCenter();
    showCenterClearedToast(name);
    return;
  }
  // Назначение: достаём имя из feature и сохраняем вместе с GUID.
  const name = await getPointName(guid);
  setStarCenter(guid, name);
  showCenterAssignedToast(name);
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
  document.querySelectorAll(`.${TOGGLE_CLASS}`).forEach((element) => {
    element.remove();
  });
}
