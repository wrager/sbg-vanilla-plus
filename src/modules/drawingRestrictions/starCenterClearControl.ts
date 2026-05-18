import { registerOlControl } from '../../core/olControlStack';
import { STAR_CENTER_CHANGED_EVENT, clearStarCenter, getStarCenter } from './starCenter';
import { STAR_ICON_SLASH_SVG } from './starCenterIcon';
import { refreshPopupIfStarFilterWasActive } from './starCenterRefresh';
import { showCenterClearedToast } from './starCenterToasts';

const CONTROL_CLASS = 'svp-star-center-clear-control';
const ICON_BUTTON_CLASS = 'svp-star-icon-button';
// drawTools регистрируется с priority=0 (первый ниже picker'а), наш control - следующий.
const OL_STACK_PRIORITY = 1;

let controlElement: HTMLDivElement | null = null;
let unregisterOlControl: (() => void) | null = null;
let abortController: AbortController | null = null;
let changeHandler: (() => void) | null = null;

function applyVisibility(): void {
  if (!controlElement) return;
  controlElement.hidden = getStarCenter() === null;
}

function createControl(): HTMLDivElement {
  // Структура 1-в-1 как у `.region-picker` (div.ol-unselectable.ol-control >
  // button), чтобы наследовать игровые стили OL-кнопок. Класс `region-picker`
  // сознательно НЕ добавляем: игра через jQuery навешивает на все
  // `.region-picker` свой click-handler toggle регионов - наш control не
  // должен попасть туда. Внутренняя button получает общий с toggle-кнопкой
  // класс svp-star-icon-button, который задаёт единые размеры/padding для
  // обеих кнопок режима звезды.
  const element = document.createElement('div');
  element.className = `${CONTROL_CLASS} ol-unselectable ol-control`;
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
      if (star) showCenterClearedToast();
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

export function installStarCenterClearControl(): void {
  if (controlElement) return;
  controlElement = createControl();
  applyVisibility();
  // Общий стек кнопок под .region-picker: helper расставит элемент по priority,
  // позиционирует через CSS-переменную, реагирует на пересоздание picker'а.
  unregisterOlControl = registerOlControl(OL_STACK_PRIORITY, controlElement);

  changeHandler = (): void => {
    applyVisibility();
  };
  document.addEventListener(STAR_CENTER_CHANGED_EVENT, changeHandler);
}

export function uninstallStarCenterClearControl(): void {
  unregisterOlControl?.();
  unregisterOlControl = null;
  abortController?.abort();
  abortController = null;
  if (changeHandler) {
    document.removeEventListener(STAR_CENTER_CHANGED_EVENT, changeHandler);
    changeHandler = null;
  }
  controlElement = null;
}
