import { installDrawFilter, uninstallDrawFilter, uninstallDrawFilterForTest } from './drawFilter';
import { saveDrawingRestrictionsSettings } from './settings';
import { clearStarCenter, setStarCenter, setStarCenterActive } from './starCenter';

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

beforeEach(() => {
  localStorage.clear();
  clearStarCenter();
  localStorage.clear();
  originalFetch = window.fetch;
  document.body.innerHTML = '';
  showToastMock.mockClear();
});

afterEach(() => {
  uninstallDrawFilterForTest();
  window.fetch = originalFetch;
  localStorage.clear();
  document.body.innerHTML = '';
});

describe('drawFilter', () => {
  test('пропускает запросы не к /api/draw', async () => {
    saveDrawingRestrictionsSettings({ version: 1, maxDistanceMeters: 500 });
    window.fetch = jest.fn().mockResolvedValue(buildResponse({ data: [{ p: 'p1', d: 900 }] }));
    installDrawFilter();

    const response = await window.fetch('/api/point?guid=x');
    const body = (await response.json()) as { data: unknown[] };
    expect(body.data).toHaveLength(1);
  });

  test('maxDistanceMeters скрывает цели дальше порога', async () => {
    saveDrawingRestrictionsSettings({ version: 1, maxDistanceMeters: 500 });
    window.fetch = jest.fn().mockResolvedValue(
      buildResponse({
        data: [{ p: 'p1', d: 300 }, { p: 'p2', d: 800 }, { p: 'p3' }],
      }),
    );
    installDrawFilter();

    const response = await window.fetch('/api/draw');
    const body = (await response.json()) as { data: { p: string }[] };
    expect(body.data.map((entry) => entry.p)).toEqual(['p1', 'p3']);
  });

  test('не трогает POST /api/draw', async () => {
    saveDrawingRestrictionsSettings({ version: 1, maxDistanceMeters: 500 });
    window.fetch = jest.fn().mockResolvedValue(buildResponse({ line: { id: 123 } }));
    installDrawFilter();

    const response = await window.fetch('/api/draw', { method: 'POST' });
    const body = (await response.json()) as { line: { id: number } };
    expect(body.line.id).toBe(123);
  });

  test('не падает при невалидном JSON', async () => {
    saveDrawingRestrictionsSettings({ version: 1, maxDistanceMeters: 500 });
    window.fetch = jest.fn().mockResolvedValue(new Response('not json', { status: 200 }));
    installDrawFilter();
    const response = await window.fetch('/api/draw');
    expect(response.status).toBe(200);
  });

  test('response.json = строка — возвращается исходный Response', async () => {
    saveDrawingRestrictionsSettings({ version: 1, maxDistanceMeters: 500 });
    const originalResponse = buildResponse('just-a-string');
    window.fetch = jest.fn().mockResolvedValue(originalResponse);
    installDrawFilter();
    const response = await window.fetch('/api/draw');
    expect(response).toBe(originalResponse);
  });

  test('response.json = null — возвращается исходный Response', async () => {
    saveDrawingRestrictionsSettings({ version: 1, maxDistanceMeters: 500 });
    const originalResponse = buildResponse(null);
    window.fetch = jest.fn().mockResolvedValue(originalResponse);
    installDrawFilter();
    const response = await window.fetch('/api/draw');
    expect(response).toBe(originalResponse);
  });

  test('response.json без поля data — возвращается исходный Response', async () => {
    saveDrawingRestrictionsSettings({ version: 1, maxDistanceMeters: 500 });
    const originalResponse = buildResponse({ other: 1 });
    window.fetch = jest.fn().mockResolvedValue(originalResponse);
    installDrawFilter();
    const response = await window.fetch('/api/draw');
    expect(response).toBe(originalResponse);
  });

  test('response.json с data = null — возвращается исходный Response', async () => {
    saveDrawingRestrictionsSettings({ version: 1, maxDistanceMeters: 500 });
    const originalResponse = buildResponse({ data: null });
    window.fetch = jest.fn().mockResolvedValue(originalResponse);
    installDrawFilter();
    const response = await window.fetch('/api/draw');
    expect(response).toBe(originalResponse);
  });

  test('response.json с data-строкой — возвращается исходный Response', async () => {
    saveDrawingRestrictionsSettings({ version: 1, maxDistanceMeters: 500 });
    const originalResponse = buildResponse({ data: 'not-an-array' });
    window.fetch = jest.fn().mockResolvedValue(originalResponse);
    installDrawFilter();
    const response = await window.fetch('/api/draw');
    expect(response).toBe(originalResponse);
  });

  test('все фильтры отключены — ответ не модифицируется', async () => {
    saveDrawingRestrictionsSettings({ version: 1, maxDistanceMeters: 0 });
    const originalResponse = buildResponse({ data: [{ p: 'p1', d: 100 }] });
    window.fetch = jest.fn().mockResolvedValue(originalResponse);
    installDrawFilter();

    const response = await window.fetch('/api/draw');
    expect(response).toBe(originalResponse);
  });

  test('content-length не копируется в headers модифицированного Response', async () => {
    saveDrawingRestrictionsSettings({ version: 1, maxDistanceMeters: 500 });
    const originalResponse = new Response(
      JSON.stringify({
        data: [
          { p: 'p1', d: 900 },
          { p: 'p2', d: 100 },
        ],
      }),
      {
        status: 200,
        headers: { 'content-type': 'application/json', 'content-length': '999' },
      },
    );
    window.fetch = jest.fn().mockResolvedValue(originalResponse);
    installDrawFilter();

    const response = await window.fetch('/api/draw');
    expect(response.headers.get('content-length')).toBeNull();
    expect(response.headers.get('content-type')).toBe('application/json');
  });

  test('ошибка разбора запроса не рвёт сетевой вызов игры и снимает фильтр', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    saveDrawingRestrictionsSettings({ version: 1, maxDistanceMeters: 500 });
    window.fetch = jest.fn().mockResolvedValue(buildResponse({ data: [{ p: 'p1', d: 900 }] }));
    installDrawFilter();

    // Запрос, на котором ломается разбор: новая версия игры может слать draw
    // объектом другой формы.
    const brokenInput = {
      get url(): string {
        throw new Error('game changed');
      },
    } as unknown as Request;

    await expect(window.fetch(brokenInput)).resolves.toBeDefined();
    expect(consoleError).toHaveBeenCalled();

    // Фильтр снят: следующий /api/draw возвращает все цели, включая дальние.
    const response = await window.fetch('/api/draw');
    const body = (await response.json()) as { data: unknown[] };
    expect(body.data).toHaveLength(1);

    consoleError.mockRestore();
  });

  test('отказ фильтра отдаёт игре исходный ответ сервера', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    saveDrawingRestrictionsSettings({ version: 1, maxDistanceMeters: 500 });
    const serverResponse = buildResponse({ data: [{ p: 'p1', d: 900 }] });
    // Отказ на сборке отфильтрованного ответа: url переносится в новый Response
    // последним шагом, уже после разбора тела, поэтому собственные try/catch
    // фильтра его не перехватят.
    Object.defineProperty(serverResponse, 'url', {
      get(): string {
        throw new Error('game changed');
      },
    });
    window.fetch = jest.fn().mockResolvedValue(serverResponse);
    installDrawFilter();

    const response = await window.fetch('/api/draw');

    expect(response).toBe(serverResponse);
    expect(consoleError).toHaveBeenCalled();

    consoleError.mockRestore();
  });

  test('uninstall перестаёт фильтровать, но не выкидывает wrapper из цепочки', async () => {
    saveDrawingRestrictionsSettings({ version: 1, maxDistanceMeters: 500 });
    const mockFetch = jest.fn().mockResolvedValue(buildResponse({ data: [{ p: 'p1', d: 900 }] }));
    window.fetch = mockFetch;
    installDrawFilter();
    expect(window.fetch).not.toBe(mockFetch);
    const wrapper = window.fetch;
    uninstallDrawFilter();

    expect(window.fetch).toBe(wrapper);

    const response = await window.fetch('/api/draw');
    const body = (await response.json()) as { data: unknown[] };
    expect(body.data).toHaveLength(1);
  });

  test('повторный install после uninstall - тот же wrapper, фильтр снова работает', async () => {
    saveDrawingRestrictionsSettings({ version: 1, maxDistanceMeters: 500 });
    window.fetch = jest.fn().mockResolvedValue(buildResponse({ data: [{ p: 'p1', d: 900 }] }));
    installDrawFilter();
    const wrapper = window.fetch;
    uninstallDrawFilter();
    installDrawFilter();
    expect(window.fetch).toBe(wrapper);

    const response = await window.fetch('/api/draw');
    const body = (await response.json()) as { data: unknown[] };
    expect(body.data).toHaveLength(0);
  });

  test('uninstall сохраняет в цепочке wrapper, поставленный поверх нас', async () => {
    saveDrawingRestrictionsSettings({ version: 1, maxDistanceMeters: 0 });
    const native = jest.fn().mockResolvedValue(buildResponse({ data: [{ p: 'a' }] }));
    window.fetch = native;
    installDrawFilter();
    const outerCalls: string[] = [];
    const innerOriginal = window.fetch;
    window.fetch = function outerWrapper(
      this: typeof window,
      input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> {
      outerCalls.push(typeof input === 'string' ? input : 'other');
      return innerOriginal.call(this, input, init);
    };
    const outer = window.fetch;
    uninstallDrawFilter();

    expect(window.fetch).toBe(outer);
    await window.fetch('/api/draw');
    expect(outerCalls).toEqual(['/api/draw']);
    expect(native).toHaveBeenCalled();
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
    saveDrawingRestrictionsSettings({ version: 1, maxDistanceMeters: 0 });
    setStarCenter('center');
    createPopup('center');
    window.fetch = jest.fn().mockResolvedValue(
      buildResponse({
        data: [{ p: 'a' }, { p: 'b' }, { p: 'center' }],
      }),
    );
    installDrawFilter();

    const response = await window.fetch('/api/draw');
    const body = (await response.json()) as { data: { p: string }[] };
    expect(body.data.map((entry) => entry.p)).toEqual(['a', 'b', 'center']);
  });

  test('звезда: открыт попап другой точки — остаётся только центр', async () => {
    saveDrawingRestrictionsSettings({ version: 1, maxDistanceMeters: 0 });
    setStarCenter('center');
    createPopup('other');
    window.fetch = jest.fn().mockResolvedValue(
      buildResponse({
        data: [{ p: 'a' }, { p: 'b' }, { p: 'center' }],
      }),
    );
    installDrawFilter();

    const response = await window.fetch('/api/draw');
    const body = (await response.json()) as { data: { p: string }[] };
    expect(body.data.map((entry) => entry.p)).toEqual(['center']);
  });

  test('звезда: popup-guid снапшотится в момент запроса, не в момент response', async () => {
    saveDrawingRestrictionsSettings({ version: 1, maxDistanceMeters: 0 });
    setStarCenter('center');
    const popupCenter = createPopup('center');
    let resolveFetch: (response: Response) => void = () => {};
    window.fetch = jest.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    );
    installDrawFilter();

    const pending = window.fetch('/api/draw');
    popupCenter.remove();
    createPopup('other');
    resolveFetch(
      buildResponse({
        data: [{ p: 'a' }, { p: 'b' }, { p: 'center' }],
      }),
    );

    const response = await pending;
    const body = (await response.json()) as { data: { p: string }[] };
    expect(body.data.map((entry) => entry.p)).toEqual(['a', 'b', 'center']);
  });

  test('звезда: попап hidden трактуется как «попап центра не открыт»', async () => {
    saveDrawingRestrictionsSettings({ version: 1, maxDistanceMeters: 0 });
    setStarCenter('center');
    createPopup('center', true);
    window.fetch = jest.fn().mockResolvedValue(
      buildResponse({
        data: [{ p: 'a' }, { p: 'center' }],
      }),
    );
    installDrawFilter();

    const response = await window.fetch('/api/draw');
    const body = (await response.json()) as { data: { p: string }[] };
    expect(body.data.map((entry) => entry.p)).toEqual(['center']);
  });

  test('звезда: режим выключен (active=false) - фильтр не применяется', async () => {
    saveDrawingRestrictionsSettings({ version: 1, maxDistanceMeters: 0 });
    setStarCenter('center');
    setStarCenterActive(false);
    createPopup('other');
    window.fetch = jest.fn().mockResolvedValue(
      buildResponse({
        data: [{ p: 'a' }, { p: 'b' }, { p: 'center' }],
      }),
    );
    installDrawFilter();

    const response = await window.fetch('/api/draw');
    const body = (await response.json()) as { data: { p: string }[] };
    expect(body.data.map((entry) => entry.p)).toEqual(['a', 'b', 'center']);
  });

  test('настройки перечитываются при каждом запросе', async () => {
    saveDrawingRestrictionsSettings({ version: 1, maxDistanceMeters: 0 });
    window.fetch = jest.fn().mockResolvedValue(buildResponse({ data: [{ p: 'p1', d: 900 }] }));
    installDrawFilter();

    const first = await window.fetch('/api/draw');
    const firstBody = (await first.json()) as { data: unknown[] };
    expect(firstBody.data).toHaveLength(1);

    saveDrawingRestrictionsSettings({ version: 1, maxDistanceMeters: 500 });

    const second = await window.fetch('/api/draw');
    const secondBody = (await second.json()) as { data: unknown[] };
    expect(secondBody.data).toHaveLength(0);
  });
});

