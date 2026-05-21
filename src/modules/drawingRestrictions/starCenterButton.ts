import { waitForElement } from '../../core/dom';
import { buildLockedPointGuids, readInventoryCache } from '../../core/inventoryCache';
import { t } from '../../core/l10n';
import {
  STAR_CENTER_CHANGED_EVENT,
  clearStarCenter,
  getStarCenter,
  setStarCenter,
  setStarCenterActive,
} from './starCenter';
import { getPointTitleByGuid, resolvePointTitle } from './pointTitle';
import { STAR_ICON_SVG } from './starCenterIcon';
import { refreshPopupIfStarFilterStateChanged } from './starCenterRefresh';
import {
  showCannotSetLockedCenterToast,
  showCenterAssignedToast,
  showCenterClearedBecauseLockedToast,
  showStarModeDisabledToast,
  showStarModeEnabledToast,
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
function readLockedPointGuids(): Set<string> {
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

function pickTitle(
  popupGuid: string | null,
  star: ReturnType<typeof getStarCenter>,
): string {
  if (popupGuid === null) return '';
  const isCurrentCenter = popupGuid === star?.guid;
  if (isCurrentCenter && star.active) {
    return t({ en: 'Disable star mode', ru: 'Выключить режим звезды' });
  }
  if (isCurrentCenter && !star.active) {
    return t({ en: 'Enable star mode', ru: 'Включить режим звезды' });
  }
  if (star !== null) {
    return t({
      en: 'Reassign star center to this point',
      ru: 'Назначить эту точку центром звезды',
    });
  }
  return t({ en: 'Set as star center', ru: 'Назначить центром звезды' });
}

function updateButtons(popup: Element): void {
  const buttons = popup.querySelector(BUTTONS_SELECTOR);
  if (!buttons) return;

  const popupGuid = getCurrentGuid(popup);
  const star = getStarCenter();
  const isCurrentCenter = popupGuid !== null && popupGuid === star?.guid;
  // is-active отражает фактическое применение фильтра к окружению: точка
  // центральная И режим включён. На выключенном центре кнопка отображается
  // тёмной - сигнал "это запомненный центр, фильтр сейчас выключен".
  const showAsActive = isCurrentCenter && star.active;

  // Кнопка всегда enabled при открытом попапе. Проверки locked/enemy
  // перенесены в onToggleClick (click-only) - hot-path observer-callback не
  // парсит inventory-cache и не читает DOM на каждом тике mutations
  // (splide-карусель ключей в попапе может разогнать observer до десятков
  // fires в секунду при анимации). Trade-off: визуальной disabled-подсказки
  // нет, пользователь видит результат через toast при click. Auto-clear
  // центра звезды при locked/enemy change мы не делаем (требовало бы того
  // же hot-path JSON.parse), безопасность обеспечивает click-time safety
  // net в onToggleClick.
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
    toggle.disabled = false;
    toggle.classList.toggle('is-active', showAsActive);
    toggle.setAttribute('aria-pressed', showAsActive ? 'true' : 'false');
    toggle.title = pickTitle(popupGuid, star);
  }
}

function onToggleClick(popup: Element): void {
  const guid = getCurrentGuid(popup);
  if (guid === null) return;
  const prev = getStarCenter();

  // Ветка 1: попап на запомненной точке - toggle активности, guid сохраняется.
  // Полное "забыть центр" из user-facing UX убрано: guid обновляется только
  // при назначении новой точки. Старый guid живёт между сессиями и доступен
  // для возврата через тот же toggle.
  if (prev !== null && prev.guid === guid) {
    const nextActive = !prev.active;
    setStarCenterActive(nextActive);
    const pointTitle = resolvePointTitle(prev);
    if (nextActive) showStarModeEnabledToast(pointTitle);
    else showStarModeDisabledToast(pointTitle);
    refreshPopupIfStarFilterStateChanged(prev, { guid: prev.guid, active: nextActive });
    return;
  }

  // Ветка 2: попап на новой точке - click-only check locked. Нативный
  // замочек блокирует расходование ключей на линии, и из такого центра не
  // вышло бы нарисовать ни одной линии звезды.
  const lockedPoints = readLockedPointGuids();
  if (lockedPoints.has(guid)) {
    showCannotSetLockedCenterToast();
    return;
  }

  // Ветка 3: назначение нового центра - auto-active. Live-имя снимается
  // ДО setStarCenter (попап ещё открыт, #i-title заполнен) и сохраняется в
  // storage - чтобы последующие тосты map-toggle вдали от точки и без
  // открытого попапа всё равно показывали имя.
  const liveTitle = getPointTitleByGuid(guid);
  setStarCenter(guid, liveTitle ?? undefined);
  showCenterAssignedToast(liveTitle);
  refreshPopupIfStarFilterStateChanged(prev, { guid, active: true });
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
    const lockedPoints = readLockedPointGuids();
    if (lockedPoints.has(existingGuid)) {
      clearStarCenter();
      showCenterClearedBecauseLockedToast();
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
