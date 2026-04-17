import { getFavoritedGuids } from '../../core/favoritesStore';
import { t } from '../../core/l10n';
import { showToast } from '../../core/toast';
import {
  applyPredicates,
  buildPredicates,
  countHiddenByLastKey,
  type IDrawEntry,
} from './filterRules';
import { loadDrawingRestrictionsSettings } from './settings';
import { getStarCenterGuid } from './starCenter';

const POPUP_SELECTOR = '.info.popup';

const DRAW_URL_PATTERN = /\/api\/draw(?:\?|$)/;

interface IDrawResponseShape {
  data: IDrawEntry[];
}

let originalFetch: typeof window.fetch | null = null;

function matchesDrawList(url: string, method: string | undefined): boolean {
  if (!DRAW_URL_PATTERN.test(url)) return false;
  const m = (method ?? 'GET').toUpperCase();
  return m === 'GET';
}

function getUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function getMethod(input: RequestInfo | URL, init: RequestInit | undefined): string | undefined {
  if (init?.method) return init.method;
  if (typeof input !== 'string' && !(input instanceof URL)) return input.method;
  return undefined;
}

function isDrawResponseShape(value: unknown): value is IDrawResponseShape {
  if (typeof value !== 'object' || value === null) return false;
  if (!('data' in value)) return false;
  // as Record — после typeof+null+'data' in; TS не сужает до индексируемого типа.
  const record = value as Record<string, unknown>;
  return Array.isArray(record.data);
}

function showLastKeyToast(hidden: number): void {
  const message = t(
    hidden === 1
      ? {
          en: `Hidden last key from a favorited point`,
          ru: `Скрыт последний ключ от избранной точки`,
        }
      : {
          en: `Hidden last ${hidden} keys from favorited points`,
          ru: `Скрыты последние ${hidden} ${hidden < 5 ? 'ключа' : 'ключей'} от избранных точек`,
        },
  );
  showToast(message, 4000);
}

function getCurrentPopupGuid(): string | null {
  const popup = document.querySelector(POPUP_SELECTOR);
  if (!popup || !(popup instanceof HTMLElement)) return null;
  if (popup.classList.contains('hidden')) return null;
  const guid = popup.dataset.guid;
  return guid && guid.length > 0 ? guid : null;
}

async function filterDrawResponse(response: Response): Promise<Response> {
  const settings = loadDrawingRestrictionsSettings();
  const favorites = getFavoritedGuids();
  const starCenterGuid = getStarCenterGuid();
  const currentPopupGuid = getCurrentPopupGuid();

  const predicates = buildPredicates({
    settings,
    favorites,
    starCenterGuid,
    currentPopupGuid,
  });
  if (predicates.length === 0) return response;

  let parsed: unknown;
  try {
    parsed = (await response.clone().json()) as unknown;
  } catch {
    return response;
  }

  if (!isDrawResponseShape(parsed)) return response;

  const original = parsed.data;
  parsed.data = applyPredicates(original, predicates);

  // Toast только по protectLastKey: остальные ветки скрывают предсказуемо-массово
  // и не требуют точечного уведомления.
  const hiddenLastKey = countHiddenByLastKey(original, favorites, settings.favProtectionMode);
  if (hiddenLastKey > 0) {
    showLastKeyToast(hiddenLastKey);
  }

  const modified = new Response(JSON.stringify(parsed), {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
  // Response.url — read-only, не передаётся через init. Восстанавливаем через
  // defineProperty, чтобы игровой код, проверяющий response.url, не сломался.
  Object.defineProperty(modified, 'url', { value: response.url });
  return modified;
}

export function installDrawFilter(): void {
  if (originalFetch) return;
  originalFetch = window.fetch;
  const native = originalFetch;
  window.fetch = function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url = getUrl(input);
    const method = getMethod(input, init);
    const promise = native.call(this, input, init);
    if (!matchesDrawList(url, method)) return promise;
    return promise.then((response) => filterDrawResponse(response));
  };
}

export function uninstallDrawFilter(): void {
  if (!originalFetch) return;
  window.fetch = originalFetch;
  originalFetch = null;
}
