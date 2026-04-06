import { getFavoritedGuids } from '../../core/favoritesStore';
import { showToast } from '../../core/toast';
import { loadFavoritedPointsSettings } from './settings';

const DRAW_URL_PATTERN = /\/api\/draw(?:\?|$)/;

interface IDrawResponseShape {
  data: { p?: string; a?: number }[];
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

function showHideLastFavRefToast(hidden: number): void {
  const noun = hidden === 1 ? 'ключ' : hidden < 5 ? 'ключа' : 'ключей';
  const message = `Скрыт${hidden === 1 ? '' : 'ы'} последн${
    hidden === 1 ? 'ий' : 'ие'
  } ${hidden} ${noun} от избранных точек`;
  showToast(message, 4000);
}

async function filterDrawResponse(response: Response): Promise<Response> {
  const settings = loadFavoritedPointsSettings();
  if (!settings.hideLastFavRef) return response;

  const favorites = getFavoritedGuids();
  if (favorites.size === 0) return response;

  let parsed: unknown;
  try {
    parsed = (await response.clone().json()) as unknown;
  } catch {
    return response;
  }

  if (!isDrawResponseShape(parsed)) return response;

  const originalLength = parsed.data.length;
  parsed.data = parsed.data.filter((entry) => {
    const pointGuid = entry.p;
    const amount = entry.a;
    if (typeof pointGuid !== 'string' || typeof amount !== 'number') return true;
    const isLastFav = favorites.has(pointGuid) && amount === 1;
    return !isLastFav;
  });

  const hidden = originalLength - parsed.data.length;
  if (hidden > 0) {
    showHideLastFavRefToast(hidden);
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

export function installLastRefProtection(): void {
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

export function uninstallLastRefProtection(): void {
  if (!originalFetch) return;
  window.fetch = originalFetch;
  originalFetch = null;
}
