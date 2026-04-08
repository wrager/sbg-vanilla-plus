import { installLastRefProtection, uninstallLastRefProtection } from './lastRefProtection';
import { addFavorite, loadFavorites, resetForTests } from '../../core/favoritesStore';
import { saveFavoritedPointsSettings } from './settings';

async function resetIdb(): Promise<void> {
  resetForTests();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase('CUI');
    request.onsuccess = (): void => {
      resolve();
    };
    request.onerror = (): void => {
      reject(request.error instanceof Error ? request.error : new Error('delete failed'));
    };
    request.onblocked = (): void => {
      resolve();
    };
  });
}

function buildResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

let originalFetch: typeof window.fetch;

beforeEach(async () => {
  await resetIdb();
  await loadFavorites();
  localStorage.removeItem('svp_favoritedPoints');
  originalFetch = window.fetch;
});

afterEach(() => {
  uninstallLastRefProtection();
  window.fetch = originalFetch;
  localStorage.removeItem('svp_favoritedPoints');
});

describe('lastRefProtection', () => {
  test('пропускает запросы не к /api/draw', async () => {
    window.fetch = jest.fn().mockResolvedValue(buildResponse({ data: [{ p: 'fav1', a: 1 }] }));
    await addFavorite('fav1');
    installLastRefProtection();

    const response = await window.fetch('/api/point?guid=x');
    const body = (await response.json()) as { data: unknown[] };
    expect(body.data).toHaveLength(1);
  });

  test('скрывает последний ключ избранной точки из /api/draw', async () => {
    window.fetch = jest.fn().mockResolvedValue(
      buildResponse({
        data: [
          { p: 'fav1', a: 1 },
          { p: 'fav2', a: 3 },
          { p: 'other', a: 1 },
        ],
      }),
    );
    await addFavorite('fav1');
    await addFavorite('fav2');
    installLastRefProtection();

    const response = await window.fetch('/api/draw?from=x');
    const body = (await response.json()) as { data: { p: string; a: number }[] };
    // fav1 с a=1 — последний ключ избранной, скрыт.
    // fav2 с a=3 — не последний, остаётся.
    // other с a=1 — не избранная, остаётся.
    expect(body.data).toHaveLength(2);
    expect(body.data.find((entry) => entry.p === 'fav1')).toBeUndefined();
    expect(body.data.find((entry) => entry.p === 'fav2')).toBeDefined();
    expect(body.data.find((entry) => entry.p === 'other')).toBeDefined();
  });

  test('не скрывает, если hideLastFavRef=false в настройках', async () => {
    saveFavoritedPointsSettings({ version: 1, hideLastFavRef: false });
    window.fetch = jest.fn().mockResolvedValue(buildResponse({ data: [{ p: 'fav1', a: 1 }] }));
    await addFavorite('fav1');
    installLastRefProtection();

    const response = await window.fetch('/api/draw');
    const body = (await response.json()) as { data: unknown[] };
    expect(body.data).toHaveLength(1);
  });

  test('не трогает POST /api/draw (рисование линии)', async () => {
    window.fetch = jest.fn().mockResolvedValue(buildResponse({ line: { id: 123 } }));
    await addFavorite('fav1');
    installLastRefProtection();

    const response = await window.fetch('/api/draw', { method: 'POST' });
    const body = (await response.json()) as { line: { id: number } };
    expect(body.line.id).toBe(123);
  });

  test('не падает при невалидном JSON-ответе', async () => {
    window.fetch = jest.fn().mockResolvedValue(new Response('not json', { status: 200 }));
    installLastRefProtection();
    const response = await window.fetch('/api/draw');
    expect(response.status).toBe(200);
  });

  test('не срабатывает если нет избранных', async () => {
    window.fetch = jest.fn().mockResolvedValue(buildResponse({ data: [{ p: 'p1', a: 1 }] }));
    installLastRefProtection();

    const response = await window.fetch('/api/draw');
    const body = (await response.json()) as { data: unknown[] };
    expect(body.data).toHaveLength(1);
  });

  test('uninstall возвращает оригинальный fetch', async () => {
    const mockFetch = jest.fn().mockResolvedValue(buildResponse({ data: [{ p: 'fav1', a: 1 }] }));
    window.fetch = mockFetch;
    await addFavorite('fav1');
    installLastRefProtection();
    uninstallLastRefProtection();

    expect(window.fetch).toBe(mockFetch);

    const response = await window.fetch('/api/draw');
    const body = (await response.json()) as { data: unknown[] };
    // Без перехвата — элемент не скрыт.
    expect(body.data).toHaveLength(1);
  });

  test('двойная установка не плодит обёртки', () => {
    const mockFetch = jest.fn();
    window.fetch = mockFetch;
    installLastRefProtection();
    const afterFirst = window.fetch;
    installLastRefProtection();
    expect(window.fetch).toBe(afterFirst);
  });
});
