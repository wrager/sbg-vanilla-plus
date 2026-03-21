import { isInventoryRefFull, readRefsFromCache, refsOnMap } from './refsOnMap';
import type { IOlFeature, IOlLayer, IOlMap, IOlVectorSource, IOlView } from '../../core/olMap';

// ── helpers ──────────────────────────────────────────────────────────────────

function makeSource(
  features: IOlFeature[] = [],
): IOlVectorSource & { _features: IOlFeature[]; _listeners: Map<string, (() => void)[]> } {
  const listeners = new Map<string, (() => void)[]>();
  const featureList = [...features];
  return {
    _features: featureList,
    _listeners: listeners,
    getFeatures: () => featureList,
    addFeature: jest.fn((feature: IOlFeature) => {
      featureList.push(feature);
    }),
    removeFeature: jest.fn((feature: IOlFeature) => {
      const index = featureList.indexOf(feature);
      if (index >= 0) featureList.splice(index, 1);
    }),
    clear: jest.fn(() => {
      featureList.length = 0;
    }),
    on(type: string, callback: () => void) {
      const array = listeners.get(type) ?? [];
      array.push(callback);
      listeners.set(type, array);
    },
    un(type: string, callback: () => void) {
      const array = listeners.get(type) ?? [];
      listeners.set(
        type,
        array.filter((listener) => listener !== callback),
      );
    },
  };
}

function makeView(
  zoom = 16,
  rotation = 0.5,
): IOlView & { _listeners: Map<string, (() => void)[]>; _rotation: number } {
  const listeners = new Map<string, (() => void)[]>();
  const viewState = { rotation };
  return {
    _listeners: listeners,
    get _rotation() {
      return viewState.rotation;
    },
    padding: [0, 0, 0, 0],
    getCenter: () => undefined,
    setCenter: () => {},
    calculateExtent: () => [0, 0, 0, 0],
    changed: () => {},
    getRotation: () => viewState.rotation,
    setRotation: jest.fn((value: number) => {
      viewState.rotation = value;
    }),
    getZoom: () => zoom,
    setZoom: jest.fn(),
    on(type: string, callback: () => void) {
      const array = listeners.get(type) ?? [];
      array.push(callback);
      listeners.set(type, array);
    },
    un(type: string, callback: () => void) {
      const array = listeners.get(type) ?? [];
      listeners.set(
        type,
        array.filter((listener) => listener !== callback),
      );
    },
  };
}

function makeLayer(
  name: string,
  source: IOlVectorSource | null = null,
): IOlLayer & { _visible: boolean } {
  return {
    _visible: true,
    get: (key: string) => (key === 'name' ? name : undefined),
    getSource: () => source,
    setVisible(visible: boolean) {
      this._visible = visible;
    },
    getVisible() {
      return this._visible;
    },
  };
}

function makeMap(
  layers: IOlLayer[],
  view: IOlView,
): IOlMap & { _clickListeners: ((event: unknown) => void)[] } {
  const clickListeners: ((event: unknown) => void)[] = [];
  return {
    _clickListeners: clickListeners,
    getView: () => view,
    getSize: () => [800, 600],
    getLayers: () => ({ getArray: () => layers }),
    getInteractions: () => ({ getArray: () => [] }),
    addLayer: jest.fn(),
    removeLayer: jest.fn(),
    updateSize: jest.fn(),
    on: jest.fn((_type: string, listener: (event: unknown) => void) => {
      clickListeners.push(listener);
    }),
    un: jest.fn((_type: string, listener: (event: unknown) => void) => {
      const index = clickListeners.indexOf(listener);
      if (index >= 0) clickListeners.splice(index, 1);
    }),
    forEachFeatureAtPixel: jest.fn(),
  };
}

function setupInventoryDom(): void {
  document.body.innerHTML = `
    <div class="inventory">
      <div class="inventory__tabs">
        <span class="inventory__tab active" data-tab="1">Cores</span>
        <span class="inventory__tab" data-tab="3">Keys</span>
      </div>
      <div class="inventory__controls">
        <div><button id="inventory-sort">Sort</button></div>
        <div><button id="inventory-delete">Select</button></div>
      </div>
    </div>
    <div class="bottom-container"></div>
    <div class="self-info"><span id="self-info__inv">100</span></div>
    <input type="checkbox" id="toggle-follow" class="hidden">
  `;
}

