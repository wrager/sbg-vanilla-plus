import { injectStyles, removeStyles } from '../../core/dom';
import type { IFeatureModule } from '../../core/moduleRegistry';
import { installPointMarkButtons, uninstallPointMarkButtons } from './pointMarkButtons';
import styles from './styles.css?inline';

const MODULE_ID = 'enhancedPointPopupUi';

export const enhancedPointPopupUi: IFeatureModule = {
  id: MODULE_ID,
  name: { en: 'Enhanced Point Popup UI', ru: 'Улучшенный UI попапа точки' },
  description: {
    en: 'Larger buttons, smaller text, hidden auto-deploy, favorite and lock buttons',
    ru: 'Крупные кнопки, мелкий текст, спрятанная авто-простановка, кнопки звёздочки и замочка',
  },
  defaultEnabled: true,
  category: 'ui',
  init() {},
  enable() {
    injectStyles(styles, MODULE_ID);
    installPointMarkButtons();
  },
  disable() {
    uninstallPointMarkButtons();
    removeStyles(MODULE_ID);
  },
};
