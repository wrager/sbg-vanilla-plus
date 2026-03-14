import { injectStyles, removeStyles } from '../../../core/dom';
import type { IFeatureModule } from '../../../core/moduleRegistry';
import styles from './styles.css?inline';

const MODULE_ID = 'enhancedPointPopupUi';

export const enhancedPointPopupUi: IFeatureModule = {
  id: MODULE_ID,
  name: { en: 'Enhanced Point Popup UI', ru: 'Улучшенный UI попапа точки' },
  description: {
    en: 'Enlarged buttons on point popup for mobile convenience',
    ru: 'Увеличенные кнопки на экране точки для удобства на мобильных',
  },
  defaultEnabled: true,
  category: 'style',
  init() {},
  enable() {
    injectStyles(styles, MODULE_ID);
  },
  disable() {
    removeStyles(MODULE_ID);
  },
};
