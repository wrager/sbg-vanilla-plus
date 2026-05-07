import { STAR_CENTER_CHANGED_EVENT, clearStarCenter, getStarCenter } from './starCenter';
import { STAR_ICON_SLASH_SVG } from './starCenterIcon';
import { refreshPopupIfStarFilterWasActive } from './starCenterRefresh';
import { showCenterClearedToast } from './starCenterToasts';

const CONTROL_CLASS = 'svp-star-center-clear-control';
const ICON_BUTTON_CLASS = 'svp-star-icon-button';
const REGION_PICKER_SELECTOR = '.region-picker.ol-unselectable.ol-control';

let controlElement: HTMLDivElement | null = null;
let pickerElement: HTMLElement | null = null;
let abortController: AbortController | null = null;
let changeHandler: (() => void) | null = null;
let domObserver: MutationObserver | null = null;
let resizeObserver: ResizeObserver | null = null;
let windowResizeHandler: (() => void) | null = null;
let rafId: number | null = null;

/**
 * Позиционирует control прямо под `.region-picker`. Координаты читаем через
 * getBoundingClientRect() и применяем как position: fixed относительно viewport —
 * это работает независимо от того, как именно игра позиционирует picker (inline
 * style, CSS класс, trasnform и т.д.). getComputedStyle().top не годится: для
 * ol-control с позицией через игровой CSS оно часто возвращает `auto`.
 */
function syncPosition(): void {
  if (!controlElement || !pickerElement) return;
  const rect = pickerElement.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return; // picker скрыт
  // OL-controls в игре выстроены вертикально вплотную (zoom-in / zoom-out /
  // region-picker / ...), без gap. Ставим control сразу под region-picker,
  // чтобы визуально продолжить колонку.
  controlElement.style.top = `${rect.bottom}px`;
  controlElement.style.right = `${window.innerWidth - rect.right}px`;
  controlElement.style.left = 'auto';
  controlElement.style.bottom = 'auto';
}

function applyVisibility(): void {
  if (!controlElement) return;
  controlElement.hidden = getStarCenter() === null;
  if (!controlElement.hidden) syncPosition();
}

function createControl(): HTMLDivElement {
  // Структура 1-в-1 как у `.region-picker` (div.ol-unselectable.ol-control >
  // button), чтобы наследовать игровые стили OL-кнопок. Класс `region-picker`
  // сознательно НЕ добавляем: игра через jQuery навешивает на все `.region-picker`
  // свой click-handler toggle регионов — наш control не должен попасть туда.
  // Внутренняя button получает общий с toggle-кнопкой класс svp-star-icon-button,
  // который задаёт единые размеры/padding для обеих кнопок режима звезды.
  const element = document.createElement('div');
  element.className = `${CONTROL_CLASS} ol-unselectable ol-control`;
  element.style.position = 'fixed';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = ICON_BUTTON_CLASS;
  button.innerHTML = STAR_ICON_SLASH_SVG;
  abortController = new AbortController();
  button.addEventListener(
    'click',
    (event) => {
      event.stopPropagation();
      event.preventDefault();
      const star = getStarCenter();
      const centerBefore = star?.guid ?? null;
      clearStarCenter();
      if (star) showCenterClearedToast(star.name);
      // При снятии центра через map-control попап другой точки может быть
      // открыт - там #draw-count и possible_lines всё ещё показывают
      // отфильтрованный список (только бывший центр). Без перезапроса /api/draw
      // клик "Рисовать" проложит линию на бывший центр, хотя пользователь
      // ожидает свободного выбора. Утилита делает no-op если попап закрыт или
      // открыт попап самого бывшего центра.
      refreshPopupIfStarFilterWasActive(centerBefore);
    },
    { signal: abortController.signal },
  );
  element.appendChild(button);
  return element;
}

function tryAttach(): boolean {
  if (controlElement && controlElement.isConnected) return true;
  const picker = document.querySelector<HTMLElement>(REGION_PICKER_SELECTOR);
  if (!picker) return false;
  // Если игра пересоздала picker (например, при смене режима), наш
  // ResizeObserver наблюдает за DOM-узлом, которого уже нет в дереве.
  // Переподписываемся на свежий picker, чтобы syncPosition реагировал на его
  // resize, а не висел на zombie-ноде.
  const pickerChanged = pickerElement !== null && pickerElement !== picker;
  if (pickerChanged && resizeObserver) {
    resizeObserver.disconnect();
    resizeObserver.observe(picker);
  }
  pickerElement = picker;
  if (!controlElement) controlElement = createControl();
  picker.after(controlElement);
  syncPosition();
  applyVisibility();
  if (typeof ResizeObserver !== 'undefined' && !resizeObserver) {
    resizeObserver = new ResizeObserver(() => {
      syncPosition();
    });
    resizeObserver.observe(picker);
  }
  return true;
}

export function installStarCenterClearControl(): void {
  if (domObserver) return;
  // Наблюдатель отслеживает появление/исчезновение .region-picker - control
  // перевставляется автоматически, если игра пересоздаёт DOM вокруг карты.
  // rAF-debounce: за один тик игра делает много мутаций (ререндер points-layer,
  // обновление виджетов попапа, splide.refresh), без debounce syncPosition с
  // getBoundingClientRect (force layout) вызывается на каждой мутации - дорого.
  // Аналогичный паттерн в settingsUi.ts для reinject configure-button.
  domObserver = new MutationObserver(() => {
    if (rafId !== null) return;
    rafId = requestAnimationFrame(() => {
      rafId = null;
      if (!controlElement || !controlElement.isConnected) {
        tryAttach();
      } else {
        syncPosition();
      }
    });
  });
  domObserver.observe(document.body, { childList: true, subtree: true });
  tryAttach();

  changeHandler = (): void => {
    applyVisibility();
  };
  document.addEventListener(STAR_CENTER_CHANGED_EVENT, changeHandler);

  windowResizeHandler = (): void => {
    syncPosition();
  };
  window.addEventListener('resize', windowResizeHandler);
}

export function uninstallStarCenterClearControl(): void {
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  domObserver?.disconnect();
  domObserver = null;
  resizeObserver?.disconnect();
  resizeObserver = null;
  abortController?.abort();
  abortController = null;
  if (changeHandler) {
    document.removeEventListener(STAR_CENTER_CHANGED_EVENT, changeHandler);
    changeHandler = null;
  }
  if (windowResizeHandler) {
    window.removeEventListener('resize', windowResizeHandler);
    windowResizeHandler = null;
  }
  controlElement?.remove();
  controlElement = null;
  pickerElement = null;
}
