import { injectStyles, removeStyles } from '../../core/dom';
import type { IFeatureModule } from '../../core/moduleRegistry';
import styles from './styles.css?inline';

const MODULE_ID = 'enhancedPointPopupUi';

export const enhancedPointPopupUi: IFeatureModule = {
  id: MODULE_ID,
  name: { en: 'Enhanced point popup UI', ru: 'Улучшенный UI попапа точки' },
  description: {
    en: 'Larger game buttons, smaller metadata text, colored active favorite/lock',
    ru: 'Крупные игровые кнопки, мелкий текст метаданных, подкраска активной звезды и замка',
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
