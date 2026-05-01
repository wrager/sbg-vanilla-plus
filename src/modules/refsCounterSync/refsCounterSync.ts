import type { IFeatureModule } from '../../core/moduleRegistry';
import { syncRefsCountForPoints } from '../../core/refsHighlightSync';

const MODULE_ID = 'refsCounterSync';

const DISCOVER_URL_PATTERN = /\/api\/discover(\?|$)/;
// Задержка перед sync. За это время игра успевает отработать свой continuation
// после `await fetch` и обновить `inventory-cache` (refs/game/script.js:817 -
// `localStorage.setItem('inventory-cache', ...)`). Sync читает кэш как
// источник истины для нового значения highlight['7'], поэтому ждём, пока
// кэш будет актуален.
const DETECTION_DELAY_MS = 100;

let discoverHookEnabled = false;
let discoverFetchInstalled = false;
let originalFetchBeforePatch: typeof window.fetch | null = null;

/**
 * Извлекает guid целевой точки из RequestInit body. /api/discover - POST
 * с JSON-payload `{position, guid, wish}` (refs/game/script.js:797-801).
 * Возвращает null, если body отсутствует, не строка, не парсится или не
 * содержит guid.
 */
function extractDiscoverGuidFromInit(init: RequestInit | undefined): string | null {
  const body = init?.body;
  if (typeof body !== 'string') return null;
  try {
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed === 'object' && parsed !== null && 'guid' in parsed) {
      const guid = (parsed as { guid: unknown }).guid;
      if (typeof guid === 'string') return guid;
    }
  } catch {
    // невалидный JSON - не наш случай.
  }
  return null;
}

function extractUrl(input: RequestInfo | URL): string | null {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  // Request: у него поле `url: string` в DOM lib; null - страховка для моков
  // в тестах, где может прийти неполный объект без url.
  return typeof input.url === 'string' ? input.url : null;
}

/**
 * Ставит monkey-patch на window.fetch один раз за жизнь страницы. Перехват
 * пропускает все запросы кроме /api/discover; для них через DETECTION_DELAY_MS
 * запускает sync счётчика ключей по inventory-cache (источник истины).
 *
 * Срабатывает только пока модуль enabled - флаг проверяется внутри обработчика.
 */
export function installDiscoverFetchHook(): void {
  if (discoverFetchInstalled) return;
  discoverFetchInstalled = true;
  const originalFetch = window.fetch;
  originalFetchBeforePatch = originalFetch;
  window.fetch = function patchedFetch(
    this: typeof window,
    ...args: Parameters<typeof window.fetch>
  ): Promise<Response> {
    const responsePromise = originalFetch.apply(this, args);
    if (!discoverHookEnabled) return responsePromise;
    const url = extractUrl(args[0]);
    if (!url || !DISCOVER_URL_PATTERN.test(url)) return responsePromise;
    const targetGuid = extractDiscoverGuidFromInit(args[1]);
    if (!targetGuid) return responsePromise;
    void responsePromise.then(
      (response) => {
        if (!response.ok) return;
        if (!discoverHookEnabled) return;
        setTimeout(() => {
          if (!discoverHookEnabled) return;
          void syncRefsCountForPoints([targetGuid]);
        }, DETECTION_DELAY_MS);
      },
      () => {
        // Сетевой сбой - игре уже сообщено через rejection основного промиса.
      },
    );
    return responsePromise;
  };
}

/** Тестовый сброс глобального fetch-патча. Только для тестов. */
export function uninstallDiscoverFetchHookForTest(): void {
  if (!discoverFetchInstalled) return;
  if (originalFetchBeforePatch) window.fetch = originalFetchBeforePatch;
  originalFetchBeforePatch = null;
  discoverFetchInstalled = false;
}

export const refsCounterSync: IFeatureModule = {
  id: MODULE_ID,
  name: {
    en: 'Refs counter sync on the map',
    ru: 'Синхронизация счётчика ключей на карте',
  },
  description: {
    en: 'Updates the references counter on the point map label after inventory changes (discover, auto-cleanup, bulk delete).',
    ru: 'Обновляет счётчик ключей на подписи точки на карте после изменений инвентаря (изучение, автоочистка, массовое удаление).',
  },
  defaultEnabled: true,
  category: 'fix',

  init() {},

  enable(): void {
    installDiscoverFetchHook();
    discoverHookEnabled = true;
  },

  disable(): void {
    discoverHookEnabled = false;
  },
};
