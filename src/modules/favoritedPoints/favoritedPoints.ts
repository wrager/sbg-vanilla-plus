import type { IFeatureModule } from '../../core/moduleRegistry';
import { loadFavorites } from './favoritesStore';

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
  },

  enable() {
    // UI-интеграции (звезда, фильтр, hideLastFavRef) будут подключены в следующих коммитах.
  },

  disable() {
    // Симметрично enable.
  },
};
