import { t } from '../../core/l10n';
import { showToast } from '../../core/toast';
import { STAR_CENTER_CHANGED_EVENT, clearStarCenter, getStarCenter } from './starCenter';

const CONTROL_CLASS = 'svp-star-center-clear-control';
const REGION_PICKER_SELECTOR = '.region-picker.ol-unselectable.ol-control';

// Та же иконка, что у кнопки clear в попапе (коммит про UX) — полупрозрачная
// звезда с перечёркнутым крестом. SVG 24x24 встраивается в button 30x30.
const CLEAR_SVG = `
<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
  <g opacity="0.35">
    <circle cx="12" cy="12" r="2.5" fill="currentColor"/>
    <g stroke="currentColor" stroke-width="2.4" stroke-linecap="round" fill="none">
      <line x1="12" y1="2.5" x2="12" y2="7"/>
      <line x1="12" y1="17" x2="12" y2="21.5"/>
      <line x1="2.5" y1="12" x2="7" y2="12"/>
      <line x1="17" y1="12" x2="21.5" y2="12"/>
      <line x1="5.2" y1="5.2" x2="8.4" y2="8.4"/>
      <line x1="15.6" y1="15.6" x2="18.8" y2="18.8"/>
      <line x1="18.8" y1="5.2" x2="15.6" y2="8.4"/>
      <line x1="8.4" y1="15.6" x2="5.2" y2="18.8"/>
    </g>
  </g>
  <g stroke="currentColor" stroke-width="2.6" stroke-linecap="round">
    <line x1="4.5" y1="4.5" x2="19.5" y2="19.5"/>
    <line x1="19.5" y1="4.5" x2="4.5" y2="19.5"/>
  </g>
</svg>
`;

let controlElement: HTMLDivElement | null = null;
let abortController: AbortController | null = null;
let changeHandler: (() => void) | null = null;
let domObserver: MutationObserver | null = null;

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
 * Применяет текущее состояние центра к видимости control. Вызывается при
 * инициализации и при событии svp:star-center-changed.
 */
function updateVisibility(): void {
  if (!controlElement) return;
  const star = getStarCenter();
  controlElement.hidden = star === null;
  controlElement.title =
    star && star.name.length > 0
      ? t({ en: `Clear star center (${star.name})`, ru: `Сбросить центр звезды (${star.name})` })
      : t({ en: 'Clear star center', ru: 'Сбросить центр звезды' });
}

function createControl(): HTMLDivElement {
  // Повторяем структуру `.region-picker.ol-unselectable.ol-control` — тот же
  // внешний <div> с OL-классами + внутренний <button>, — чтобы получить игровой
  // стиль OL-кнопки бесплатно. Класс `region-picker` НЕ добавляем: игра в
  // script.js навешивает через jQuery click-handler на существующие
  // `.region-picker`, и наш элемент не должен в этот список попадать.
  const element = document.createElement('div');
  element.className = `${CONTROL_CLASS} ol-unselectable ol-control`;
  const button = document.createElement('button');
  button.type = 'button';
  button.innerHTML = CLEAR_SVG;
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
  const picker = document.querySelector(REGION_PICKER_SELECTOR);
  if (!picker) return false;
  if (!controlElement) controlElement = createControl();
  // Ставим сразу после region-picker в общий родительский контейнер OL-controls.
  // CSS позиционирует control абсолютно — визуально он появляется под
  // region-picker, с тем же правым отступом.
  picker.after(controlElement);
  updateVisibility();
  return true;
}

export function installStarCenterClearControl(): void {
  if (domObserver) return;
  // region-picker может появиться позже (после инициализации карты), наблюдаем
  // до успешной вставки либо держим observer для переинъекции, если игра
  // пересоздаёт DOM вокруг картографической области.
  if (!tryAttach()) {
    domObserver = new MutationObserver(() => {
      if (tryAttach() && controlElement?.isConnected) {
        // Первая успешная вставка — observer остаётся активным, чтобы
        // перевставить control, если region-picker/control уберут из DOM.
      }
    });
    domObserver.observe(document.body, { childList: true, subtree: true });
  } else {
    // Уже прикреплено — всё же запустим observer на случай перерисовки.
    domObserver = new MutationObserver(() => {
      if (controlElement && !controlElement.isConnected) tryAttach();
    });
    domObserver.observe(document.body, { childList: true, subtree: true });
  }

  changeHandler = (): void => {
    updateVisibility();
  };
  document.addEventListener(STAR_CENTER_CHANGED_EVENT, changeHandler);
}

export function uninstallStarCenterClearControl(): void {
  domObserver?.disconnect();
  domObserver = null;
  abortController?.abort();
  abortController = null;
  if (changeHandler) {
    document.removeEventListener(STAR_CENTER_CHANGED_EVENT, changeHandler);
    changeHandler = null;
  }
  controlElement?.remove();
  controlElement = null;
}
