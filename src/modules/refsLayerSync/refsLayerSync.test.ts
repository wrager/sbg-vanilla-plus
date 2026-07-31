import {
  refsLayerSync,
  installDiscoverFetchHook,
  uninstallDiscoverFetchHookForTest,
} from './refsLayerSync';

jest.mock('../../core/refsHighlightSync', () => ({
  syncRefsCountForPoints: jest.fn(() => Promise.resolve()),
}));

import { syncRefsCountForPoints } from '../../core/refsHighlightSync';

const mockSync = syncRefsCountForPoints as jest.MockedFunction<typeof syncRefsCountForPoints>;

describe('refsLayerSync', () => {
  let origFetch: typeof window.fetch | undefined;

  beforeEach(() => {
    jest.useFakeTimers();
    origFetch = window.fetch;
    mockSync.mockClear();
  });

  afterEach(() => {
    void refsLayerSync.disable();
    uninstallDiscoverFetchHookForTest();
    if (origFetch) window.fetch = origFetch;
    jest.useRealTimers();
  });

  function makeOkResponse(): Response {
    return { ok: true, status: 200 } as unknown as Response;
  }

  test('happy path: discover -> setTimeout(100ms) -> syncRefsCountForPoints вызван с targetGuid', async () => {
    window.fetch = jest.fn(() =>
      Promise.resolve(makeOkResponse()),
    ) as unknown as typeof window.fetch;
    installDiscoverFetchHook();
    void refsLayerSync.enable();

    await window.fetch('/api/discover', {
      method: 'POST',
      body: JSON.stringify({ position: [0, 0], guid: 'point-a', wish: 0 }),
    });
    // Микро-тики для then-цепочки.
    await Promise.resolve();
    await Promise.resolve();

    // До истечения DETECTION_DELAY_MS - sync не вызван.
    expect(mockSync).not.toHaveBeenCalled();
    // После истечения - вызван с targetGuid.
    jest.advanceTimersByTime(100);
    expect(mockSync).toHaveBeenCalledTimes(1);
    expect(mockSync).toHaveBeenCalledWith(['point-a']);
  });

  test('disable между response и тиком таймера: sync не вызывается', async () => {
    window.fetch = jest.fn(() =>
      Promise.resolve(makeOkResponse()),
    ) as unknown as typeof window.fetch;
    installDiscoverFetchHook();
    void refsLayerSync.enable();

    await window.fetch('/api/discover', {
      method: 'POST',
      body: JSON.stringify({ guid: 'point-a' }),
    });
    await Promise.resolve();
    await Promise.resolve();

    // Disable до тика таймера.
    void refsLayerSync.disable();
    jest.advanceTimersByTime(100);

    expect(mockSync).not.toHaveBeenCalled();
  });

  test('disable между fetch resolve и setTimeout: sync не запланирован', async () => {
    window.fetch = jest.fn(() =>
      Promise.resolve(makeOkResponse()),
    ) as unknown as typeof window.fetch;
    installDiscoverFetchHook();
    void refsLayerSync.enable();

    const fetchPromise = window.fetch('/api/discover', {
      method: 'POST',
      body: JSON.stringify({ guid: 'point-a' }),
    });
    // Отключаем модуль ДО того как then-цепочка успеет отработать.
    void refsLayerSync.disable();
    await fetchPromise;
    await Promise.resolve();
    await Promise.resolve();
    jest.advanceTimersByTime(100);

    expect(mockSync).not.toHaveBeenCalled();
  });

  test('игнорирует не-/api/discover URL', async () => {
    window.fetch = jest.fn(() =>
      Promise.resolve(makeOkResponse()),
    ) as unknown as typeof window.fetch;
    installDiscoverFetchHook();
    void refsLayerSync.enable();

    await window.fetch('/api/inview', { method: 'POST', body: '{}' });
    await Promise.resolve();
    await Promise.resolve();
    jest.advanceTimersByTime(100);

    expect(mockSync).not.toHaveBeenCalled();
  });

  test('discover без guid в body - sync не вызывается', async () => {
    window.fetch = jest.fn(() =>
      Promise.resolve(makeOkResponse()),
    ) as unknown as typeof window.fetch;
    installDiscoverFetchHook();
    void refsLayerSync.enable();

    await window.fetch('/api/discover', { method: 'POST', body: JSON.stringify({}) });
    await Promise.resolve();
    await Promise.resolve();
    jest.advanceTimersByTime(100);

    expect(mockSync).not.toHaveBeenCalled();
  });

  test('discover с не-200 response - sync не вызывается', async () => {
    const badResponse = { ok: false, status: 500 } as unknown as Response;
    window.fetch = jest.fn(() => Promise.resolve(badResponse)) as unknown as typeof window.fetch;
    installDiscoverFetchHook();
    void refsLayerSync.enable();

    await window.fetch('/api/discover', {
      method: 'POST',
      body: JSON.stringify({ guid: 'point-a' }),
    });
    await Promise.resolve();
    await Promise.resolve();
    jest.advanceTimersByTime(100);

    expect(mockSync).not.toHaveBeenCalled();
  });

  test('init не ставит fetch-patch (lazy install)', () => {
    const fetchBefore = window.fetch;
    void refsLayerSync.init();
    expect(window.fetch).toBe(fetchBefore);
  });

  test('первый enable ставит fetch-patch (lazy install)', () => {
    const fetchBefore = window.fetch;
    void refsLayerSync.enable();
    expect(window.fetch).not.toBe(fetchBefore);
  });

  test('metadata: id, category=fix, defaultEnabled=true, локализованные имя/описание', () => {
    expect(refsLayerSync.id).toBe('refsLayerSync');
    expect(refsLayerSync.category).toBe('fix');
    expect(refsLayerSync.defaultEnabled).toBe(true);
    expect(refsLayerSync.name.ru).toBeTruthy();
    expect(refsLayerSync.name.en).toBeTruthy();
    expect(refsLayerSync.description.ru).toBeTruthy();
    expect(refsLayerSync.description.en).toBeTruthy();
  });
});
