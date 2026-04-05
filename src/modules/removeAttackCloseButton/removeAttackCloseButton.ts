import { injectStyles, removeStyles } from '../../core/dom';
import type { IFeatureModule } from '../../core/moduleRegistry';
import styles from './styles.css?inline';

const MODULE_ID = 'removeAttackCloseButton';

export const removeAttackCloseButton: IFeatureModule = {
  id: MODULE_ID,
  name: { en: 'Remove Attack Close Button', ru: 'Убрать кнопку «Закрыть» в атаке' },
  description: {
    en: 'Removes the Close button in attack mode to avoid hitting it instead of Fire. Tap Attack again to exit',
    ru: 'Убирает кнопку «Закрыть» в режиме атаки, чтобы не нажать её случайно вместо «Огонь!». Выход из режима — повторный клик по кнопке «Атака»',
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
