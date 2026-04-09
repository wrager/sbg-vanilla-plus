import type { IDeletionEntry } from './cleanupCalculator';
import { deleteInventoryItems, updateInventoryCache, updatePointRefCount } from './inventoryApi';

const AUTH_TOKEN = 'test-token-123';

const noFavs = { favoritedGuids: new Set<string>(), favoritedPointsActive: true };

let originalFetch: typeof window.fetch;
let mockFetch: jest.Mock;

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('auth', AUTH_TOKEN);
  mockFetch = jest.fn();
  originalFetch = window.fetch;
  Object.defineProperty(window, 'fetch', { value: mockFetch, writable: true });
});

afterEach(() => {
  window.fetch = originalFetch;
});

function mockFetchSuccess(total: number): void {
  mockFetch.mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ count: { total } }),
  });
}

function mockFetchError(error: string): void {
  mockFetch.mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ error }),
  });
}

describe('deleteInventoryItems', () => {
  test('sends DELETE request with correct headers and body', async () => {
    mockFetchSuccess(95);

    const deletions: IDeletionEntry[] = [
      { guid: 'aaa', type: 1, level: 5, amount: 3 },
      { guid: 'bbb', type: 1, level: 5, amount: 2 },
    ];

    await deleteInventoryItems(deletions, noFavs);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith('/api/inventory', {
      method: 'DELETE',
      headers: {
        authorization: `Bearer ${AUTH_TOKEN}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ selection: { aaa: 3, bbb: 2 }, tab: 1 }),
    });
  });

  test('groups deletions by type into separate requests', async () => {
    mockFetchSuccess(90);

    const deletions: IDeletionEntry[] = [
      { guid: 'core1', type: 1, level: 3, amount: 5 },
      { guid: 'cat1', type: 2, level: 7, amount: 10 },
      { guid: 'core2', type: 1, level: 5, amount: 2 },
    ];

    await deleteInventoryItems(deletions, noFavs);

    expect(mockFetch).toHaveBeenCalledTimes(2);

    const calls = mockFetch.mock.calls as [string, { body: string }][];

    const firstCall = JSON.parse(calls[0][1].body) as {
      selection: Record<string, number>;
      tab: number;
    };
    expect(firstCall).toEqual({ selection: { core1: 5, core2: 2 }, tab: 1 });

    const secondCall = JSON.parse(calls[1][1].body) as {
      selection: Record<string, number>;
      tab: number;
    };
    expect(secondCall).toEqual({ selection: { cat1: 10 }, tab: 2 });
  });

  test('returns total from last successful response', async () => {
    let callCount = 0;
    mockFetch.mockImplementation(() => {
      callCount++;
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ count: { total: callCount === 1 ? 95 : 85 } }),
      });
    });

    const deletions: IDeletionEntry[] = [
      { guid: 'a', type: 1, level: 1, amount: 1 },
      { guid: 'b', type: 2, level: 1, amount: 1 },
    ];

    const result = await deleteInventoryItems(deletions, noFavs);
    expect(result.total).toBe(85);
  });

  test('throws on API error', async () => {
    mockFetchError('Inventory locked');

    const deletions: IDeletionEntry[] = [{ guid: 'a', type: 1, level: 1, amount: 1 }];

    await expect(deleteInventoryItems(deletions, noFavs)).rejects.toThrow('Inventory locked');
  });

  test('throws when auth token is missing', async () => {
    localStorage.removeItem('auth');

    const deletions: IDeletionEntry[] = [{ guid: 'a', type: 1, level: 1, amount: 1 }];

    await expect(deleteInventoryItems(deletions, noFavs)).rejects.toThrow('Auth token not found');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test('throws on HTTP error status', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
    });

    const deletions: IDeletionEntry[] = [{ guid: 'a', type: 1, level: 1, amount: 1 }];

    await expect(deleteInventoryItems(deletions, noFavs)).rejects.toThrow('HTTP 500');
  });

  test('throws on non-JSON response', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.reject(new SyntaxError('Unexpected token')),
    });

    const deletions: IDeletionEntry[] = [{ guid: 'a', type: 1, level: 1, amount: 1 }];

    await expect(deleteInventoryItems(deletions, noFavs)).rejects.toThrow(
      'Invalid response from server',
    );
  });

  test('throws when response missing count field', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    });

    const deletions: IDeletionEntry[] = [{ guid: 'a', type: 1, level: 1, amount: 1 }];

    await expect(deleteInventoryItems(deletions, noFavs)).rejects.toThrow(
      'Response missing inventory count',
    );
  });

  test('ключи (type 3) реально удаляются через fetch', async () => {
    mockFetchSuccess(90);
    const deletions: IDeletionEntry[] = [
      { guid: 'r1', type: 3, level: null, amount: 5, pointGuid: 'p1' },
    ];
    const result = await deleteInventoryItems(deletions, noFavs);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(result.total).toBe(90);
  });

  test('смешанный батч — cores и ключи отправляются отдельными запросами', async () => {
    mockFetchSuccess(85);
    const deletions: IDeletionEntry[] = [
      { guid: 'c1', type: 1, level: 5, amount: 3 },
      { guid: 'r1', type: 3, level: null, amount: 5, pointGuid: 'p1' },
    ];
    const result = await deleteInventoryItems(deletions, noFavs);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(result.total).toBe(85);
  });

  test('guard: бросает если ключ без pointGuid', async () => {
    const deletions: IDeletionEntry[] = [{ guid: 'r1', type: 3, level: null, amount: 5 }];
    await expect(deleteInventoryItems(deletions, noFavs)).rejects.toThrow(
      'без pointGuid не может быть удалён',
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test('guard: бросает если pointGuid в избранных', async () => {
    const deletions: IDeletionEntry[] = [
      { guid: 'r1', type: 3, level: null, amount: 5, pointGuid: 'fav-point' },
    ];
    await expect(
      deleteInventoryItems(deletions, {
        favoritedGuids: new Set(['fav-point']),
        favoritedPointsActive: true,
      }),
    ).rejects.toThrow('Ключ от избранной точки fav-point не может быть удалён');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test('guard: смешанный батч с избранным ключом блокирует весь запрос', async () => {
    const deletions: IDeletionEntry[] = [
      { guid: 'c1', type: 1, level: 5, amount: 3 },
      { guid: 'r1', type: 3, level: null, amount: 1, pointGuid: 'fav' },
    ];
    await expect(
      deleteInventoryItems(deletions, {
        favoritedGuids: new Set(['fav']),
        favoritedPointsActive: true,
      }),
    ).rejects.toThrow('Ключ от избранной точки');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test('guard: бросает если есть ключи и favoritedPointsActive=false', async () => {
    const deletions: IDeletionEntry[] = [
      { guid: 'r1', type: 3, level: null, amount: 5, pointGuid: 'p1' },
    ];
    await expect(
      deleteInventoryItems(deletions, {
        favoritedGuids: new Set<string>(),
        favoritedPointsActive: false,
      }),
    ).rejects.toThrow('модуль favoritedPoints не активен');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test('cores удаляются даже при favoritedPointsActive=false', async () => {
    mockFetchSuccess(90);
    const deletions: IDeletionEntry[] = [{ guid: 'c1', type: 1, level: 5, amount: 3 }];
    await deleteInventoryItems(deletions, {
      favoritedGuids: new Set<string>(),
      favoritedPointsActive: false,
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  test('rejects deletion of brooms (type 4)', async () => {
    const deletions: IDeletionEntry[] = [{ guid: 'b1', type: 4, level: 0, amount: 1 }];

    await expect(deleteInventoryItems(deletions, noFavs)).rejects.toThrow(
      'Удаление предметов типа 4 запрещено',
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test('rejects deletion of erasers (type 5)', async () => {
    const deletions: IDeletionEntry[] = [{ guid: 'e1', type: 5, level: 1, amount: 1 }];

    await expect(deleteInventoryItems(deletions, noFavs)).rejects.toThrow(
      'Удаление предметов типа 5 запрещено',
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test('rejects mixed batch with forbidden type', async () => {
    const deletions: IDeletionEntry[] = [
      { guid: 'c1', type: 1, level: 5, amount: 3 },
      { guid: 'e1', type: 5, level: 1, amount: 1 },
    ];

    await expect(deleteInventoryItems(deletions, noFavs)).rejects.toThrow(
      'Удаление предметов типа 5 запрещено',
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test('каскадный сбой: cores удалены, refs HTTP 500 — ошибка, но cores уже отправлены', async () => {
    let callCount = 0;
    mockFetch.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // Первый запрос (cores) успешен.
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ count: { total: 95 } }),
        });
      }
      // Второй запрос (refs) падает.
      return Promise.resolve({ ok: false, status: 500 });
    });

    const deletions: IDeletionEntry[] = [
      { guid: 'c1', type: 1, level: 5, amount: 3 },
      { guid: 'r1', type: 3, level: null, amount: 5, pointGuid: 'p1' },
    ];

    await expect(
      deleteInventoryItems(deletions, {
        favoritedGuids: new Set<string>(),
        favoritedPointsActive: true,
      }),
    ).rejects.toThrow('HTTP 500');
    // Cores DELETE уже отправлен (первый вызов fetch), refs — нет (второй упал).
    // Документирует поведение: при каскадном сбое первый батч удалён безвозвратно.
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  test('aggregates amounts for same guid', async () => {
    mockFetchSuccess(90);

    const deletions: IDeletionEntry[] = [
      { guid: 'aaa', type: 1, level: 5, amount: 3 },
      { guid: 'aaa', type: 1, level: 5, amount: 2 },
    ];

    await deleteInventoryItems(deletions, noFavs);

    const calls = mockFetch.mock.calls as [string, { body: string }][];
    const body = JSON.parse(calls[0][1].body) as {
      selection: Record<string, number>;
    };
    expect(body.selection).toEqual({ aaa: 5 });
  });
});

describe('updateInventoryCache', () => {
  function setCache(items: { g: string; t: number; l: number | string; a: number }[]): void {
    localStorage.setItem('inventory-cache', JSON.stringify(items));
  }

  function getCache(): { g: string; t: number; l: number | string; a: number }[] {
    const raw = localStorage.getItem('inventory-cache');
    if (!raw) return [];
    return JSON.parse(raw) as {
      g: string;
      t: number;
      l: number | string;
      a: number;
    }[];
  }

  test('reduces amount for matching items', () => {
    setCache([
      { g: 'aaa', t: 1, l: 5, a: 10 },
      { g: 'bbb', t: 1, l: 5, a: 7 },
    ]);

    updateInventoryCache([{ guid: 'aaa', type: 1, level: 5, amount: 3 }]);

    const cache = getCache();
    expect(cache).toEqual([
      { g: 'aaa', t: 1, l: 5, a: 7 },
      { g: 'bbb', t: 1, l: 5, a: 7 },
    ]);
  });

  test('removes items with amount <= 0', () => {
    setCache([
      { g: 'aaa', t: 1, l: 5, a: 5 },
      { g: 'bbb', t: 2, l: 3, a: 10 },
    ]);

    updateInventoryCache([{ guid: 'aaa', type: 1, level: 5, amount: 5 }]);

    const cache = getCache();
    expect(cache).toEqual([{ g: 'bbb', t: 2, l: 3, a: 10 }]);
  });

  test('skips guid not found in cache', () => {
    setCache([{ g: 'aaa', t: 1, l: 5, a: 10 }]);

    updateInventoryCache([{ guid: 'missing', type: 1, level: 5, amount: 3 }]);

    const cache = getCache();
    expect(cache).toEqual([{ g: 'aaa', t: 1, l: 5, a: 10 }]);
  });

  test('warns and skips when cache is empty', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation();

    updateInventoryCache([{ guid: 'aaa', type: 1, level: 5, amount: 3 }]);

    expect(localStorage.getItem('inventory-cache')).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('отсутствует'));
    warnSpy.mockRestore();
  });

  test('warns and skips when cache is invalid JSON', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
    localStorage.setItem('inventory-cache', 'not json');

    updateInventoryCache([{ guid: 'aaa', type: 1, level: 5, amount: 3 }]);

    expect(localStorage.getItem('inventory-cache')).toBe('not json');
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('невалидный JSON'));
    warnSpy.mockRestore();
  });

  test('handles multiple deletions across types', () => {
    setCache([
      { g: 'c1', t: 1, l: 5, a: 10 },
      { g: 'k1', t: 2, l: 3, a: 8 },
      { g: 'r1', t: 3, l: 'point-abc', a: 20 },
    ]);

    updateInventoryCache([
      { guid: 'c1', type: 1, level: 5, amount: 4 },
      { guid: 'k1', type: 2, level: 3, amount: 8 },
      { guid: 'r1', type: 3, level: null, amount: 5 },
    ]);

    const cache = getCache();
    expect(cache).toEqual([
      { g: 'c1', t: 1, l: 5, a: 6 },
      { g: 'r1', t: 3, l: 'point-abc', a: 15 },
    ]);
  });
});

describe('updatePointRefCount', () => {
  function createInfoPopup(pointGuid: string): void {
    const popup = document.createElement('div');
    popup.className = 'info popup';
    popup.dataset.guid = pointGuid;
    const refSpan = document.createElement('span');
    refSpan.id = 'i-ref';
    refSpan.textContent = 'КЛЮЧ 4/100';
    refSpan.setAttribute('data-has', '1');
    popup.appendChild(refSpan);
    document.body.appendChild(popup);
  }

  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('обновляет счётчик ключей в открытом попапе точки', () => {
    createInfoPopup('point-abc');
    localStorage.setItem(
      'inventory-cache',
      JSON.stringify([{ g: 'r1', t: 3, l: 'point-abc', a: 2 }]),
    );

    updatePointRefCount();

    const refElement = document.getElementById('i-ref');
    expect(refElement?.textContent).toBe('КЛЮЧ 2/100');
    expect(refElement?.getAttribute('data-has')).toBe('1');
  });

  test('ставит 0 и data-has=0, если ключей не осталось', () => {
    createInfoPopup('point-abc');
    localStorage.setItem('inventory-cache', JSON.stringify([]));

    updatePointRefCount();

    const refElement = document.getElementById('i-ref');
    expect(refElement?.textContent).toBe('КЛЮЧ 0/100');
    expect(refElement?.getAttribute('data-has')).toBe('0');
  });

  test('не трогает #i-ref, если попап скрыт', () => {
    createInfoPopup('point-abc');
    const popup = document.querySelector<HTMLElement>('.info.popup');
    popup?.classList.add('hidden');
    localStorage.setItem('inventory-cache', JSON.stringify([]));

    updatePointRefCount();

    const refElement = document.getElementById('i-ref');
    expect(refElement?.textContent).toBe('КЛЮЧ 4/100');
  });

  test('не падает, если попапа нет в DOM', () => {
    localStorage.setItem('inventory-cache', JSON.stringify([]));
    expect(() => {
      updatePointRefCount();
    }).not.toThrow();
  });
});
