// Отладочные хуки в window.svpFavs — чтобы тестировать хранилище избранных
// до появления UI. Удалить этот модуль, когда появится полноценный UI.

import {
  getFavoritedGuids,
  getFavoritesCount,
  isFavorited,
  addFavorite,
  removeFavorite,
  exportToJson,
  importFromJson,
} from '../../core/favoritesStore';

export interface ISvpFavsDebug {
  list: () => string[];
  count: () => number;
  isFav: (guid: string) => boolean;
  add: (guid: string) => Promise<void>;
  remove: (guid: string) => Promise<void>;
  export: () => Promise<string>;
  import: (json: string) => Promise<number>;
  clear: () => Promise<number>;
}

declare global {
  interface Window {
    svpFavs?: ISvpFavsDebug;
  }
}

export function installDebugHooks(): void {
  window.svpFavs = {
    list: () => Array.from(getFavoritedGuids()),
    count: () => getFavoritesCount(),
    isFav: (guid: string) => isFavorited(guid),
    add: async (guid: string) => {
      await addFavorite(guid);
      console.log(`[SVP favoritedPoints] добавлено: ${guid}`);
    },
    remove: async (guid: string) => {
      await removeFavorite(guid);
      console.log(`[SVP favoritedPoints] удалено: ${guid}`);
    },
    export: exportToJson,
    import: async (json: string) => {
      const count = await importFromJson(json);
      console.log(`[SVP favoritedPoints] импортировано записей: ${count}`);
      return count;
    },
    clear: async () => {
      const guids = Array.from(getFavoritedGuids());
      for (const guid of guids) {
        await removeFavorite(guid);
      }
      console.log(`[SVP favoritedPoints] очищено записей: ${guids.length}`);
      return guids.length;
    },
  };
}

export function uninstallDebugHooks(): void {
  delete window.svpFavs;
}
