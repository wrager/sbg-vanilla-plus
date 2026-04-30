import {
  applyRefsGainToFeature,
  computeRefsGainFromDiscover,
  fixRedrawRefsOnDiscover,
  installDiscoverFetchHook,
  uninstallDiscoverFetchHookForTest,
} from './fixRedrawRefsOnDiscover';
import type { IOlFeature, IOlLayer, IOlMap, IOlVectorSource, IOlView } from '../../core/olMap';

// ── Mocks ───────────────────────────────────────────────────────────────────

jest.mock('../../core/olMap', () => ({
  getOlMap: jest.fn(),
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- requireActual returns any
  findLayerByName: jest.requireActual('../../core/olMap').findLayerByName,
}));

import { getOlMap } from '../../core/olMap';

const mockGetOlMap = getOlMap as jest.MockedFunction<typeof getOlMap>;

// ── helpers ──────────────────────────────────────────────────────────────────

interface IMockFeature extends IOlFeature {
  _props: Record<string, unknown>;
  _changedCalls: number;
  changed(): void;
  get(key: string): unknown;
}

function makeFeature(props: Record<string, unknown> = {}): IMockFeature {
  const f: IMockFeature = {
    _props: { ...props },
    _changedCalls: 0,
    getGeometry: () => ({ getCoordinates: () => [0, 0] }),
    getId: () => 'f-id',
    setId: jest.fn(),
    setStyle: jest.fn(),
    get(key: string) {
      return this._props[key];
    },
    changed() {
      this._changedCalls++;
    },
  };
  return f;
}

interface IMockSource extends IOlVectorSource {
  _featuresById: Map<string, IOlFeature>;
}

function makeSource(featuresById: Record<string, IOlFeature> = {}): IMockSource {
  const map = new Map<string, IOlFeature>(Object.entries(featuresById));
  return {
    _featuresById: map,
    getFeatures: () => Array.from(map.values()),
    addFeature: jest.fn(),
    clear: jest.fn(),
    on: jest.fn(),
    un: jest.fn(),
    getFeatureById: (id: string | number) => map.get(String(id)) ?? null,
  };
}

function makeView(): IOlView {
  return {
    padding: [0, 0, 0, 0],
    getCenter: () => undefined,
    setCenter: () => {},
    calculateExtent: () => [0, 0, 0, 0],
    changed: () => {},
    getRotation: () => 0,
    setRotation: () => {},
    getZoom: () => 16,
  };
}

function makeLayer(name: string, source: IOlVectorSource | null): IOlLayer {
  return {
    get: (key: string) => (key === 'name' ? name : undefined),
    getSource: () => source,
  };
}

function makeMap(layers: IOlLayer[]): IOlMap {
  return {
    getView: () => makeView(),
    getSize: () => [800, 600],
    getLayers: () => ({ getArray: () => layers }),
    getInteractions: () => ({ getArray: () => [] }),
    addLayer: jest.fn(),
    removeLayer: jest.fn(),
    updateSize: jest.fn(),
  };
}

// ── computeRefsGainFromDiscover (real game body shape) ──────────────────────

