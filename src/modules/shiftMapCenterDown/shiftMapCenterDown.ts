import type { IFeatureModule } from '../../core/moduleRegistry';
import { injectStyles, removeStyles } from '../../core/dom';

const MODULE_ID = 'shiftMapCenterDown';
const EXTRA_HEIGHT_VH = 40;

const CSS = `#map { height: calc(100% + ${EXTRA_HEIGHT_VH}vh) !important; }`;

function notifyResize(): void {
  window.dispatchEvent(new Event('resize'));
}

export const shiftMapCenterDown: IFeatureModule = {
  id: MODULE_ID,
  name: { en: 'Shift Map Center Down', ru: 'Сдвиг центра карты вниз' },
  description: {
    en: 'Moves map center down so you see more ahead while moving',
    ru: 'Сдвигает центр карты вниз, чтобы видеть больше карты впереди по ходу движения',
  },
  defaultEnabled: true,
  script: 'features',
  init() {
    // no-op
  },
  enable() {
    injectStyles(CSS, MODULE_ID);
    notifyResize();
  },
  disable() {
    removeStyles(MODULE_ID);
    notifyResize();
  },
};