function mockOl(): void {
  const featureProperties = new Map<IOlFeature, Record<string, unknown>>();

  window.ol = {
    Map: { prototype: { getView: jest.fn() } },
    source: {
      Vector: jest
        .fn()
        .mockImplementation(() => makeSource()) as unknown as new () => IOlVectorSource,
    },
    layer: {
      Vector: jest.fn().mockImplementation(() => makeLayer('svp-refs-on-map')) as unknown as new (
        opts: Record<string, unknown>,
      ) => IOlLayer,
    },
    Feature: jest.fn().mockImplementation(() => {
      const feature: IOlFeature = {
        getGeometry: () => ({ getCoordinates: () => [0, 0] }),
        getId: jest.fn(() => undefined),
        setId: jest.fn(function (this: IOlFeature, id: string) {
          (this as unknown as { _id: string })._id = id;
          (feature.getId as jest.Mock).mockReturnValue(id);
        }),
        setStyle: jest.fn(),
        get(key: string) {
          return featureProperties.get(feature)?.[key];
        },
        set(key: string, value: unknown) {
          const properties = featureProperties.get(feature) ?? {};
          properties[key] = value;
          featureProperties.set(feature, properties);
        },
        getProperties() {
          return featureProperties.get(feature) ?? {};
        },
      };
      return feature;
    }) as unknown as new (opts?: Record<string, unknown>) => IOlFeature,
    geom: {
      Point: jest.fn().mockImplementation((coords: number[]) => ({
        getCoordinates: () => coords,
      })) as unknown as new (coords: number[]) => { getCoordinates(): number[] },
    },
    proj: {
      fromLonLat: jest.fn((coords: number[]) => coords) as unknown as (
        coordinate: number[],
      ) => number[],
    },
    style: {
      Style: jest
        .fn()
        .mockImplementation((options: Record<string, unknown>) => options) as unknown as new (
        opts: Record<string, unknown>,
      ) => unknown,
      Text: jest
        .fn()
        .mockImplementation((options: Record<string, unknown>) => options) as unknown as new (
        opts: Record<string, unknown>,
      ) => unknown,
      Fill: jest
        .fn()
        .mockImplementation((options: Record<string, unknown>) => options) as unknown as new (
        opts: Record<string, unknown>,
      ) => unknown,
      Stroke: jest
        .fn()
        .mockImplementation((options: Record<string, unknown>) => options) as unknown as new (
        opts: Record<string, unknown>,
      ) => unknown,
      Circle: jest
        .fn()
        .mockImplementation((options: Record<string, unknown>) => options) as unknown as new (
        opts: Record<string, unknown>,
      ) => unknown,
    },
  };
}

function setInventoryCache(): void {
  const items = [
    { t: 3, a: 4, c: [100.5, 13.7], g: 'ref-1', l: 'point-1', ti: 'Test Point' },
    { t: 3, a: 2, c: [101.0, 14.0], g: 'ref-2', l: 'point-2', ti: 'Other Point' },
  ];
  localStorage.setItem('inventory-cache', JSON.stringify(items));
}

// ── isInventoryRefFull ───────────────────────────────────────────────────────

describe('isInventoryRefFull', () => {
  test('accepts valid ref item', () => {
    expect(
      isInventoryRefFull({ t: 3, a: 5, c: [100.5, 13.7], g: 'ref-1', l: 'point-1', ti: 'Title' }),
    ).toBe(true);
  });

  test('rejects non-ref type', () => {
    expect(
      isInventoryRefFull({ t: 1, a: 5, c: [100.5, 13.7], g: 'ref-1', l: 'point-1', ti: 'Title' }),
    ).toBe(false);
  });

  test('rejects missing coords', () => {
    expect(isInventoryRefFull({ t: 3, a: 5, g: 'ref-1', l: 'point-1', ti: 'Title' })).toBe(false);
  });

  test('rejects non-array coords', () => {
    expect(
      isInventoryRefFull({ t: 3, a: 5, c: 'bad', g: 'ref-1', l: 'point-1', ti: 'Title' }),
    ).toBe(false);
  });

  test('rejects coords with wrong length', () => {
    expect(isInventoryRefFull({ t: 3, a: 5, c: [1], g: 'ref-1', l: 'point-1', ti: 'Title' })).toBe(
      false,
    );
  });

  test('rejects missing title', () => {
    expect(isInventoryRefFull({ t: 3, a: 5, c: [1, 2], g: 'ref-1', l: 'point-1' })).toBe(false);
  });

  test('rejects null', () => {
    expect(isInventoryRefFull(null)).toBe(false);
  });

  test('rejects primitive', () => {
    expect(isInventoryRefFull(42)).toBe(false);
  });
});

