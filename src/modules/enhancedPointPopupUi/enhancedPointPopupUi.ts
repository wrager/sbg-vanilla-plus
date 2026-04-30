import { injectStyles, removeStyles } from '../../core/dom';
import type { IFeatureModule } from '../../core/moduleRegistry';
import styles from './styles.css?inline';

const MODULE_ID = 'enhancedPointPopupUi';

export const enhancedPointPopupUi: IFeatureModule = {
  id: MODULE_ID,
  name: { en: 'Enhanced Point Popup UI', ru: 'Улучшенный UI попапа точки' },
  description: {
    en: 'Larger buttons, smaller text, auto-deploy hidden from accidental taps',
    ru: 'Крупные кнопки, мелкий текст, авто-простановка убрана от случайных нажатий',
  },
  defaultEnabled: true,
  category: 'ui',
  init() {},
  enable() {
    injectStyles(styles, MODULE_ID);
  },
  disable() {
    removeStyles(MODULE_ID);
  },
};
