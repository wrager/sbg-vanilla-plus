import { installDrawFilter, uninstallDrawFilter } from './drawFilter';
import { addFavorite, loadFavorites, resetForTests } from '../../core/favoritesStore';
import { saveDrawingRestrictionsSettings } from './settings';
import { clearStarCenter, setStarCenter } from './starCenter';

const showToastMock = jest.fn();
jest.mock('../../core/toast', () => ({
  showToast: (...args: unknown[]) => {
    showToastMock(...args);
  },
}));

function lastToastMessage(): string {
  const calls = showToastMock.mock.calls as unknown[][];
  if (calls.length === 0) return '';
  const last = calls[calls.length - 1];
  const [first] = last;
  return typeof first === 'string' ? first : '';
}

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
  showToastMock.mockClear();
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

  // isDrawResponseShape narrowing: FALSE-ветки атомарных проверок.
  test('response.json = строка — возвращается исходный Response', async () => {
    saveDrawingRestrictionsSettings({
      version: 1,
      favProtectionMode: 'protectLastKey',
      maxDistanceMeters: 0,
    });
    await addFavorite('fav1');
    const originalResponse = buildResponse('just-a-string');
    window.fetch = jest.fn().mockResolvedValue(originalResponse);
    installDrawFilter();
    const response = await window.fetch('/api/draw');
    expect(response).toBe(originalResponse);
  });

  test('response.json = null — возвращается исходный Response', async () => {
    saveDrawingRestrictionsSettings({
      version: 1,
      favProtectionMode: 'protectLastKey',
      maxDistanceMeters: 0,
    });
    await addFavorite('fav1');
    const originalResponse = buildResponse(null);
    window.fetch = jest.fn().mockResolvedValue(originalResponse);
    installDrawFilter();
    const response = await window.fetch('/api/draw');
    expect(response).toBe(originalResponse);
  });

  test('response.json без поля data — возвращается исходный Response', async () => {
    saveDrawingRestrictionsSettings({
      version: 1,
      favProtectionMode: 'protectLastKey',
      maxDistanceMeters: 0,
    });
    await addFavorite('fav1');
    const originalResponse = buildResponse({ other: 1 });
    window.fetch = jest.fn().mockResolvedValue(originalResponse);
    installDrawFilter();
    const response = await window.fetch('/api/draw');
    expect(response).toBe(originalResponse);
  });

  test('response.json с data = null — возвращается исходный Response', async () => {
    saveDrawingRestrictionsSettings({
      version: 1,
      favProtectionMode: 'protectLastKey',
      maxDistanceMeters: 0,
    });
    await addFavorite('fav1');
    const originalResponse = buildResponse({ data: null });
    window.fetch = jest.fn().mockResolvedValue(originalResponse);
    installDrawFilter();
    const response = await window.fetch('/api/draw');
    expect(response).toBe(originalResponse);
  });

  test('response.json с data-строкой — возвращается исходный Response', async () => {
    saveDrawingRestrictionsSettings({
      version: 1,
      favProtectionMode: 'protectLastKey',
      maxDistanceMeters: 0,
    });
    await addFavorite('fav1');
    const originalResponse = buildResponse({ data: 'not-an-array' });
    window.fetch = jest.fn().mockResolvedValue(originalResponse);
    installDrawFilter();
    const response = await window.fetch('/api/draw');
    expect(response).toBe(originalResponse);
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

  test('звезда: открыт попап центра — фильтр не срабатывает', async () => {
    saveDrawingRestrictionsSettings({
      version: 1,
      favProtectionMode: 'off',
      maxDistanceMeters: 0,
    });
    setStarCenter('center', '');
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

  test('звезда: открыт попап другой точки — остаётся только центр', async () => {
    saveDrawingRestrictionsSettings({
      version: 1,
      favProtectionMode: 'off',
      maxDistanceMeters: 0,
    });
    setStarCenter('center', '');
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

  test('звезда: попап hidden трактуется как «попап центра не открыт»', async () => {
    saveDrawingRestrictionsSettings({
      version: 1,
      favProtectionMode: 'off',
      maxDistanceMeters: 0,
    });
    setStarCenter('center', '');
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

describe('drawFilter — выбор toast по комбинации счётчиков', () => {
  // s/d/k = hiddenByStar/Distance/LastKey > 0.

  // 0 0 0 — ничего не скрыто → showToast не вызывается.
  test('s=0 d=0 k=0 (нет скрытых) — showToast не вызван', async () => {
    saveDrawingRestrictionsSettings({
      version: 1,
      favProtectionMode: 'protectLastKey',
      maxDistanceMeters: 0,
    });
    // Избранные не добавлены → last-key не сработает. Центра нет, distance=0.
    window.fetch = jest.fn().mockResolvedValue(buildResponse({ data: [{ p: 'a', a: 3 }] }));
    installDrawFilter();
    await window.fetch('/api/draw');
    expect(showToastMock).not.toHaveBeenCalled();
  });

  // 1 0 0 — только звезда.
  test('s=1 d=0 k=0 — star-only toast', async () => {
    saveDrawingRestrictionsSettings({
      version: 1,
      favProtectionMode: 'off',
      maxDistanceMeters: 0,
    });
    setStarCenter('center', '');
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
    await window.fetch('/api/draw');
    expect(showToastMock).toHaveBeenCalledTimes(1);
    expect(lastToastMessage()).toContain('star mode');
    expect(lastToastMessage()).toContain('(2)');
  });

  // 0 1 0 — только дистанция.
  test('s=0 d=1 k=0 — distance-only toast', async () => {
    saveDrawingRestrictionsSettings({
      version: 1,
      favProtectionMode: 'off',
      maxDistanceMeters: 500,
    });
    window.fetch = jest.fn().mockResolvedValue(
      buildResponse({
        data: [
          { p: 'a', d: 300 },
          { p: 'b', d: 900 },
          { p: 'c', d: 1200 },
        ],
      }),
    );
    installDrawFilter();
    await window.fetch('/api/draw');
    expect(showToastMock).toHaveBeenCalledTimes(1);
    expect(lastToastMessage()).toContain('distance limit');
    expect(lastToastMessage()).toContain('(2)');
    expect(lastToastMessage()).toContain('500');
  });

  // 0 0 1 — только last-key (старое поведение сохраняется).
  test('s=0 d=0 k=1 — last-key toast с плюрализацией', async () => {
    saveDrawingRestrictionsSettings({
      version: 1,
      favProtectionMode: 'protectLastKey',
      maxDistanceMeters: 0,
    });
    await addFavorite('fav1');
    window.fetch = jest.fn().mockResolvedValue(
      buildResponse({
        data: [
          { p: 'fav1', a: 1 },
          { p: 'other', a: 5 },
        ],
      }),
    );
    installDrawFilter();
    await window.fetch('/api/draw');
    expect(showToastMock).toHaveBeenCalledTimes(1);
    expect(lastToastMessage()).toContain('last key');
  });

  // 1 1 0 — звезда + дистанция.
  test('s=1 d=1 k=0 — combined star+distance toast (totalHidden)', async () => {
    saveDrawingRestrictionsSettings({
      version: 1,
      favProtectionMode: 'off',
      maxDistanceMeters: 500,
    });
    setStarCenter('center', '');
    createPopup('other');
    window.fetch = jest.fn().mockResolvedValue(
      buildResponse({
        // center (d=300), другие: a(d=300, скрыт звездой), b(d=900, скрыт и звездой и distance),
        // c(d=200, скрыт звездой). originalLength=4, filteredLength=1, totalHidden=3.
        data: [
          { p: 'center', d: 300 },
          { p: 'a', d: 300 },
          { p: 'b', d: 900 },
          { p: 'c', d: 200 },
        ],
      }),
    );
    installDrawFilter();
    await window.fetch('/api/draw');
    expect(showToastMock).toHaveBeenCalledTimes(1);
    expect(lastToastMessage()).toContain('star mode');
    expect(lastToastMessage()).toContain('distance limit');
    expect(lastToastMessage()).toContain('(3)');
  });

  // 1 0 1 — звезда + last-key.
  test('s=1 d=0 k=1 — combined star+lastKey toast с breakdown', async () => {
    saveDrawingRestrictionsSettings({
      version: 1,
      favProtectionMode: 'protectLastKey',
      maxDistanceMeters: 0,
    });
    await addFavorite('fav1');
    setStarCenter('center', '');
    createPopup('other');
    window.fetch = jest.fn().mockResolvedValue(
      buildResponse({
        data: [
          { p: 'fav1', a: 1 }, // last-key hit (и звезда)
          { p: 'a', a: 2 }, // star hit
          { p: 'center', a: 5 }, // остаётся
        ],
      }),
    );
    installDrawFilter();
    await window.fetch('/api/draw');
    expect(showToastMock).toHaveBeenCalledTimes(1);
    expect(lastToastMessage()).toContain('star mode');
    expect(lastToastMessage()).toContain('last key');
  });

  // 0 1 1 — дистанция + last-key.
  test('s=0 d=1 k=1 — combined distance+lastKey toast', async () => {
    saveDrawingRestrictionsSettings({
      version: 1,
      favProtectionMode: 'protectLastKey',
      maxDistanceMeters: 500,
    });
    await addFavorite('fav1');
    window.fetch = jest.fn().mockResolvedValue(
      buildResponse({
        data: [
          { p: 'fav1', a: 1, d: 300 }, // last-key hit
          { p: 'a', a: 2, d: 900 }, // distance hit
          { p: 'b', a: 2, d: 300 }, // остаётся
        ],
      }),
    );
    installDrawFilter();
    await window.fetch('/api/draw');
    expect(showToastMock).toHaveBeenCalledTimes(1);
    expect(lastToastMessage()).toContain('beyond');
    expect(lastToastMessage()).toContain('500');
    expect(lastToastMessage()).toContain('last key');
  });

  // 1 1 1 — все три.
  test('s=1 d=1 k=1 — all-three toast', async () => {
    saveDrawingRestrictionsSettings({
      version: 1,
      favProtectionMode: 'protectLastKey',
      maxDistanceMeters: 500,
    });
    await addFavorite('fav1');
    setStarCenter('center', '');
    createPopup('other');
    window.fetch = jest.fn().mockResolvedValue(
      buildResponse({
        data: [
          { p: 'fav1', a: 1, d: 300 }, // last-key hit (и star)
          { p: 'a', a: 2, d: 900 }, // star + distance hit
          { p: 'center', a: 5, d: 200 }, // остаётся
        ],
      }),
    );
    installDrawFilter();
    await window.fetch('/api/draw');
    expect(showToastMock).toHaveBeenCalledTimes(1);
    expect(lastToastMessage()).toContain('star mode');
    expect(lastToastMessage()).toContain('distance');
    expect(lastToastMessage()).toContain('last-key');
  });

  test('ровно один showToast на response при любой активной комбинации', async () => {
    // Двойная проверка: для all-three не вызываются дополнительные toast'ы.
    saveDrawingRestrictionsSettings({
      version: 1,
      favProtectionMode: 'protectLastKey',
      maxDistanceMeters: 500,
    });
    await addFavorite('fav1');
    setStarCenter('center', '');
    createPopup('other');
    window.fetch = jest.fn().mockResolvedValue(
      buildResponse({
        data: [
          { p: 'fav1', a: 1, d: 900 },
          { p: 'center', a: 5, d: 200 },
        ],
      }),
    );
    installDrawFilter();
    await window.fetch('/api/draw');
    expect(showToastMock).toHaveBeenCalledTimes(1);
  });
});