describe('computeRefsGainFromDiscover', () => {
  test('суммирует amount loot-элементов с t=3 и l===guid (real body shape без response wrapper)', () => {
    // Реальный формат body от server (см. refs/game/script.js:3697 -
    // apiSend парсит request.json() и кладёт в локальную response).
    // На уровне fetch.json() body имеет ключи loot/remaining/next/xp напрямую.
    const body = {
      loot: [
        { t: 3, l: 'point-a', a: 2 },
        { t: 3, l: 'point-a', a: 3 },
        { t: 3, l: 'point-b', a: 5 },
        { t: 1, l: 'point-a', a: 99 }, // не ref - игнор
      ],
      remaining: 4,
      next: 1234567890,
      xp: { diff: 100, total: 5000 },
    };
    expect(computeRefsGainFromDiscover(body, 'point-a')).toBe(5);
    expect(computeRefsGainFromDiscover(body, 'point-b')).toBe(5);
    expect(computeRefsGainFromDiscover(body, 'point-c')).toBe(0);
  });

  test('возвращает 0 для невалидной структуры', () => {
    expect(computeRefsGainFromDiscover(null, 'p')).toBe(0);
    expect(computeRefsGainFromDiscover({}, 'p')).toBe(0);
    expect(computeRefsGainFromDiscover({ loot: 'bad' }, 'p')).toBe(0);
  });

  test('возвращает 0 если body обёрнут в response wrapper (regression на старый баг)', () => {
    // До коммита fix-refs-redraw-on-discover мы ошибочно ожидали body.response.loot
    // (apiSend-style wrapper). Server отдаёт body напрямую без response-обёртки;
    // body.response при этом undefined и старый код возвращал 0 для любого
    // discover-ответа. Этот тест фиксирует, что мы НЕ переключаемся обратно
    // на ошибочный shape - даже если кто-то по ошибке обернёт body, наш
    // computer должен вернуть 0 (нет body.loot напрямую).
    const wrappedBody = {
      response: {
        loot: [{ t: 3, l: 'point-a', a: 5 }],
      },
    };
    expect(computeRefsGainFromDiscover(wrappedBody, 'point-a')).toBe(0);
  });

  test('игнорирует элементы без числового a', () => {
    const body = {
      loot: [
        { t: 3, l: 'p', a: 'bad' },
        { t: 3, l: 'p', a: 4 },
      ],
    };
    expect(computeRefsGainFromDiscover(body, 'p')).toBe(4);
  });
});

// ── applyRefsGainToFeature ──────────────────────────────────────────────────

describe('applyRefsGainToFeature', () => {
  test('увеличивает highlight[7] на gain in-place и вызывает feature.changed', () => {
    const highlight: unknown[] = [];
    highlight[5] = 3;
    highlight[7] = 2;
    const feature = makeFeature({ highlight });
    applyRefsGainToFeature(feature, 4);
    expect(highlight[7]).toBe(6);
    // in-place: тот же reference, что в prop - LIGHT closure прочтёт новое.
    expect(feature.get('highlight')).toBe(highlight);
    expect(feature._changedCalls).toBe(1);
  });

  test('инициализирует highlight[7] из 0, если индекс не задан', () => {
    const highlight: unknown[] = [];
    highlight[5] = 3;
    const feature = makeFeature({ highlight });
    applyRefsGainToFeature(feature, 2);
    expect(highlight[7]).toBe(2);
  });

  test('игнорирует gain<=0', () => {
    const highlight: unknown[] = [];
    highlight[7] = 5;
    const feature = makeFeature({ highlight });
    applyRefsGainToFeature(feature, 0);
    applyRefsGainToFeature(feature, -3);
    expect(highlight[7]).toBe(5);
    expect(feature._changedCalls).toBe(0);
  });

  test('игнорирует feature без highlight-prop', () => {
    const feature = makeFeature({});
    expect(() => {
      applyRefsGainToFeature(feature, 3);
    }).not.toThrow();
    expect(feature._changedCalls).toBe(0);
  });

  test('игнорирует non-array highlight', () => {
    const feature = makeFeature({ highlight: 'bad' });
    applyRefsGainToFeature(feature, 3);
    expect(feature._changedCalls).toBe(0);
  });
});

// ── installDiscoverFetchHook + module enable/disable ────────────────────────