// ── readRefsFromCache ────────────────────────────────────────────────────────

describe('readRefsFromCache', () => {
  afterEach(() => {
    localStorage.removeItem('inventory-cache');
  });

  test('returns empty array when no cache', () => {
    expect(readRefsFromCache()).toEqual([]);
  });

  test('returns empty array on invalid JSON', () => {
    localStorage.setItem('inventory-cache', '{broken');
    expect(readRefsFromCache()).toEqual([]);
  });

  test('returns empty array when cache is not array', () => {
    localStorage.setItem('inventory-cache', '{"t":3}');
    expect(readRefsFromCache()).toEqual([]);
  });

  test('filters only valid ref items', () => {
    const items = [
      { t: 3, a: 2, c: [100, 13], g: 'r1', l: 'p1', ti: 'A' },
      { t: 1, a: 5, l: 'p2' },
      { t: 3, a: 1, c: [101, 14], g: 'r2', l: 'p2', ti: 'B' },
    ];
    localStorage.setItem('inventory-cache', JSON.stringify(items));
    const result = readRefsFromCache();
    expect(result).toHaveLength(2);
    expect(result[0].g).toBe('r1');
    expect(result[1].g).toBe('r2');
  });
});

// ── module metadata ──────────────────────────────────────────────────────────

describe('refsOnMap metadata', () => {
  test('has correct id', () => {
    expect(refsOnMap.id).toBe('refsOnMap');
  });

  test('has feature category', () => {
    expect(refsOnMap.category).toBe('feature');
  });

  test('is enabled by default', () => {
    expect(refsOnMap.defaultEnabled).toBe(true);
  });

  test('has localized name and description', () => {
    expect(refsOnMap.name.ru).toBeTruthy();
    expect(refsOnMap.name.en).toBeTruthy();
    expect(refsOnMap.description.ru).toBeTruthy();
    expect(refsOnMap.description.en).toBeTruthy();
  });
});

// ── enable / disable ─────────────────────────────────────────────────────────

jest.mock('../../core/olMap', () => ({
  getOlMap: jest.fn(),
}));

import { getOlMap } from '../../core/olMap';

const mockGetOlMap = getOlMap as jest.MockedFunction<typeof getOlMap>;

describe('refsOnMap enable/disable', () => {
  let view: ReturnType<typeof makeView>;
  let map: ReturnType<typeof makeMap>;

  beforeEach(() => {
    localStorage.removeItem('inventory-cache');
    setupInventoryDom();
    view = makeView(16, 0.5);
    const pointsLayer = makeLayer('points', makeSource());
    const linesLayer = makeLayer('lines', makeSource());
    const regionsLayer = makeLayer('regions', makeSource());
    map = makeMap([pointsLayer, linesLayer, regionsLayer], view);
    mockGetOlMap.mockResolvedValue(map);
    mockOl();
  });

  afterEach(async () => {
    await refsOnMap.disable();
    delete window.ol;
    document.body.innerHTML = '';
  });

  test('adds layer to map on enable', async () => {
    await refsOnMap.enable();
    expect((map.addLayer as jest.Mock).mock.calls.length).toBeGreaterThan(0);
  });

  test('removes layer from map on disable', async () => {
    await refsOnMap.enable();
    await refsOnMap.disable();
    expect((map.removeLayer as jest.Mock).mock.calls.length).toBeGreaterThan(0);
  });

  test('creates show button in inventory controls', async () => {
    await refsOnMap.enable();
    const button = document.querySelector('.svp-refs-on-map-button');
    expect(button).not.toBeNull();
    expect(button?.textContent).toMatch(/map|карте/i);
  });

  test('creates close button and trash button', async () => {
    await refsOnMap.enable();
    expect(document.querySelector('.svp-refs-on-map-close')).not.toBeNull();
    expect(document.querySelector('.svp-refs-on-map-trash')).not.toBeNull();
  });

  test('removes all buttons on disable', async () => {
    await refsOnMap.enable();
    await refsOnMap.disable();
    expect(document.querySelector('.svp-refs-on-map-button')).toBeNull();
    expect(document.querySelector('.svp-refs-on-map-close')).toBeNull();
    expect(document.querySelector('.svp-refs-on-map-trash')).toBeNull();
  });

  test('show button is hidden when not on refs tab', async () => {
    await refsOnMap.enable();
    const button = document.querySelector('.svp-refs-on-map-button') as HTMLElement;
    expect(button.style.display).toBe('none');
  });

  test('show button becomes visible when refs tab is active', async () => {
    await refsOnMap.enable();

    const tabs = document.querySelectorAll('.inventory__tab');
    tabs.forEach((tab) => {
      tab.classList.remove('active');
    });
    tabs[1].classList.add('active');

    const tabContainer = document.querySelector('.inventory__tabs');
    tabContainer?.dispatchEvent(new Event('click', { bubbles: true }));

    const button = document.querySelector('.svp-refs-on-map-button') as HTMLElement;
    expect(button.style.display).toBe('');
  });

  test('does nothing if ol constructors are absent', async () => {
    window.ol = { Map: { prototype: { getView: jest.fn() } } };
    await refsOnMap.enable();
    expect((map.addLayer as jest.Mock).mock.calls.length).toBe(0);
  });
});

