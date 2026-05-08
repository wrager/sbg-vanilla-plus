import { postMark } from './marksApi';

const AUTH_TOKEN = 'auth-test';

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
  localStorage.clear();
});

function setInventory(items: { g: string; t: number; l: string; a: number; f?: number }[]): void {
  localStorage.setItem('inventory-cache', JSON.stringify(items));
}

function ok(result: boolean): void {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: () => Promise.resolve({ result }),
  });
}

function networkError(): void {
  mockFetch.mockRejectedValueOnce(new Error('network'));
}

function httpError(status: number): void {
  mockFetch.mockResolvedValueOnce({
    ok: false,
    status,
    json: () => Promise.resolve({}),
  });
}

describe('postMark', () => {
  test('успешный ответ result=true → networkOk + result=true', async () => {
    ok(true);
    const outcome = await postMark('s1', 'favorite');
    expect(outcome).toEqual({ networkOk: true, result: true });
    expect(mockFetch).toHaveBeenCalledWith('/api/marks', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${AUTH_TOKEN}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ guid: 's1', flag: 'favorite' }),
    });
  });

  test('успешный ответ result=false (toggle off) → networkOk + result=false', async () => {
    ok(false);
    const outcome = await postMark('s1', 'favorite');
    expect(outcome).toEqual({ networkOk: true, result: false });
  });

  test('сетевая ошибка → networkOk=false', async () => {
    networkError();
    const outcome = await postMark('s1', 'favorite');
    expect(outcome).toEqual({ networkOk: false, result: false });
  });

  test('HTTP 429/500 → networkOk=false', async () => {
    httpError(429);
    const outcome = await postMark('s1', 'favorite');
    expect(outcome).toEqual({ networkOk: false, result: false });
  });

  test('без auth-токена не делает запрос', async () => {
    localStorage.removeItem('auth');
    const outcome = await postMark('s1', 'favorite');
    expect(outcome).toEqual({ networkOk: false, result: false });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test('ответ без поля result → result=false (default-safe)', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) });
    const outcome = await postMark('s1', 'favorite');
    expect(outcome).toEqual({ networkOk: true, result: false });
  });

  test('ответ result не boolean (например, строка) → result=false', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ result: 'true' }),
    });
    const outcome = await postMark('s1', 'favorite');
    expect(outcome).toEqual({ networkOk: true, result: false });
  });

  test('ответ null → result=false', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(null) });
    const outcome = await postMark('s1', 'favorite');
    expect(outcome).toEqual({ networkOk: true, result: false });
  });

  test('ответ массив вместо объекта → result=false', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([true]) });
    const outcome = await postMark('s1', 'favorite');
    expect(outcome).toEqual({ networkOk: true, result: false });
  });
});

describe('postMark — обновление inventory-cache', () => {
  test('успешный locked: бит 0b10 устанавливается в кэше', async () => {
    setInventory([{ g: 's1', t: 3, l: 'p1', a: 5, f: 0 }]);
    ok(true);
    await postMark('s1', 'locked');
    const cache = JSON.parse(localStorage.getItem('inventory-cache') ?? '[]') as { f: number }[];
    expect(cache[0].f).toBe(0b10);
  });

  test('успешный favorite: бит 0b01 устанавливается, существующий 0b10 не теряется', async () => {
    setInventory([{ g: 's1', t: 3, l: 'p1', a: 5, f: 0b10 }]);
    ok(true);
    await postMark('s1', 'favorite');
    const cache = JSON.parse(localStorage.getItem('inventory-cache') ?? '[]') as { f: number }[];
    expect(cache[0].f).toBe(0b11);
  });

  test('toggle off: result=false снимает бит', async () => {
    setInventory([{ g: 's1', t: 3, l: 'p1', a: 5, f: 0b10 }]);
    ok(false);
    await postMark('s1', 'locked');
    const cache = JSON.parse(localStorage.getItem('inventory-cache') ?? '[]') as { f: number }[];
    expect(cache[0].f).toBe(0);
  });

  test('сетевая ошибка не трогает кэш', async () => {
    setInventory([{ g: 's1', t: 3, l: 'p1', a: 5, f: 0 }]);
    networkError();
    await postMark('s1', 'locked');
    const cache = JSON.parse(localStorage.getItem('inventory-cache') ?? '[]') as { f: number }[];
    expect(cache[0].f).toBe(0);
  });

  test('стопка отсутствует в кэше: запись no-op, не падает', async () => {
    setInventory([{ g: 's-other', t: 3, l: 'p-other', a: 5, f: 0 }]);
    ok(true);
    await postMark('s-missing', 'locked');
    const cache = JSON.parse(localStorage.getItem('inventory-cache') ?? '[]') as { f: number }[];
    expect(cache[0].f).toBe(0);
  });
});
