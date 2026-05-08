import type { IDeletionEntry } from './cleanupCalculator';
import { deleteInventoryItems, updateInventoryCache, updatePointRefCount } from './inventoryApi';

const AUTH_TOKEN = 'test-token-123';

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

    await deleteInventoryItems(deletions);

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

    await deleteInventoryItems(deletions);

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

    const result = await deleteInventoryItems(deletions);
    expect(result.total).toBe(85);
  });

  test('throws on API error', async () => {
    mockFetchError('Inventory locked');

    const deletions: IDeletionEntry[] = [{ guid: 'a', type: 1, level: 1, amount: 1 }];

    await expect(deleteInventoryItems(deletions)).rejects.toThrow('Inventory locked');
  });

  test('throws when auth token is missing', async () => {
    localStorage.removeItem('auth');

    const deletions: IDeletionEntry[] = [{ guid: 'a', type: 1, level: 1, amount: 1 }];

    await expect(deleteInventoryItems(deletions)).rejects.toThrow('Auth token not found');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test('throws on HTTP error status', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
    });

    const deletions: IDeletionEntry[] = [{ guid: 'a', type: 1, level: 1, amount: 1 }];

    await expect(deleteInventoryItems(deletions)).rejects.toThrow('HTTP 500');
  });

  test('throws on non-JSON response', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.reject(new SyntaxError('Unexpected token')),
    });

    const deletions: IDeletionEntry[] = [{ guid: 'a', type: 1, level: 1, amount: 1 }];

    await expect(deleteInventoryItems(deletions)).rejects.toThrow('Invalid response from server');
  });

  test('throws when response missing count field', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    });

    const deletions: IDeletionEntry[] = [{ guid: 'a', type: 1, level: 1, amount: 1 }];

    await expect(deleteInventoryItems(deletions)).rejects.toThrow(
      'Response missing inventory count',
    );
  });

  // Помимо отсутствия count, runtime-валидация должна отбивать и нестандартные
  // формы ответа: null, массив, count с не-числовым total. Без проверки они
  // просочились бы в lastTotal и выдались бы updateDomInventoryCount как NaN/string.
  test('throws on null response', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve(null) });
    const deletions: IDeletionEntry[] = [{ guid: 'a', type: 1, level: 1, amount: 1 }];
    await expect(deleteInventoryItems(deletions)).rejects.toThrow(
      'Response missing inventory count',
    );
  });

  test('throws when count.total is not a number', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ count: { total: 'lots' } }),
    });
    const deletions: IDeletionEntry[] = [{ guid: 'a', type: 1, level: 1, amount: 1 }];
    await expect(deleteInventoryItems(deletions)).rejects.toThrow(
      'Response missing inventory count',
    );
  });

  test('ключи (type 3) реально удаляются через fetch', async () => {
    // Кэш с f=0 даёт lockSupportAvailable=true → guard разрешает удаление.
    localStorage.setItem(
      'inventory-cache',
      JSON.stringify([{ g: 'r1', t: 3, l: 'p1', a: 5, f: 0 }]),
    );
    mockFetchSuccess(90);
    const deletions: IDeletionEntry[] = [
      { guid: 'r1', type: 3, level: null, amount: 5, pointGuid: 'p1' },
    ];
    const result = await deleteInventoryItems(deletions);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(result.total).toBe(90);
  });

  test('смешанный батч — cores и ключи отправляются отдельными запросами', async () => {
    localStorage.setItem(
      'inventory-cache',
      JSON.stringify([{ g: 'r1', t: 3, l: 'p1', a: 5, f: 0 }]),
    );
    mockFetchSuccess(85);
    const deletions: IDeletionEntry[] = [
      { guid: 'c1', type: 1, level: 5, amount: 3 },
      { guid: 'r1', type: 3, level: null, amount: 5, pointGuid: 'p1' },
    ];
    const result = await deleteInventoryItems(deletions);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(result.total).toBe(85);
  });

  test('guard: бросает если ключ без pointGuid', async () => {
    // Кэш с lockSupportAvailable=true, чтобы пройти первый guard.
    localStorage.setItem(
      'inventory-cache',
      JSON.stringify([{ g: 'r-other', t: 3, l: 'p-other', a: 1, f: 0 }]),
    );
    const deletions: IDeletionEntry[] = [{ guid: 'r1', type: 3, level: null, amount: 5 }];
    await expect(deleteInventoryItems(deletions)).rejects.toThrow(
      'без pointGuid не может быть удалён',
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test('guard: бросает если есть ключи и lock-поддержка недоступна', async () => {
    // Кэш без поля `f` ни у одной стопки → сервер не отдаёт lock-семантику →
    // удаление ключей вслепую запрещено (legacy SVP/CUI больше не учитывается).
    localStorage.setItem('inventory-cache', JSON.stringify([]));
    const deletions: IDeletionEntry[] = [
      { guid: 'r1', type: 3, level: null, amount: 5, pointGuid: 'p1' },
    ];
    await expect(deleteInventoryItems(deletions)).rejects.toThrow(
      'Удаление ключей запрещено: нативный lock недоступен',
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test('guard: кэш с f-полем разрешает удаление (lockSupportAvailable=true)', async () => {
    localStorage.setItem(
      'inventory-cache',
      JSON.stringify([{ g: 'r1', t: 3, l: 'p-other', a: 1, f: 0 }]),
    );
    mockFetchSuccess(80);
    const deletions: IDeletionEntry[] = [
      { guid: 'r1', type: 3, level: null, amount: 1, pointGuid: 'p-other' },
    ];
    await deleteInventoryItems(deletions);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  test('guard: mix-кэш (часть стопок без f) блокирует удаление', async () => {
    // Раньше lockSupportAvailable считался через some — хватало одной стопки
    // с f. Стопки без f не попадают в lockedPointGuids, и удаление их ключей
    // могло пройти, даже если их точка фактически защищена. Теперь every —
    // mix блокируется целиком.
    localStorage.setItem(
      'inventory-cache',
      JSON.stringify([
        { g: 'r1', t: 3, l: 'p1', a: 1, f: 0 },
        { g: 'r2', t: 3, l: 'p2', a: 1 }, // без f
      ]),
    );
    const deletions: IDeletionEntry[] = [
      { guid: 'r1', type: 3, level: null, amount: 1, pointGuid: 'p1' },
    ];
    await expect(deleteInventoryItems(deletions)).rejects.toThrow('нативный lock недоступен');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test('guard: lock-точка из свежего кэша блокирует удаление', async () => {
    // Симуляция race: пользователь нажал замок ПОСЛЕ расчёта deletions.
    // В deletions точка ещё не помечена locked, но в свежем cache — уже.
    localStorage.setItem(
      'inventory-cache',
      JSON.stringify([{ g: 'r1', t: 3, l: 'p1', a: 5, f: 0b10 }]),
    );
    const deletions: IDeletionEntry[] = [
      { guid: 'r1', type: 3, level: null, amount: 5, pointGuid: 'p1' },
    ];
    await expect(deleteInventoryItems(deletions)).rejects.toThrow(
      'Ключ от защищённой точки p1 не может быть удалён',
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test('guard: favorite-точка из свежего кэша блокирует удаление', async () => {
    // Симметричный кейс с lock: пользователь поставил звёздочку (бит 0)
    // ПОСЛЕ расчёта deletions. Симуляция race ровно как у lock — guard
    // должен блокировать удаление обоими битами.
    localStorage.setItem(
      'inventory-cache',
      JSON.stringify([{ g: 'r1', t: 3, l: 'p1', a: 5, f: 0b01 }]),
    );
    const deletions: IDeletionEntry[] = [
      { guid: 'r1', type: 3, level: null, amount: 5, pointGuid: 'p1' },
    ];
    await expect(deleteInventoryItems(deletions)).rejects.toThrow(
      'Ключ от защищённой точки p1 не может быть удалён',
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test('guard: per-point агрегация - locked стопка той же точки защищает все её стопки', async () => {
    // Кэш одной точки p1 с двумя стопками: одна locked (f=0b10), вторая - нет
    // (f=0). buildProtectedPointGuids агрегирует per-point: одной защищённой
    // стопки достаточно, чтобы вся точка попала в protectedPointGuids. Если
    // refactor случайно превратит функцию в per-stack-проверку, удаление
    // стопки r2 (f=0) пройдёт мимо guard'а - тест зафиксирует регрессию.
    localStorage.setItem(
      'inventory-cache',
      JSON.stringify([
        { g: 'r1', t: 3, l: 'p1', a: 1, f: 0b10 },
        { g: 'r2', t: 3, l: 'p1', a: 5, f: 0 },
      ]),
    );
    const deletions: IDeletionEntry[] = [
      { guid: 'r2', type: 3, level: null, amount: 5, pointGuid: 'p1' },
    ];
    await expect(deleteInventoryItems(deletions)).rejects.toThrow(
      'Ключ от защищённой точки p1 не может быть удалён',
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test('guard: per-point агрегация - favorite стопка той же точки защищает все её стопки', async () => {
    // Симметричный кейс с lock per-point: одна favorite-стопка защищает
    // все стопки той же точки от удаления.
    localStorage.setItem(
      'inventory-cache',
      JSON.stringify([
        { g: 'r1', t: 3, l: 'p1', a: 1, f: 0b01 },
        { g: 'r2', t: 3, l: 'p1', a: 5, f: 0 },
      ]),
    );
    const deletions: IDeletionEntry[] = [
      { guid: 'r2', type: 3, level: null, amount: 5, pointGuid: 'p1' },
    ];
    await expect(deleteInventoryItems(deletions)).rejects.toThrow(
      'Ключ от защищённой точки p1 не может быть удалён',
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test('cores удаляются без проверки lock-поддержки (lock-guard только для рефов)', async () => {
    mockFetchSuccess(90);
    const deletions: IDeletionEntry[] = [{ guid: 'c1', type: 1, level: 5, amount: 3 }];
    await deleteInventoryItems(deletions);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  test('rejects deletion of brooms (type 4)', async () => {
    const deletions: IDeletionEntry[] = [{ guid: 'b1', type: 4, level: 0, amount: 1 }];

    await expect(deleteInventoryItems(deletions)).rejects.toThrow(
      'Удаление предметов типа 4 запрещено',
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test('rejects deletion of erasers (type 5)', async () => {
    const deletions: IDeletionEntry[] = [{ guid: 'e1', type: 5, level: 1, amount: 1 }];

    await expect(deleteInventoryItems(deletions)).rejects.toThrow(
      'Удаление предметов типа 5 запрещено',
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test('rejects mixed batch with forbidden type', async () => {
    const deletions: IDeletionEntry[] = [
      { guid: 'c1', type: 1, level: 5, amount: 3 },
      { guid: 'e1', type: 5, level: 1, amount: 1 },
    ];

    await expect(deleteInventoryItems(deletions)).rejects.toThrow(
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

    // f=0 в кэше даёт lockSupportAvailable=true → guard пропускает удаление.
    localStorage.setItem(
      'inventory-cache',
      JSON.stringify([{ g: 'r1', t: 3, l: 'p1', a: 5, f: 0 }]),
    );
    const deletions: IDeletionEntry[] = [
      { guid: 'c1', type: 1, level: 5, amount: 3 },
      { guid: 'r1', type: 3, level: null, amount: 5, pointGuid: 'p1' },
    ];

    await expect(deleteInventoryItems(deletions)).rejects.toThrow('HTTP 500');
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

    await deleteInventoryItems(deletions);

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
