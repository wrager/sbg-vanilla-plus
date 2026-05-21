import { registerOlControl } from '../../core/olControlStack';
import { t } from '../../core/l10n';
import {
  STAR_CENTER_CHANGED_EVENT,
  getStarCenter,
  setStarCenterActive,
} from './starCenter';
import { STAR_ICON_SVG } from './starCenterIcon';
import { refreshPopupIfStarFilterStateChanged } from './starCenterRefresh';
import { showStarModeDisabledToast, showStarModeEnabledToast } from './starCenterToasts';

const CONTROL_CLASS = 'svp-star-center-map-toggle';
// drawTools регистрируется с priority=0 (первый ниже picker'а), наш control - следующий.
const OL_STACK_PRIORITY = 1;

let controlElement: HTMLDivElement | null = null;
let buttonElement: HTMLButtonElement | null = null;
let unregisterOlControl: (() => void) | null = null;
let abortController: AbortController | null = null;
let changeHandler: (() => void) | null = null;

function applyState(): void {
  if (!controlElement || !buttonElement) return;
  const star = getStarCenter();
  // Без запомненного guid кнопка вовсе не показывается: пользователю нечего
  // переключать. Появляется после первого назначения центра через попап.
  controlElement.hidden = star === null;
  const active = star?.active ?? false;
  buttonElement.classList.toggle('is-active', active);
  buttonElement.setAttribute('aria-pressed', active ? 'true' : 'false');
  buttonElement.title = active
    ? t({ en: 'Disable star mode', ru: 'Выключить режим звезды' })
    : t({ en: 'Enable star mode', ru: 'Включить режим звезды' });
}

function onToggleClick(): void {
  const prev = getStarCenter();
  if (prev === null) return; // visibility-guard, теоретически недостижимо
  const nextActive = !prev.active;
  setStarCenterActive(nextActive);
  if (nextActive) showStarModeEnabledToast();
  else showStarModeDisabledToast();
  // Открытый попап другой точки удерживает в closure'е игры старый список
  // целей: при toggle off фильтр перестаёт применяться, #draw-count остаётся
  // с одной звёздной целью, "Рисовать" проложит только её. При toggle on -
  // наоборот, нефильтрованный список становится фильтрованным.
  refreshPopupIfStarFilterStateChanged(prev, { guid: prev.guid, active: nextActive });
}

function createControl(): HTMLDivElement {
  // Структура 1-в-1 как у `.region-picker` (div.ol-unselectable.ol-control >
  // button), чтобы наследовать игровые стили OL-кнопок (background, border,
  // размер). Класс `region-picker` сознательно НЕ добавляем: игра через
  // jQuery навешивает на все `.region-picker` свой click-handler toggle
  // регионов, наш control не должен попасть туда. Размеры/SVG-sizing
  // приходят из общего olControlStack (`.svp-ol-stack-item button`).
  const element = document.createElement('div');
  element.className = `${CONTROL_CLASS} ol-unselectable ol-control`;
  const button = document.createElement('button');
  button.type = 'button';
  button.innerHTML = STAR_ICON_SVG;
  abortController = new AbortController();
  button.addEventListener(
    'click',
    (event) => {
      event.stopPropagation();
      event.preventDefault();
      onToggleClick();
    },
    { signal: abortController.signal },
  );
  element.appendChild(button);
  buttonElement = button;
  return element;
}

export function installStarCenterMapToggle(): void {
  if (controlElement) return;
  controlElement = createControl();
  applyState();
  // Общий стек кнопок под .region-picker: helper расставит элемент по priority,
  // позиционирует через CSS-переменную, реагирует на пересоздание picker'а.
  unregisterOlControl = registerOlControl(OL_STACK_PRIORITY, controlElement);

  changeHandler = (): void => {
    applyState();
  };
  document.addEventListener(STAR_CENTER_CHANGED_EVENT, changeHandler);
}

export function uninstallStarCenterMapToggle(): void {
  unregisterOlControl?.();
  unregisterOlControl = null;
  abortController?.abort();
  abortController = null;
  if (changeHandler) {
    document.removeEventListener(STAR_CENTER_CHANGED_EVENT, changeHandler);
    changeHandler = null;
  }
  controlElement = null;
  buttonElement = null;
}
