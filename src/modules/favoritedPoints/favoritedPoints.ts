import type { IFeatureModule } from '../../core/moduleRegistry';
import { injectStyles, removeStyles } from '../../core/dom';
import { getFavoritesCount, loadFavorites } from '../../core/favoritesStore';
import { installDebugHooks, uninstallDebugHooks } from './debugHooks';
import { installStarButton, uninstallStarButton } from './starButton';
import { installInventoryFilter, uninstallInventoryFilter } from './inventoryFilter';
import styles from './styles.css?inline';

const MODULE_ID = 'favoritedPoints';

export const favoritedPoints: IFeatureModule = {
  id: MODULE_ID,
  name: {
    en: 'Favorited points',
    ru: 'Избранные точки',
  },
  description: {
    en: 'Mark points with a star — their keys will never be deleted by auto-cleanup. List is shared with CUI.',
    ru: 'Пометить точки звездой — ключи от них не удалит автоочистка. Список шарится с CUI.',
  },
  defaultEnabled: true,
  category: 'utility',

  async init() {
    // Загружаем избранные из IDB в memory cache. init() ждёт асинхронного завершения —
    // inventoryCleanup.enable() вызывается только ПОСЛЕ этого, и видит status='ready'.
    await loadFavorites();
    console.log(`[SVP favoritedPoints] загружено избранных: ${getFavoritesCount()}`);
  },

  enable() {
    injectStyles(styles, MODULE_ID);
    installStarButton();
    installInventoryFilter();
    installDebugHooks();
    console.log('[SVP favoritedPoints] отладочный API доступен в window.svpFavs');
  },

  disable() {
    uninstallStarButton();
    uninstallInventoryFilter();
    removeStyles(MODULE_ID);
    uninstallDebugHooks();
  },
};
