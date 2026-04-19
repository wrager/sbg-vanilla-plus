import { showToast } from '../../core/toast';
import { t } from '../../core/l10n';
import { STAR_CENTER_CHANGED_EVENT, clearStarCenter, getStarCenter } from './starCenter';

const CONTROL_CLASS = 'svp-star-center-clear-control';
const REGION_PICKER_SELECTOR = '.region-picker.ol-unselectable.ol-control';

// Asterisk, визуально как `fa-solid-asterisk` (иконка режима звезды в CUI).
// FA-классы напрямую использовать нельзя — FontAwesome в игре подгружает CUI;
// без CUI наш символ не отобразится. Берём готовый SVG-путь из FontAwesome
// Free 6 (asterisk, solid).
const ASTERISK_SVG = `
<svg viewBox="0 0 512 512" width="20" height="20" aria-hidden="true">
  <path fill="currentColor" d="M320 48C320 21.5 298.5 0 272 0L240 0C213.5 0 192 21.5 192 48L192 192L65.6 140C41.1 131 14 143.4 5 167.9C-4 192.4 8.4 219.5 32.9 228.5L159.2 280.5L60.3 389.5C42.4 408.8 43.7 438.9 63 456.8C82.3 474.7 112.4 473.4 130.3 454.1L256 316.5L381.7 454.1C399.6 473.4 429.7 474.7 449 456.8C468.3 438.9 469.6 408.8 451.7 389.5L352.8 280.5L479.1 228.5C503.6 219.5 516 192.4 507 167.9C498 143.4 470.9 131 446.4 140L320 192L320 48z"/>
</svg>
`;

let controlElement: HTMLDivElement | null = null;
let pickerElement: HTMLElement | null = null;
let abortController: AbortController | null = null;
let changeHandler: (() => void) | null = null;
let domObserver: MutationObserver | null = null;
let resizeObserver: ResizeObserver | null = null;

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

/**
 * Позиционирует control прямо под `.region-picker`. CSS у региона-пикера задан
 * игрой (нам недоступен как константа), поэтому читаем в runtime: computedTop
 * + offsetHeight + gap. То же значение `right` наследуется 1-в-1 — визуально
 * кнопка смотрится как продолжение picker вниз.
 */
function syncPosition(): void {
  if (!controlElement || !pickerElement) return;
  const computed = getComputedStyle(pickerElement);
  const top = parseFloat(computed.top);
  const height = pickerElement.offsetHeight || 32;
  const gap = 8;
  if (!Number.isNaN(top)) {
    controlElement.style.top = `${top + height + gap}px`;
  }
  // right/left тянем 1-в-1 у picker — чтобы control стоял строго под ней.
  if (computed.right && computed.right !== 'auto') {
    controlElement.style.right = computed.right;
  }
  if (computed.left && computed.left !== 'auto') {
    controlElement.style.left = computed.left;
  }
  controlElement.style.position = 'absolute';
}

function applyVisibility(): void {
  if (!controlElement) return;
  controlElement.hidden = getStarCenter() === null;
}

function createControl(): HTMLDivElement {
  // Структура 1-в-1 как у `.region-picker` (div.ol-unselectable.ol-control >
  // button), чтобы наследовать игровые стили OL-кнопок. Класс `region-picker`
  // сознательно НЕ добавляем: игра через jQuery навешивает на все `.region-picker`
  // свой click-handler toggle регионов — наш control не должен туда попасть.
  const element = document.createElement('div');
  element.className = `${CONTROL_CLASS} ol-unselectable ol-control`;
  const button = document.createElement('button');
  button.type = 'button';
  button.innerHTML = ASTERISK_SVG;
  abortController = new AbortController();
  button.addEventListener(
    'click',
    (event) => {
      event.stopPropagation();
      event.preventDefault();
      const star = getStarCenter();
      clearStarCenter();
      if (star) showCenterClearedToast(star.name);
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
  pickerElement = picker;
  if (!controlElement) controlElement = createControl();
  // Вставляем в общий с picker родительский контейнер OL-controls.
  picker.after(controlElement);
  syncPosition();
  applyVisibility();
  // Следим за изменениями размера picker (resize viewport, переориентация).
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
  // Наблюдатель отслеживает появление/исчезновение .region-picker — control
  // перевставляется автоматически, если игра пересоздаёт DOM вокруг карты.
  domObserver = new MutationObserver(() => {
    if (!controlElement || !controlElement.isConnected) tryAttach();
    else syncPosition();
  });
  domObserver.observe(document.body, { childList: true, subtree: true });
  tryAttach();

  changeHandler = (): void => {
    applyVisibility();
  };
  document.addEventListener(STAR_CENTER_CHANGED_EVENT, changeHandler);
}

export function uninstallStarCenterClearControl(): void {
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
  controlElement?.remove();
  controlElement = null;
  pickerElement = null;
}
