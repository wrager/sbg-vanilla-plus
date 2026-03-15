import { buildRefCounts, keyCountOnPoints } from './keyCountOnPoints';
import type { IOlFeature, IOlLayer, IOlMap, IOlVectorSource, IOlView } from '../../core/olMap';

// ── helpers ──────────────────────────────────────────────────────────────────

function makeSource(
  features: IOlFeature[] = [],
): IOlVectorSource & { _listeners: Map<string, (() => void)[]> } {
  const listeners = new Map<string, (() => void)[]>();
  return {
    _listeners: listeners,
    getFeatures: () => features,
    addFeature: jest.fn(),
    clear: jest.fn(),
    on(type: string, cb: () => void) {
      const arr = listeners.get(type) ?? [];
      arr.push(cb);
      listeners.set(type, arr);
    },
    un(type: string, cb: () => void) {
      const arr = listeners.get(type) ?? [];
      listeners.set(
        type,
        arr.filter((l) => l !== cb),
      );
    },
  };
}

function makeView(zoom = 16): IOlView {
  const listeners = new Map<string, (() => void)[]>();
  return {
    padding: [0, 0, 0, 0],
    getCenter: () => undefined,
    setCenter: () => {},
    calculateExtent: () => [0, 0, 0, 0],
    changed: () => {},
    getZoom: () => zoom,
    on(type: string, cb: () => void) {
      const arr = listeners.get(type) ?? [];
      arr.push(cb);
      listeners.set(type, arr);
    },
    un(type: string, cb: () => void) {
      const arr = listeners.get(type) ?? [];
      listeners.set(
        type,
        arr.filter((l) => l !== cb),
      );
    },
  };
}

function makeLayer(name: string, source: IOlVectorSource | null): IOlLayer {
  return {
    get: (key: string) => (key === 'name' ? name : undefined),
    getSource: () => source,
  };
}

function makeMap(layers: IOlLayer[], view: IOlView): IOlMap {
  const addLayerMock = jest.fn();
  const removeLayerMock = jest.fn();
  return {
    getView: () => view,
    getSize: () => [800, 600],
    getLayers: () => ({ getArray: () => layers }),
    addLayer: addLayerMock,
    removeLayer: removeLayerMock,
    updateSize: jest.fn(),
  };
}

function mockOl(): void {
  const createdSources: IOlVectorSource[] = [];
  const createdLayers: IOlLayer[] = [];

  window.ol = {
    Map: { prototype: { getView: jest.fn() } },
    source: {
      Vector: jest.fn().mockImplementation(() => {
        const s = makeSource();
        createdSources.push(s);
        return s;
      }) as unknown as new () => IOlVectorSource,
    },
    layer: {
      Vector: jest.fn().mockImplementation(() => {
        const l = makeLayer('labels', createdSources[createdSources.length - 1] ?? makeSource());
        createdLayers.push(l);
        return l;
      }) as unknown as new (opts: Record<string, unknown>) => IOlLayer,
    },
    Feature: jest.fn().mockImplementation(() => ({
      getGeometry: () => ({ getCoordinates: () => [0, 0] }),
      getId: () => undefined,
      setId: jest.fn(),
      setStyle: jest.fn(),
    })) as unknown as new (opts?: Record<string, unknown>) => IOlFeature,
    geom: {
      Point: jest.fn().mockImplementation((coords: number[]) => ({
        getCoordinates: () => coords,
      })) as unknown as new (coords: number[]) => { getCoordinates(): number[] },
    },
    style: {
      Style: jest.fn().mockImplementation((o: Record<string, unknown>) => o) as unknown as new (
        opts: Record<string, unknown>,
      ) => unknown,
      Text: jest.fn().mockImplementation((o: Record<string, unknown>) => o) as unknown as new (
        opts: Record<string, unknown>,
      ) => unknown,
      Fill: jest.fn().mockImplementation((o: Record<string, unknown>) => o) as unknown as new (
        opts: Record<string, unknown>,
      ) => unknown,
      Stroke: jest.fn().mockImplementation((o: Record<string, unknown>) => o) as unknown as new (
        opts: Record<string, unknown>,
      ) => unknown,
    },
  };
}

// ── buildRefCounts ────────────────────────────────────────────────────────────

