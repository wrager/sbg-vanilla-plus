import type { IFeatureModule } from '../../core/moduleRegistry';
import { injectStyles, removeStyles } from '../../core/dom';
import { loadFavorites } from '../../core/favoritesStore';
import styles from './styles.css?inline';

const MODULE_ID = 'favoritesMigration';

export const favoritesMigration: IFeatureModule = {
  id: MODULE_ID,
  name: {
    en: 'Favorites migration',
    ru: 'Миграция избранного',
  },
  description: {
    en: 'One-time migration of SVP/CUI favorited points into native SBG 0.6.1 favorites/locks. Open module settings for two action buttons.',
    ru: 'Однократная миграция избранных точек SVP/CUI в нативные «звёздочки» и «замочки» SBG 0.6.1. Открой настройки модуля — там две кнопки действия.',
  },
  defaultEnabled: true,
  category: 'utility',

  async init() {
    // Грузим IDB-снимок SVP/CUI-избранных в memory cache: миграция читает его
    // через `getFavoritedGuids()` без повторного await.
    await loadFavorites();
  },

  enable() {
    injectStyles(styles, MODULE_ID);
    // UI миграции добавляется отдельным коммитом — пока модуль виден в
    // настройках, но по клику ничего не делает (placeholder).
  },

  disable() {
    removeStyles(MODULE_ID);
  },
};
