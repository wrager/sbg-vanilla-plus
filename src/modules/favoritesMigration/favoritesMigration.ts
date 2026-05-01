import type { IFeatureModule } from '../../core/moduleRegistry';
import { injectStyles, removeStyles } from '../../core/dom';
import { loadFavorites } from '../../core/favoritesStore';
import { inferAndPersistLockMigrationDone } from './migrationApi';
import { installMigrationUi, uninstallMigrationUi } from './migrationUi';
import styles from './styles.css?inline';

const MODULE_ID = 'favoritesMigration';

export const favoritesMigration: IFeatureModule = {
  id: MODULE_ID,
  name: {
    en: 'Favorites migration',
    ru: 'Миграция избранного',
  },
  description: {
    en: 'Migrates the local SVP/CUI favorited points list into native SBG 0.6.1 favorites or locks. Points without keys in inventory cannot be marked: the native flag lives on the key stack, not on the point as an entity.',
    ru: 'Переносит локальный список избранных точек SVP/CUI в нативные «звёздочки» или «замочки» SBG 0.6.1. Точки без ключей в инвентаре пометить нельзя — нативный флаг живёт на стопке ключей, а не на точке как сущности.',
  },
  defaultEnabled: true,
  category: 'feature',

  async init() {
    // Грузим IDB-снимок SVP/CUI-избранных в memory cache: миграция читает его
    // через `getFavoritedGuids()` без повторного await.
    await loadFavorites();
    // Если пользователь уже мигрировал в native locked в прошлой версии
    // скрипта (когда флаг ещё не писался), но IDB остался непустым -
    // выставляем флаг ретроактивно, чтобы inventoryCleanup перестал
    // блокировать удаление ключей подсказкой "Run favorites migration first".
    inferAndPersistLockMigrationDone();
  },

  enable() {
    injectStyles(styles, MODULE_ID);
    installMigrationUi();
  },

  disable() {
    uninstallMigrationUi();
    removeStyles(MODULE_ID);
  },
};