describe('buildRefCounts', () => {
  afterEach(() => {
    localStorage.removeItem('inventory-cache');
  });

  test('returns empty map when no cache', () => {
    expect(buildRefCounts().size).toBe(0);
  });

  test('returns empty map on invalid JSON', () => {
    localStorage.setItem('inventory-cache', 'not-json');
    expect(buildRefCounts().size).toBe(0);
  });

  test('returns empty map when cache is not array', () => {
    localStorage.setItem('inventory-cache', '{"t":3}');
    expect(buildRefCounts().size).toBe(0);
  });

  test('counts refs per point', () => {
    const items = [
      { t: 3, l: 'point-1', a: 2 },
      { t: 3, l: 'point-1', a: 1 },
      { t: 3, l: 'point-2', a: 3 },
    ];
    localStorage.setItem('inventory-cache', JSON.stringify(items));
    const counts = buildRefCounts();
    expect(counts.get('point-1')).toBe(3);
    expect(counts.get('point-2')).toBe(3);
  });

  test('ignores non-ref item types', () => {
    const items = [
      { t: 1, l: 'point-1', a: 5 }, // not a ref
      { t: 3, l: 'point-2', a: 2 },
    ];
    localStorage.setItem('inventory-cache', JSON.stringify(items));
    const counts = buildRefCounts();
    expect(counts.has('point-1')).toBe(false);
    expect(counts.get('point-2')).toBe(2);
  });

  test('ignores items with missing fields', () => {
    const items = [
      { t: 3, a: 1 }, // missing l
      { t: 3, l: 42, a: 1 }, // l is not string
      { t: 3, l: 'point-ok', a: 1 },
    ];
    localStorage.setItem('inventory-cache', JSON.stringify(items));
    const counts = buildRefCounts();
    expect(counts.size).toBe(1);
    expect(counts.get('point-ok')).toBe(1);
  });
});

// ── module metadata ───────────────────────────────────────────────────────────

describe('keyCountOnPoints metadata', () => {
  test('has correct id', () => {
    expect(keyCountOnPoints.id).toBe('keyCountOnPoints');
  });

  test('has style category', () => {
    expect(keyCountOnPoints.category).toBe('ui');
  });

  test('is enabled by default', () => {
    expect(keyCountOnPoints.defaultEnabled).toBe(true);
  });

  test('has localized name and description', () => {
    expect(keyCountOnPoints.name.ru).toBeTruthy();
    expect(keyCountOnPoints.name.en).toBeTruthy();
    expect(keyCountOnPoints.description.ru).toBeTruthy();
    expect(keyCountOnPoints.description.en).toBeTruthy();
  });
});

// ── enable / disable ──────────────────────────────────────────────────────────

// Mock getOlMap to return a controlled map
jest.mock('../../core/olMap', () => ({
  getOlMap: jest.fn(),
}));

import { getOlMap } from '../../core/olMap';

const mockGetOlMap = getOlMap as jest.MockedFunction<typeof getOlMap>;

describe('keyCountOnPoints enable/disable', () => {
  let pointsSrc: ReturnType<typeof makeSource>;
  let olMap: IOlMap;
  let view: IOlView;

  beforeEach(() => {
    localStorage.removeItem('inventory-cache');
    pointsSrc = makeSource();
    view = makeView(16);
    const pointsLayer = makeLayer('points', pointsSrc);
    olMap = makeMap([pointsLayer], view);
    mockGetOlMap.mockResolvedValue(olMap);
    mockOl();
  });

  afterEach(async () => {
    await keyCountOnPoints.disable();
    delete window.ol;
  });

  test('adds layer to map on enable', async () => {
    await keyCountOnPoints.enable();
    expect((olMap.addLayer as jest.Mock).mock.calls.length).toBeGreaterThan(0);
  });

  test('removes layer from map on disable after enable', async () => {
    await keyCountOnPoints.enable();
    await keyCountOnPoints.disable();
    expect((olMap.removeLayer as jest.Mock).mock.calls.length).toBeGreaterThan(0);
  });

  test('subscribes to points source change on enable', async () => {
    await keyCountOnPoints.enable();
    expect(pointsSrc._listeners.get('change')?.length).toBeGreaterThan(0);
  });

  test('unsubscribes from points source change on disable', async () => {
    await keyCountOnPoints.enable();
    await keyCountOnPoints.disable();
    expect(pointsSrc._listeners.get('change')?.length ?? 0).toBe(0);
  });

  test('does nothing if ol constructors are absent', async () => {
    window.ol = { Map: { prototype: { getView: jest.fn() } } };
    await keyCountOnPoints.enable();
    expect((olMap.addLayer as jest.Mock).mock.calls.length).toBe(0);
  });

  test('does nothing if points layer is not found', async () => {
    const otherLayer = makeLayer('other', makeSource());
    mockGetOlMap.mockResolvedValue(makeMap([otherLayer], view));
    await keyCountOnPoints.enable();
    expect((olMap.addLayer as jest.Mock).mock.calls.length).toBe(0);
  });
});