describe('drawFilter — выбор toast по комбинации счётчиков', () => {
  // s/d = hiddenByStar/Distance > 0.

  test('s=0 d=0 (нет скрытых) — showToast не вызван', async () => {
    saveDrawingRestrictionsSettings({ version: 1, maxDistanceMeters: 0 });
    window.fetch = jest.fn().mockResolvedValue(buildResponse({ data: [{ p: 'a' }] }));
    installDrawFilter();
    await window.fetch('/api/draw');
    expect(showToastMock).not.toHaveBeenCalled();
  });

  test('s=1 d=0 — star-only toast', async () => {
    saveDrawingRestrictionsSettings({ version: 1, maxDistanceMeters: 0 });
    setStarCenter('center');
    createPopup('other');
    window.fetch = jest.fn().mockResolvedValue(
      buildResponse({
        data: [{ p: 'a' }, { p: 'b' }, { p: 'center' }],
      }),
    );
    installDrawFilter();
    await window.fetch('/api/draw');
    expect(showToastMock).toHaveBeenCalledTimes(1);
    expect(lastToastMessage()).toContain('star mode');
    expect(lastToastMessage()).toContain('(2)');
  });

  test('s=0 d=1 — distance-only toast', async () => {
    saveDrawingRestrictionsSettings({ version: 1, maxDistanceMeters: 500 });
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

  test('s=1 d=1 — combined star+distance toast (totalHidden)', async () => {
    saveDrawingRestrictionsSettings({ version: 1, maxDistanceMeters: 500 });
    setStarCenter('center');
    createPopup('other');
    window.fetch = jest.fn().mockResolvedValue(
      buildResponse({
        // center (d=300), a(d=300, скрыт звездой), b(d=900, скрыт и звездой и distance),
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

  test('ровно один showToast на response при любой активной комбинации', async () => {
    saveDrawingRestrictionsSettings({ version: 1, maxDistanceMeters: 500 });
    setStarCenter('center');
    createPopup('other');
    window.fetch = jest.fn().mockResolvedValue(
      buildResponse({
        data: [
          { p: 'a', d: 900 },
          { p: 'center', d: 200 },
        ],
      }),
    );
    installDrawFilter();
    await window.fetch('/api/draw');
    expect(showToastMock).toHaveBeenCalledTimes(1);
  });
});
