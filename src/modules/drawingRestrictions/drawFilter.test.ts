import { installDrawFilter, uninstallDrawFilter } from './drawFilter';
import { addFavorite, loadFavorites, resetForTests } from '../../core/favoritesStore';
import { saveDrawingRestrictionsSettings } from './settings';
import { clearStarCenter, setStarCenterGuid } from './starCenter';

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

function createPopup(guid: string, hidden = false): HTMLElement {
  const popup = document.createElement('div');
  popup.className = hidden ? 'info popup hidden' : 'info popup';
  popup.dataset.guid = guid;
  document.body.appendChild(popup);
  return popup;
}

beforeEach(async () => {
  await resetIdb();
  await loadFavorites();
  localStorage.clear();
  clearStarCenter();
  localStorage.clear();
  originalFetch = window.fetch;
  document.body.innerHTML = '';
});

afterEach(() => {
  uninstallDrawFilter();
  window.fetch = originalFetch;
  localStorage.clear();
  document.body.innerHTML = '';
});

describe('drawFilter', () => {
  test('пропускает запросы не к /api/draw', async () => {
    saveDrawingRestrictionsSettings({
      version: 1,
      favProtectionMode: 'protectLastKey',
      maxDistanceMeters: 0,
    });
    window.fetch = jest.fn().mockResolvedValue(buildResponse({ data: [{ p: 'fav1', a: 1 }] }));
    await addFavorite('fav1');
    installDrawFilter();

    const response = await window.fetch('/api/point?guid=x');
    const body = (await response.json()) as { data: unknown[] };
    expect(body.data).toHaveLength(1);
  });

  test('protectLastKey скрывает последний ключ избранной точки', async () => {
    saveDrawingRestrictionsSettings({
      version: 1,
      favProtectionMode: 'protectLastKey',
      maxDistanceMeters: 0,
    });
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
    installDrawFilter();

    const response = await window.fetch('/api/draw?from=x');
    const body = (await response.json()) as { data: { p: string; a: number }[] };
    expect(body.data).toHaveLength(2);
    expect(body.data.find((entry) => entry.p === 'fav1')).toBeUndefined();
  });

  test('hideAllFavorites скрывает все избранные независимо от amount', async () => {
    saveDrawingRestrictionsSettings({
      version: 1,
      favProtectionMode: 'hideAllFavorites',
      maxDistanceMeters: 0,
    });
    window.fetch = jest.fn().mockResolvedValue(
      buildResponse({
        data: [
          { p: 'fav1', a: 1 },
          { p: 'fav2', a: 5 },
          { p: 'other', a: 2 },
        ],
      }),
    );
    await addFavorite('fav1');
    await addFavorite('fav2');
    installDrawFilter();

    const response = await window.fetch('/api/draw');
    const body = (await response.json()) as { data: { p: string }[] };
    expect(body.data.map((entry) => entry.p)).toEqual(['other']);
  });

  test('maxDistanceMeters скрывает цели дальше порога', async () => {
    saveDrawingRestrictionsSettings({
      version: 1,
      favProtectionMode: 'off',
      maxDistanceMeters: 500,
    });
    window.fetch = jest.fn().mockResolvedValue(
      buildResponse({
        data: [
          { p: 'p1', a: 2, d: 300 },
          { p: 'p2', a: 2, d: 800 },
          { p: 'p3', a: 2 },
        ],
      }),
    );
    installDrawFilter();

    const response = await window.fetch('/api/draw');
    const body = (await response.json()) as { data: { p: string }[] };
    expect(body.data.map((entry) => entry.p)).toEqual(['p1', 'p3']);
  });

  test('не трогает POST /api/draw', async () => {
    saveDrawingRestrictionsSettings({
      version: 1,
      favProtectionMode: 'hideAllFavorites',
      maxDistanceMeters: 0,
    });
    window.fetch = jest.fn().mockResolvedValue(buildResponse({ line: { id: 123 } }));
    await addFavorite('fav1');
    installDrawFilter();

    const response = await window.fetch('/api/draw', { method: 'POST' });
    const body = (await response.json()) as { line: { id: number } };
    expect(body.line.id).toBe(123);
  });

  test('не падает при невалидном JSON', async () => {
    saveDrawingRestrictionsSettings({
      version: 1,
      favProtectionMode: 'protectLastKey',
      maxDistanceMeters: 0,
    });
    await addFavorite('fav1');
    window.fetch = jest.fn().mockResolvedValue(new Response('not json', { status: 200 }));
    installDrawFilter();
    const response = await window.fetch('/api/draw');
    expect(response.status).toBe(200);
  });

  test('все фильтры отключены — ответ не модифицируется', async () => {
    saveDrawingRestrictionsSettings({
      version: 1,
      favProtectionMode: 'off',
      maxDistanceMeters: 0,
    });
    const originalResponse = buildResponse({ data: [{ p: 'fav1', a: 1 }] });
    window.fetch = jest.fn().mockResolvedValue(originalResponse);
    await addFavorite('fav1');
    installDrawFilter();

    const response = await window.fetch('/api/draw');
    // Без активных предикатов drawFilter должен возвращать оригинальный Response —
    // никакой фильтрации и никакого тоста.
    expect(response).toBe(originalResponse);
  });

  test('uninstall возвращает оригинальный fetch', async () => {
    saveDrawingRestrictionsSettings({
      version: 1,
      favProtectionMode: 'protectLastKey',
      maxDistanceMeters: 0,
    });
    const mockFetch = jest.fn().mockResolvedValue(buildResponse({ data: [{ p: 'fav1', a: 1 }] }));
    window.fetch = mockFetch;
    await addFavorite('fav1');
    installDrawFilter();
    uninstallDrawFilter();

    expect(window.fetch).toBe(mockFetch);

    const response = await window.fetch('/api/draw');
    const body = (await response.json()) as { data: unknown[] };
    expect(body.data).toHaveLength(1);
  });

  test('двойная установка не плодит обёртки', () => {
    const mockFetch = jest.fn();
    window.fetch = mockFetch;
    installDrawFilter();
    const afterFirst = window.fetch;
    installDrawFilter();
    expect(window.fetch).toBe(afterFirst);
  });

  test('звезда: игрок у центра — фильтр не срабатывает', async () => {
    saveDrawingRestrictionsSettings({
      version: 1,
      favProtectionMode: 'off',
      maxDistanceMeters: 0,
    });
    setStarCenterGuid('center');
    createPopup('center');
    window.fetch = jest.fn().mockResolvedValue(
      buildResponse({
        data: [
          { p: 'a', a: 2 },
          { p: 'b', a: 2 },
          { p: 'center', a: 5 },
        ],
      }),
    );
    installDrawFilter();

    const response = await window.fetch('/api/draw');
    const body = (await response.json()) as { data: { p: string }[] };
    expect(body.data.map((entry) => entry.p)).toEqual(['a', 'b', 'center']);
  });

  test('звезда: игрок не у центра — остаётся только центр', async () => {
    saveDrawingRestrictionsSettings({
      version: 1,
      favProtectionMode: 'off',
      maxDistanceMeters: 0,
    });
    setStarCenterGuid('center');
    createPopup('other');
    window.fetch = jest.fn().mockResolvedValue(
      buildResponse({
        data: [
          { p: 'a', a: 2 },
          { p: 'b', a: 2 },
          { p: 'center', a: 5 },
        ],
      }),
    );
    installDrawFilter();

    const response = await window.fetch('/api/draw');
    const body = (await response.json()) as { data: { p: string }[] };
    expect(body.data.map((entry) => entry.p)).toEqual(['center']);
  });

  test('звезда: попап hidden трактуется как «не у центра»', async () => {
    saveDrawingRestrictionsSettings({
      version: 1,
      favProtectionMode: 'off',
      maxDistanceMeters: 0,
    });
    setStarCenterGuid('center');
    createPopup('center', true);
    window.fetch = jest.fn().mockResolvedValue(
      buildResponse({
        data: [
          { p: 'a', a: 2 },
          { p: 'center', a: 5 },
        ],
      }),
    );
    installDrawFilter();

    const response = await window.fetch('/api/draw');
    const body = (await response.json()) as { data: { p: string }[] };
    expect(body.data.map((entry) => entry.p)).toEqual(['center']);
  });

  test('настройки перечитываются при каждом запросе', async () => {
    saveDrawingRestrictionsSettings({
      version: 1,
      favProtectionMode: 'off',
      maxDistanceMeters: 0,
    });
    await addFavorite('fav1');
    window.fetch = jest.fn().mockResolvedValue(buildResponse({ data: [{ p: 'fav1', a: 1 }] }));
    installDrawFilter();

    const first = await window.fetch('/api/draw');
    const firstBody = (await first.json()) as { data: unknown[] };
    expect(firstBody.data).toHaveLength(1);

    saveDrawingRestrictionsSettings({
      version: 1,
      favProtectionMode: 'protectLastKey',
      maxDistanceMeters: 0,
    });

    const second = await window.fetch('/api/draw');
    const secondBody = (await second.json()) as { data: unknown[] };
    expect(secondBody.data).toHaveLength(0);
  });
});