// ── viewer open/close ────────────────────────────────────────────────────────

describe('refsOnMap viewer', () => {
  let view: ReturnType<typeof makeView>;
  let map: ReturnType<typeof makeMap>;

  function clickShowButton(): void {
    const button = document.querySelector('.svp-refs-on-map-button') as HTMLElement;
    button.click();
  }

  function clickCloseButton(): void {
    const button = document.querySelector('.svp-refs-on-map-close') as HTMLElement;
    button.click();
  }

  beforeEach(async () => {
    setupInventoryDom();
    view = makeView(16, 0.5);
    const pointsLayer = makeLayer('points', makeSource());
    const linesLayer = makeLayer('lines', makeSource());
    const regionsLayer = makeLayer('regions', makeSource());
    map = makeMap([pointsLayer, linesLayer, regionsLayer], view);
    mockGetOlMap.mockResolvedValue(map);
    mockOl();
    await refsOnMap.enable();
  });

  afterEach(async () => {
    await refsOnMap.disable();
    delete window.ol;
    localStorage.removeItem('inventory-cache');
    localStorage.removeItem('follow');
    document.body.innerHTML = '';
  });

  test('disables follow mode when opening viewer', () => {
    localStorage.setItem('follow', 'true');
    const checkbox = document.querySelector('#toggle-follow') as HTMLInputElement;
    checkbox.checked = true;

    setInventoryCache();
    clickShowButton();

    expect(localStorage.getItem('follow')).toBe('false');
    expect(checkbox.checked).toBe(false);
  });

  test('restores follow mode when closing viewer', () => {
    localStorage.setItem('follow', 'true');
    const checkbox = document.querySelector('#toggle-follow') as HTMLInputElement;
    checkbox.checked = true;

    setInventoryCache();
    clickShowButton();
    clickCloseButton();

    expect(localStorage.getItem('follow')).toBe('true');
    expect(checkbox.checked).toBe(true);
  });

  test('resets rotation to 0 when opening viewer', () => {
    setInventoryCache();
    clickShowButton();

    expect(view.setRotation).toHaveBeenCalledWith(0);
    expect(view._rotation).toBe(0);
  });

  test('restores rotation when closing viewer', () => {
    setInventoryCache();
    clickShowButton();
    clickCloseButton();

    expect(view.setRotation).toHaveBeenLastCalledWith(0.5);
    expect(view._rotation).toBe(0.5);
  });

  test('attaches click handler to map when opening', () => {
    setInventoryCache();
    clickShowButton();

    expect(map.on).toHaveBeenCalledWith('click', expect.any(Function));
  });

  test('removes click handler from map when closing', () => {
    setInventoryCache();
    clickShowButton();
    clickCloseButton();

    expect(map.un).toHaveBeenCalledWith('click', expect.any(Function));
  });

  test('shows trash button when viewer opens', () => {
    setInventoryCache();
    clickShowButton();

    const trash = document.querySelector('.svp-refs-on-map-trash') as HTMLElement;
    expect(trash.style.display).toBe('');
  });

  test('hides trash button when viewer closes', () => {
    setInventoryCache();
    clickShowButton();
    clickCloseButton();

    const trash = document.querySelector('.svp-refs-on-map-trash') as HTMLElement;
    expect(trash.style.display).toBe('none');
  });
});
