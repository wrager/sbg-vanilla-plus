import { resetRefsHighlightSyncForTest, syncRefsCountForPoints } from './refsHighlightSync';
import type { IOlFeature, IOlLayer, IOlMap, IOlVectorSource, IOlView } from './olMap';

jest.mock('./olMap', () => ({
  getOlMap: jest.fn(),
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- requireActual returns any
  findLayerByName: jest.requireActual('./olMap').findLayerByName,
}));

let moduleEnabledMock = true;
jest.mock('./moduleRegistry', () => ({
  isModuleEnabledByUser: (): boolean => moduleEnabledMock,
}));

import { getOlMap } from './olMap';

const mockGetOlMap = getOlMap as jest.MockedFunction<typeof getOlMap>;

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

function makeSource(featuresById: Record<string, IOlFeature> = {}): IOlVectorSource {
  const map = new Map<string, IOlFeature>(Object.entries(featuresById));
  return {
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

function setInventory(items: { g: string; t: number; l: string; a: number; f?: number }[]): void {
  localStorage.setItem('inventory-cache', JSON.stringify(items));
}

beforeEach(() => {
  resetRefsHighlightSyncForTest();
  mockGetOlMap.mockReset();
  localStorage.clear();
  moduleEnabledMock = true;
});

describe('syncRefsCountForPoints', () => {
  test('пустой массив pointGuids - silent no-op (getOlMap не вызывается)', async () => {
    await syncRefsCountForPoints([]);
    expect(mockGetOlMap).not.toHaveBeenCalled();
  });

  test('owner-модуль refsLayerSync выключен пользователем - silent no-op', async () => {
    moduleEnabledMock = false;
    const feature = makeFeature({ highlight: { '7': 5 } });
    const olMap = makeMap([makeLayer('points', makeSource({ 'point-a': feature }))]);
    mockGetOlMap.mockResolvedValue(olMap);
    setInventory([{ g: 's1', t: 3, l: 'point-a', a: 99 }]);

    await syncRefsCountForPoints(['point-a']);

    // getOlMap не вызывается - sync вышел до lazy init.
    expect(mockGetOlMap).not.toHaveBeenCalled();
    expect(feature._changedCalls).toBe(0);
  });

  test('feature не найдена в pointsSource - silent skip', async () => {
    const olMap = makeMap([makeLayer('points', makeSource({}))]);
    mockGetOlMap.mockResolvedValue(olMap);
    await expect(syncRefsCountForPoints(['missing'])).resolves.toBeUndefined();
  });

  test('SBG 0.6.1+ sparse object - синхронизирует highlight["7"] с amount из кэша', async () => {
    const highlight: Record<string, unknown> = { '4': false, '7': 18 };
    const feature = makeFeature({ highlight });
    const olMap = makeMap([makeLayer('points', makeSource({ 'point-a': feature }))]);
    mockGetOlMap.mockResolvedValue(olMap);
    setInventory([{ g: 's1', t: 3, l: 'point-a', a: 23 }]);

    await syncRefsCountForPoints(['point-a']);

    expect(highlight['7']).toBe(23);
    expect(feature._changedCalls).toBe(1);
  });

  test('массив (backward-compat) - тоже синхронизируется через тот же ключ', async () => {
    const highlight: unknown[] = [];
    highlight[7] = 5;
    const feature = makeFeature({ highlight });
    const olMap = makeMap([makeLayer('points', makeSource({ 'point-a': feature }))]);
    mockGetOlMap.mockResolvedValue(olMap);
    setInventory([{ g: 's1', t: 3, l: 'point-a', a: 12 }]);

    await syncRefsCountForPoints(['point-a']);

    expect(highlight[7]).toBe(12);
    expect(feature._changedCalls).toBe(1);
  });

  test('точка без ключей в кэше - устанавливает highlight["7"] в 0 (loss)', async () => {
    const highlight: Record<string, unknown> = { '7': 5 };
    const feature = makeFeature({ highlight });
    const olMap = makeMap([makeLayer('points', makeSource({ 'point-a': feature }))]);
    mockGetOlMap.mockResolvedValue(olMap);
    // Кэш не содержит ref-стопок этой точки - amount 0.
    setInventory([{ g: 's1', t: 3, l: 'other-point', a: 1 }]);

    await syncRefsCountForPoints(['point-a']);

    expect(highlight['7']).toBe(0);
    expect(feature._changedCalls).toBe(1);
  });

  test('значение уже совпадает - silent skip без feature.changed()', async () => {
    const highlight: Record<string, unknown> = { '7': 10 };
    const feature = makeFeature({ highlight });
    const olMap = makeMap([makeLayer('points', makeSource({ 'point-a': feature }))]);
    mockGetOlMap.mockResolvedValue(olMap);
    setInventory([{ g: 's1', t: 3, l: 'point-a', a: 10 }]);

    await syncRefsCountForPoints(['point-a']);

    expect(highlight['7']).toBe(10);
    expect(feature._changedCalls).toBe(0);
  });

  test('highlight не object (string) - silent skip', async () => {
    const feature = makeFeature({ highlight: 'bad' });
    const olMap = makeMap([makeLayer('points', makeSource({ 'point-a': feature }))]);
    mockGetOlMap.mockResolvedValue(olMap);
    setInventory([{ g: 's1', t: 3, l: 'point-a', a: 10 }]);

    await syncRefsCountForPoints(['point-a']);

    expect(feature._changedCalls).toBe(0);
  });

  test('highlight = null - silent skip', async () => {
    const feature = makeFeature({ highlight: null });
    const olMap = makeMap([makeLayer('points', makeSource({ 'point-a': feature }))]);
    mockGetOlMap.mockResolvedValue(olMap);
    setInventory([]);

    await syncRefsCountForPoints(['point-a']);

    expect(feature._changedCalls).toBe(0);
  });

  test('несколько точек: каждая получает feature.changed() при изменении', async () => {
    const f1 = makeFeature({ highlight: { '7': 1 } as Record<string, unknown> });
    const f2 = makeFeature({ highlight: { '7': 2 } as Record<string, unknown> });
    const f3 = makeFeature({ highlight: { '7': 3 } as Record<string, unknown> });
    const olMap = makeMap([makeLayer('points', makeSource({ 'p-1': f1, 'p-2': f2, 'p-3': f3 }))]);
    mockGetOlMap.mockResolvedValue(olMap);
    setInventory([
      { g: 's1', t: 3, l: 'p-1', a: 11 },
      { g: 's2', t: 3, l: 'p-2', a: 22 },
      { g: 's3', t: 3, l: 'p-3', a: 33 },
    ]);

    await syncRefsCountForPoints(['p-1', 'p-2', 'p-3']);

    expect(f1._changedCalls).toBe(1);
    expect(f2._changedCalls).toBe(1);
    expect(f3._changedCalls).toBe(1);
  });

  test('lazy init pointsSource: getOlMap вызывается один раз на серию вызовов', async () => {
    const olMap = makeMap([makeLayer('points', makeSource({}))]);
    mockGetOlMap.mockResolvedValue(olMap);

    await syncRefsCountForPoints(['p1']);
    await syncRefsCountForPoints(['p2']);
    await syncRefsCountForPoints(['p3']);

    expect(mockGetOlMap).toHaveBeenCalledTimes(1);
  });

  test('игнорирует точку с amount=0 в кэше И highlight["7"]=0: silent skip', async () => {
    const highlight: Record<string, unknown> = { '7': 0 };
    const feature = makeFeature({ highlight });
    const olMap = makeMap([makeLayer('points', makeSource({ 'point-a': feature }))]);
    mockGetOlMap.mockResolvedValue(olMap);
    setInventory([]);

    await syncRefsCountForPoints(['point-a']);

    expect(feature._changedCalls).toBe(0);
  });
});
