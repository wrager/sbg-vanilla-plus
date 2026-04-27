import { injectStyles, removeStyles } from '../../core/dom';
import type { IFeatureModule } from '../../core/moduleRegistry';
import { installRepairButtonOverride, uninstallRepairButtonOverride } from './repairButtonOverride';
import styles from './styles.css?inline';

const MODULE_ID = 'enhancedRefsTab';

export const enhancedRefsTab: IFeatureModule = {
  id: MODULE_ID,
  name: { en: 'Enhanced refs tab', ru: 'Улучшенный UI вкладки ключей' },
  description: {
    en: '3-line layout for ref cards plus disabled repair button at full charge — counterweight to the always-on native button in 0.6.1',
    ru: 'Карточка ключа на 3 фиксированные строки и неактивная кнопка зарядки при полном заряде — компенсирует «всегда активную» нативную кнопку в 0.6.1',
  },
  defaultEnabled: true,
  category: 'ui',
  init() {},
  enable() {
    injectStyles(styles, MODULE_ID);
    installRepairButtonOverride();
  },
  disable() {
    uninstallRepairButtonOverride();
    removeStyles(MODULE_ID);
  },
};
