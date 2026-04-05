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
} from './favoritesStore';

export interface ISvpFavsDebug {
  list: () => string[];
  count: () => number;
  isFav: (guid: string) => boolean;
  add: (guid: string) => Promise<void>;
  remove: (guid: string) => Promise<void>;
  export: () => Promise<string>;
  import: (json: string) => Promise<number>;
  clear: () => Promise<number>;
  tracePointFetches: () => void;
  stopTracePointFetches: () => void;
  printStuckItems: () => void;
  debugViewport: () => void;
}

interface IPointRequestRecord {
  guid: string;
  startedAt: number;
  finishedAt: number | null;
  status: 'pending' | 'ok' | 'error' | 'aborted';
  error?: string;
}

let fetchTrace: IPointRequestRecord[] = [];
let originalFetch: typeof window.fetch | null = null;

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
    tracePointFetches: (): void => {
      if (originalFetch) {
        console.log('[SVP debug] трассировка уже включена');
        return;
      }
      originalFetch = window.fetch;
      fetchTrace = [];
      window.fetch = function (input, init) {
        const url =
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        const match = /\/api\/point\?guid=([a-z0-9.]+)/i.exec(url);
        if (!match || !originalFetch) {
          return originalFetch ? originalFetch.call(this, input, init) : fetch(input, init);
        }
        const guid = match[1];
        const record: IPointRequestRecord = {
          guid,
          startedAt: performance.now(),
          finishedAt: null,
          status: 'pending',
        };
        fetchTrace.push(record);
        console.log(
          `[SVP trace] → /api/point ${guid} (pending=${fetchTrace.filter((r) => r.status === 'pending').length})`,
        );
        return originalFetch.call(this, input, init).then(
          (response) => {
            record.finishedAt = performance.now();
            record.status = 'ok';
            console.log(
              `[SVP trace] ← /api/point ${guid} OK ${Math.round(record.finishedAt - record.startedAt)}ms`,
            );
            return response;
          },
          (error: unknown) => {
            record.finishedAt = performance.now();
            const message = error instanceof Error ? error.message : String(error);
            const name = error instanceof Error ? error.name : '';
            record.status =
              name === 'AbortError' || message.includes('abort') ? 'aborted' : 'error';
            record.error = `${name}: ${message}`;
            console.log(
              `[SVP trace] ✕ /api/point ${guid} ${record.status} ${Math.round(
                record.finishedAt - record.startedAt,
              )}ms: ${record.error}`,
            );
            throw error;
          },
        );
      };
      console.log(
        '[SVP debug] трассировка /api/point включена. Воспроизведи сценарий, потом svpFavs.printStuckItems()',
      );
    },
    stopTracePointFetches: (): void => {
      if (!originalFetch) return;
      window.fetch = originalFetch;
      originalFetch = null;
      console.log('[SVP debug] трассировка /api/point выключена');
    },
    printStuckItems: (): void => {
      const pending = fetchTrace.filter((r) => r.status === 'pending');
      const aborted = fetchTrace.filter((r) => r.status === 'aborted');
      const errored = fetchTrace.filter((r) => r.status === 'error');
      console.group('[SVP debug] итог трассировки /api/point');
      console.log(`Всего запросов: ${fetchTrace.length}`);
      console.log(`  OK: ${fetchTrace.filter((r) => r.status === 'ok').length}`);
      console.log(`  Aborted: ${aborted.length}`);
      console.log(`  Error: ${errored.length}`);
      console.log(`  Pending (незавершённые): ${pending.length}`);
      if (pending.length > 0) {
        console.warn('Висящие запросы (await apiQuery не завершился):');
        for (const record of pending) {
          const age = Math.round(performance.now() - record.startedAt);
          console.warn(`  ${record.guid} — ${age}мс назад`);
        }
      }
      // DOM: какие инвентарь-элементы имеют loading без loaded.
      const stuck = document.querySelectorAll<HTMLElement>(
        '.inventory__item[data-ref].loading:not(.loaded)',
      );
      console.log(`DOM: элементов с классом loading без loaded: ${stuck.length}`);
      for (const item of Array.from(stuck).slice(0, 20)) {
        console.log(`  ${item.dataset.ref ?? '?'} classList=${item.className}`);
      }
      console.groupEnd();
    },
    debugViewport: (): void => {
      const content = document.querySelector<HTMLElement>('.inventory__content');
      if (!content) {
        console.warn('[SVP debug] .inventory__content не найден');
        return;
      }
      const bar = document.querySelector<HTMLElement>('.svp-fav-filter-bar');
      const items = Array.from(
        content.querySelectorAll<HTMLElement>('.inventory__item[data-ref]'),
      );
      console.group('[SVP debug] viewport инвентаря');
      console.log(
        `content: scrollTop=${content.scrollTop}, clientHeight=${content.clientHeight}, scrollHeight=${content.scrollHeight}`,
      );
      console.log(`content.offsetParent:`, content.offsetParent);
      if (bar) {
        console.log(
          `filter bar: height=${bar.offsetHeight}, offsetTop=${bar.offsetTop}, offsetParent=`,
          bar.offsetParent,
        );
      } else {
        console.log('filter bar: не найден');
      }
      console.log(`Всего ключей в DOM: ${items.length}`);
      // Выводим первые 5, последние 5 и все БЕЗ loaded.
      const withoutLoaded = items.filter((item) => !item.classList.contains('loaded'));
      console.log(`Ключей без loaded: ${withoutLoaded.length}`);
      const scrollTop = content.scrollTop;
      const clientHeight = content.clientHeight;
      console.log('Ключи без loaded и их видимость по игровой формуле:');
      for (const item of withoutLoaded) {
        const inRange = item.offsetTop >= scrollTop && item.offsetTop <= scrollTop + clientHeight;
        console.log(
          `  ${item.dataset.ref ?? '?'} offsetTop=${item.offsetTop} parent=${item.offsetParent?.tagName}.${item.offsetParent?.className.split(' ')[0] ?? ''} inRange=${inRange} classes=${item.className}`,
        );
      }
      console.groupEnd();
    },
  };
}

export function uninstallDebugHooks(): void {
  delete window.svpFavs;
}
