import { injectStyles, removeStyles } from '../../core/dom';
import type { IFeatureModule } from '../../core/moduleRegistry';
import { installPopoverCloser, uninstallPopoverCloser } from './popoverCloser';
import styles from './styles.css?inline';

const MODULE_ID = 'enhancedRefsTab';

export const enhancedRefsTab: IFeatureModule = {
  id: MODULE_ID,
  name: { en: 'Enhanced refs tab', ru: 'Улучшенный UI вкладки ключей' },
  description: {
    en: '3-line layout for ref cards plus auto-close of the actions popover after Favorite / Lock / Removal menu click',
    ru: 'Карточка ключа на 3 фиксированные строки и авто-закрытие выпадающего меню после клика по Favorite / Lock / Removal menu',
  },
  defaultEnabled: true,
  category: 'ui',
  init() {},
  enable() {
    injectStyles(styles, MODULE_ID);
    installPopoverCloser();
  },
  disable() {
    uninstallPopoverCloser();
    removeStyles(MODULE_ID);
  },
};