describe('fixRedrawRefsOnDiscover module', () => {
  let origFetch: typeof window.fetch | undefined;

  beforeEach(() => {
    jest.useFakeTimers();
    origFetch = window.fetch;
  });

  afterEach(async () => {
    await fixRedrawRefsOnDiscover.disable();
    uninstallDiscoverFetchHookForTest();
    if (origFetch) window.fetch = origFetch;
    jest.useRealTimers();
  });

  function buildSetup(highlightInitial = 1): {
    feature: IMockFeature;
    highlight: unknown[];
  } {
    const highlight: unknown[] = [];
    highlight[7] = highlightInitial;
    const feature = makeFeature({ highlight });
    const source = makeSource({ 'point-a': feature });
    const layer = makeLayer('points', source);
    const olMap = makeMap([layer]);
    mockGetOlMap.mockResolvedValue(olMap);
    return { feature, highlight };
  }

  function makeFakeResponse(body: unknown): Response {
    return {
      ok: true,
      status: 200,
      clone: jest.fn(() => ({
        json: jest.fn(() => Promise.resolve(body)),
      })),
    } as unknown as Response;
  }

  test('happy path: discover увеличивает highlight[7] после DETECTION_DELAY_MS', async () => {
    const { feature, highlight } = buildSetup(4);
    const responseBody = {
      loot: [{ t: 3, l: 'point-a', a: 2 }],
      remaining: 5,
      next: 0,
      xp: { diff: 0, total: 0 },
    };
    window.fetch = jest.fn(() =>
      Promise.resolve(makeFakeResponse(responseBody)),
    ) as unknown as typeof window.fetch;
    installDiscoverFetchHook();

    await fixRedrawRefsOnDiscover.enable();

    await window.fetch('/api/discover', {
      method: 'POST',
      body: JSON.stringify({ position: [0, 0], guid: 'point-a', wish: 0 }),
    });
    // Микро-тики для then-цепочки .clone().json() resolve.
    await Promise.resolve();
    await Promise.resolve();
    // До истечения DETECTION_DELAY_MS - значение не должно измениться.
    expect(highlight[7]).toBe(4);
    expect(feature._changedCalls).toBe(0);
    // После истечения - применяется gain.
    jest.advanceTimersByTime(100);
    expect(highlight[7]).toBe(6);
    expect(feature._changedCalls).toBe(1);
  });

  test('forward-compat: если highlight[7] обновлён сторонним кодом до тика таймера - skip', async () => {
    // Симуляция будущего: разработчик игры исправил баг, и теперь сама игра
    // в своём continuation после await fetch обновляет prop.highlight[7].
    // Наш модуль через DETECTION_DELAY_MS обнаруживает что значение
    // изменилось не нашими руками - не дублирует gain.
    const { feature, highlight } = buildSetup(4);
    const responseBody = {
      loot: [{ t: 3, l: 'point-a', a: 2 }],
      remaining: 5,
      next: 0,
      xp: {},
    };
    window.fetch = jest.fn(() =>
      Promise.resolve(makeFakeResponse(responseBody)),
    ) as unknown as typeof window.fetch;
    installDiscoverFetchHook();

    await fixRedrawRefsOnDiscover.enable();

    await window.fetch('/api/discover', {
      method: 'POST',
      body: JSON.stringify({ position: [0, 0], guid: 'point-a', wish: 0 }),
    });
    await Promise.resolve();
    await Promise.resolve();
    // Имитируем что игра сама поправила highlight (4 + 2 = 6).
    highlight[7] = 6;
    jest.advanceTimersByTime(100);
    // Наш модуль увидел что значение изменилось vs запомненный beforeValue=4
    // и не делает += gain. Иначе было бы 8 (двойной gain).
    expect(highlight[7]).toBe(6);
    expect(feature._changedCalls).toBe(0);
  });

  test('forward-compat: если highlight[7] стал произвольным значением - тоже skip', async () => {
    // Эдж-кейс: highlight[7] изменился, но не на before+gain. Может быть
    // другой userscript подавил, или сервер вернул синхронизированное
    // значение в ответе attack-API. В любом случае внешний источник дал
    // свою правду - не должны её переписывать.
    const { feature, highlight } = buildSetup(4);
    const responseBody = { loot: [{ t: 3, l: 'point-a', a: 2 }] };
    window.fetch = jest.fn(() =>
      Promise.resolve(makeFakeResponse(responseBody)),
    ) as unknown as typeof window.fetch;
    installDiscoverFetchHook();

    await fixRedrawRefsOnDiscover.enable();

    await window.fetch('/api/discover', {
      method: 'POST',
      body: JSON.stringify({ position: [0, 0], guid: 'point-a', wish: 0 }),
    });
    await Promise.resolve();
    await Promise.resolve();
    // Сторонний код выставил произвольное значение.
    highlight[7] = 100;
    jest.advanceTimersByTime(100);
    expect(highlight[7]).toBe(100);
    expect(feature._changedCalls).toBe(0);
  });

  test('disable между response и тиком таймера: gain не применяется', async () => {
    const { feature, highlight } = buildSetup(4);
    const responseBody = { loot: [{ t: 3, l: 'point-a', a: 2 }] };
    window.fetch = jest.fn(() =>
      Promise.resolve(makeFakeResponse(responseBody)),
    ) as unknown as typeof window.fetch;
    installDiscoverFetchHook();

    await fixRedrawRefsOnDiscover.enable();

    await window.fetch('/api/discover', {
      method: 'POST',
      body: JSON.stringify({ position: [0, 0], guid: 'point-a', wish: 0 }),
    });
    await Promise.resolve();
    await Promise.resolve();
    await fixRedrawRefsOnDiscover.disable();
    jest.advanceTimersByTime(100);
    expect(highlight[7]).toBe(4);
    expect(feature._changedCalls).toBe(0);
  });

  test('игнорирует не-/api/discover URL', async () => {
    buildSetup(0);
    const fetchMock = jest.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        clone: jest.fn(),
      } as unknown as Response),
    );
    window.fetch = fetchMock as unknown as typeof window.fetch;
    installDiscoverFetchHook();
    await fixRedrawRefsOnDiscover.enable();

    await window.fetch('/api/inview', { method: 'GET' });
    await Promise.resolve();
    jest.advanceTimersByTime(100);

    const fakeResp = (await fetchMock.mock.results[0].value) as { clone: jest.Mock };
    expect(fakeResp.clone).not.toHaveBeenCalled();
  });

  test('init не ставит fetch-patch (lazy install)', () => {
    uninstallDiscoverFetchHookForTest();
    const fetchBefore = jest.fn(() =>
      Promise.resolve({ ok: true, clone: jest.fn() } as unknown as Response),
    );
    window.fetch = fetchBefore as unknown as typeof window.fetch;
    void fixRedrawRefsOnDiscover.init();
    expect(window.fetch).toBe(fetchBefore);
  });

  test('первый enable ставит fetch-patch (lazy install)', async () => {
    uninstallDiscoverFetchHookForTest();
    const fetchBefore = jest.fn(() =>
      Promise.resolve({ ok: true, clone: jest.fn() } as unknown as Response),
    );
    window.fetch = fetchBefore as unknown as typeof window.fetch;
    buildSetup(0);
    void fixRedrawRefsOnDiscover.init();
    expect(window.fetch).toBe(fetchBefore);
    await fixRedrawRefsOnDiscover.enable();
    expect(window.fetch).not.toBe(fetchBefore);
  });

  test('race-disable во время await getOlMap не оставляет вечный pointsSource', async () => {
    let resolveGetOlMap: ((value: IOlMap) => void) | undefined;
    const pendingMap = new Promise<IOlMap>((resolve) => {
      resolveGetOlMap = resolve;
    });
    mockGetOlMap.mockReturnValueOnce(pendingMap);

    const enablePromise = fixRedrawRefsOnDiscover.enable();
    void fixRedrawRefsOnDiscover.disable();

    const layer = makeLayer('points', makeSource({}));
    resolveGetOlMap?.(makeMap([layer]));
    await enablePromise;

    // discover-hook не должен сработать (discoverHookEnabled = false после disable).
    const responseBody = { loot: [{ t: 3, l: 'point-a', a: 2 }] };
    window.fetch = jest.fn(() =>
      Promise.resolve(makeFakeResponse(responseBody)),
    ) as unknown as typeof window.fetch;
    installDiscoverFetchHook();
    await window.fetch('/api/discover', {
      method: 'POST',
      body: JSON.stringify({ position: [0, 0], guid: 'point-a', wish: 0 }),
    });
    await Promise.resolve();
    jest.advanceTimersByTime(100);
    // hook не сделал ничего - модуль выключен.
    // (мы просто проверяем что не упало).
  });

  test('metadata: id, category=fix, defaultEnabled=true, локализованные имя/описание', () => {
    expect(fixRedrawRefsOnDiscover.id).toBe('fixRedrawRefsOnDiscover');
    expect(fixRedrawRefsOnDiscover.category).toBe('fix');
    expect(fixRedrawRefsOnDiscover.defaultEnabled).toBe(true);
    expect(fixRedrawRefsOnDiscover.name.ru).toBeTruthy();
    expect(fixRedrawRefsOnDiscover.name.en).toBeTruthy();
    expect(fixRedrawRefsOnDiscover.description.ru).toBeTruthy();
    expect(fixRedrawRefsOnDiscover.description.en).toBeTruthy();
  });
});
