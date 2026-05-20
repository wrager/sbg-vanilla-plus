import { waitForElement } from '../../core/dom';
import { buildLockedPointGuids, readInventoryCache } from '../../core/inventoryCache';
import { t } from '../../core/l10n';
import {
  STAR_CENTER_CHANGED_EVENT,
  clearStarCenter,
  getStarCenter,
  setStarCenter,
} from './starCenter';
import { STAR_ICON_SVG } from './starCenterIcon';
import { refreshPopupIfStarFilterWasActive } from './starCenterRefresh';
import {
  showCannotSetLockedCenterToast,
  showCenterAssignedToast,
  showCenterClearedToast,
} from './starCenterToasts';

export const TOGGLE_CLASS = 'svp-star-center-btn';
const POPUP_ACTION_BUTTON_CLASS = 'svp-popup-action-button';
const POPUP_SELECTOR = '.info.popup';
const BUTTONS_SELECTOR = '.i-buttons';

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

/**
 * Свежий read inventory-cache при каждом вызове. Кэш не используется:
 * игра меняет lock-bit "f" в-place в JSON-строке (например "f":0 -> "f":2),
 * длина строки и popupGuid не меняются - cache invalidation по этим ключам
 * не ловит изменение. JSON.parse 200KB занимает ~1ms, observer fires при
 * реальных DOM-mutations единицы раз в секунду (filter self-trigger'ов уже
 * закрыл шторм), общая нагрузка незаметна.
 */
function getLockedPointsFor(): Set<string> {
  return buildLockedPointGuids(readInventoryCache());
}

function findToggle(popup: Element): HTMLButtonElement | null {
  return popup.querySelector<HTMLButtonElement>(`.${TOGGLE_CLASS}`);
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

function updateButtons(popup: Element): void {
  const buttons = popup.querySelector(BUTTONS_SELECTOR);
  if (!buttons) return;

  const popupGuid = getCurrentGuid(popup);
  const star = getStarCenter();
  const starCenterGuid = star?.guid ?? null;
  const isCurrentCenter = popupGuid !== null && popupGuid === starCenterGuid;

  // Auto-clear: если текущий центр звезды стал locked во время сессии,
  // снимаем центр с toast. Без этого режим звезды залипал бы на locked-точке
  // (рисовать с неё нельзя, draw-count показывал бы 0 из любого другого
  // попапа). После clearStarCenter STAR_CENTER_CHANGED_EVENT перевызовет
  // updateButtons с обновлённым state (no center), вторая ветка ниже
  // переведёт кнопку в disabled.
  if (isCurrentCenter && popupGuid !== null) {
    const lockedPoints = getLockedPointsFor();
    if (lockedPoints.has(popupGuid)) {
      clearStarCenter();
      showCannotSetLockedCenterToast();
      return;
    }
  }

  let toggle = findToggle(popup);
  if (popupGuid === null) {
    if (toggle) toggle.disabled = true;
  } else {
    if (!toggle) {
      toggle = createButton(TOGGLE_CLASS, STAR_ICON_SVG, () => {
        onToggleClick(popup);
      });
      buttons.appendChild(toggle);
    }
    // Locked-точка (не текущий центр): кнопка disabled. Title объясняет
    // причину. Случай "locked И центр" обработан выше через clearStarCenter +
    // re-render, сюда не доходит.
    const lockedPoints = getLockedPointsFor();
    const isLockedNonCenter = lockedPoints.has(popupGuid) && !isCurrentCenter;
    if (isLockedNonCenter) {
      toggle.disabled = true;
      toggle.classList.remove('is-active');
      toggle.setAttribute('aria-pressed', 'false');
      toggle.title = t({
        en: "Locked point can't be a star center",
        ru: 'Точка с замочком не может быть центром звезды',
      });
    } else {
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
}

function onToggleClick(popup: Element): void {
  const guid = getCurrentGuid(popup);
  if (guid === null) return;
  const star = getStarCenter();
  const centerBefore = star?.guid ?? null;
  if (star?.guid === guid) {
    // Снятие центра через ту же точку, где он назначен.
    // refreshPopupIfStarFilterWasActive увидит popupGuid === centerBefore и
    // сделает no-op: для попапа центра keepByStar не применялся, count
    // корректен сразу.
    clearStarCenter();
    showCenterClearedToast();
    refreshPopupIfStarFilterWasActive(centerBefore);
    return;
  }
  // Safety-net: fresh inventory read при click. Если между updateButtons и
  // click игра обновила lock-флаг (mutation observer не успел fire), это
  // блокирует назначение locked-центра.
  const lockedPoints = getLockedPointsFor();
  if (lockedPoints.has(guid)) {
    showCannotSetLockedCenterToast();
    return;
  }
  setStarCenter(guid);
  showCenterAssignedToast();
  // Назначение нового центра (centerBefore = null) - утилита no-op.
  // Переназначение (centerBefore !== null && popupGuid !== centerBefore) -
  // утилита закрывает попап и переоткрывает через window.showInfo, игра делает
  // свежий /api/draw, drawFilter применяет новые правила (фильтр звезды
  // отключён, т.к. currentPopup = новый center), счётчик и слайдер становятся
  // корректными и синхронными.
  refreshPopupIfStarFilterWasActive(centerBefore);
}

/**
 * Фильтр self-trigger'ов observer'а: updateButtons меняет class на toggle
 * (через classList.toggle/remove), Chrome fires mutation BUTTON.class даже на
 * no-op classList.remove. Без фильтра observer ловит свой же mutation,
 * вызывает updateButtons -> снова меняет class -> infinite loop (100% CPU,
 * зависание страницы). Filter оставляет childList (для перевставки .i-buttons
 * игрой) и attribute-mutations на других элементах (data-guid root popup,
 * class попапа .hidden), отсекает только toggle.
 */
export function hasRelevantMutations(mutations: readonly MutationRecord[]): boolean {
  return mutations.some((m) => {
    if (m.type === 'childList') return true;
    if (m.target instanceof Element && m.target.classList.contains(TOGGLE_CLASS)) {
      return false;
    }
    return true;
  });
}

function startObserving(popup: Element): void {
  updateButtons(popup);

  popupObserver = new MutationObserver((mutations) => {
    if (!hasRelevantMutations(mutations)) return;
    updateButtons(popup);
  });
  // Наблюдаем и за атрибутами попапа (смена data-guid/class), и за subtree —
  // игра пересоздаёт `.i-buttons` при открытии новой точки, наша кнопка
  // должна каждый раз заново вставляться в свежий контейнер.
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
  // Legacy: center may have been assigned in a previous session when the point
  // was unlocked, then the point got a lock between sessions. Clear it now so
  // star mode does not silently show 0 draw targets from all other popups.
  // Low-probability race: inventory-cache may not yet reflect the latest lock
  // state if the user has never loaded inventory in this session.
  const existingGuid = getStarCenter()?.guid ?? null;
  if (existingGuid !== null) {
    const lockedPoints = buildLockedPointGuids(readInventoryCache());
    if (lockedPoints.has(existingGuid)) {
      clearStarCenter();
      showCannotSetLockedCenterToast();
    }
  }
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
