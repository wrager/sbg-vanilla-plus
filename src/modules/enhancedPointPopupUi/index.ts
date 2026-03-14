import { injectStyles, removeStyles } from '../../core/dom';
import type { FeatureModule } from '../../core/moduleRegistry';
import styles from './styles.css?inline';

const MODULE_ID = 'enhancedPointPopupUi';

export const enhancedPointPopupUi: FeatureModule = {
  id: MODULE_ID,
  name: 'Enhanced Point Popup UI',
  description: 'Увеличенные кнопки на экране точки для удобства на мобильных',
  defaultEnabled: true,
  script: 'style',
  init() {},
  enable() {
    injectStyles(styles, MODULE_ID);
  },
  disable() {
    removeStyles(MODULE_ID);
  },
};
