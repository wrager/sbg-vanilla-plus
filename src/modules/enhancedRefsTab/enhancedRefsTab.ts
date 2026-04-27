import { injectStyles, removeStyles } from '../../core/dom';
import type { IFeatureModule } from '../../core/moduleRegistry';
import styles from './styles.css?inline';

const MODULE_ID = 'enhancedRefsTab';

export const enhancedRefsTab: IFeatureModule = {
  id: MODULE_ID,
  name: { en: 'Enhanced refs tab', ru: 'Улучшенный UI вкладки ключей' },
  description: {
    en: 'Forces 3-line layout for ref cards in the inventory keys tab so card height stays consistent regardless of owner name length',
    ru: 'Принудительно разносит содержимое карточки ключа на 3 строки — высота карточки одинакова независимо от длины имени владельца',
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
