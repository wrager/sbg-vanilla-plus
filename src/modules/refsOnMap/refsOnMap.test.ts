import { refsOnMap } from './refsOnMap';
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
      Vector: jest
        .fn()
        .mockImplementation((opts: Record<string, unknown>) =>
          makeLayer('svp-refs-on-map', (opts.source ?? null) as IOlVectorSource | null),
        ) as unknown as new (opts: Record<string, unknown>) => IOlLayer,
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

jest.mock('../../core/settings/storage', () => ({
  loadSettings: jest.fn(() => ({ version: 3, modules: {}, errors: {} })),
  isModuleEnabled: jest.fn(() => true),
}));

const mockNgrsZoomModule = {
  id: 'ngrsZoom',
  defaultEnabled: true,
  enable: jest.fn(() => Promise.resolve()),
  disable: jest.fn(),
};

jest.mock('../../core/moduleRegistry', () => {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return -- jest.requireActual returns any
  return {
    ...jest.requireActual('../../core/moduleRegistry'),
    getModuleById: jest.fn((id: string) => (id === 'ngrsZoom' ? mockNgrsZoomModule : undefined)),
    // По умолчанию защита активна, но `isFavorited` mocked возвращает false для всех GUID,
    // так что в существующих тестах поведение не меняется (isFavorite=false у всех фич).
    isModuleActive: jest.fn((id: string) => id === 'favoritedPoints'),
  };
});

jest.mock('../../core/favoritesStore', () => ({
  isFavorited: jest.fn(() => false),
  getFavoritedGuids: jest.fn(() => new Set<string>()),
  isFavoritesSnapshotReady: jest.fn(() => true),
}));

import { getOlMap } from '../../core/olMap';
import { isModuleEnabled } from '../../core/settings/storage';
import { isModuleActive } from '../../core/moduleRegistry';
import {
  isFavorited,
  getFavoritedGuids,
  isFavoritesSnapshotReady,
} from '../../core/favoritesStore';

const mockGetOlMap = getOlMap as jest.MockedFunction<typeof getOlMap>;
const mockIsModuleEnabled = isModuleEnabled as jest.MockedFunction<typeof isModuleEnabled>;
const mockIsModuleActive = isModuleActive as jest.MockedFunction<typeof isModuleActive>;
const mockIsFavorited = isFavorited as jest.MockedFunction<typeof isFavorited>;
const mockGetFavoritedGuids = getFavoritedGuids as jest.MockedFunction<typeof getFavoritedGuids>;
const mockIsFavoritesSnapshotReady = isFavoritesSnapshotReady as jest.MockedFunction<
  typeof isFavoritesSnapshotReady
>;

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

  test('частичный провал enable: слой и hidden-кнопки снимаются с DOM', async () => {
    // Заставляем OlVectorLayer constructor бросать — это случится после того
    // как injectStyles уже отработал и OlVectorSource уже создан, но до
    // создания hidden-кнопок. Проверяем что enable() cleanup'ает state.
    const ol = window.ol;
    if (!ol?.layer) throw new Error('ol.layer not mocked');
    (ol.layer.Vector as jest.Mock).mockImplementationOnce(() => {
      throw new Error('OlVectorLayer constructor failed');
    });

    await expect(refsOnMap.enable()).rejects.toThrow('OlVectorLayer constructor failed');

    // Стили должны быть сняты.
    expect(document.getElementById('svp-refsOnMap')).toBeNull();
    // Hidden-кнопки не должны висеть в DOM (на момент падения они ещё
    // не были созданы, но проверим инвариант).
    expect(document.querySelector('.svp-refs-on-map-close')).toBeNull();
    expect(document.querySelector('.svp-refs-on-map-trash')).toBeNull();
    // showButton на момент падения тоже ещё не создан.
    expect(document.querySelector('.svp-refs-on-map-button')).toBeNull();
  });

  test('частичный провал после создания showButton: все элементы убраны', async () => {
    // Заставляем document.body.appendChild бросать на третьем вызове
    // (showButton вставляется через insertBefore в inventory, closeButton
    // и trashButton — через document.body.appendChild). Первый appendChild
    // на closeButton должен упасть.
    const originalAppendChild = document.body.appendChild.bind(document.body);
    let callCount = 0;
    const appendSpy = jest
      .spyOn(document.body, 'appendChild')
      .mockImplementation(<T extends Node>(node: T): T => {
        callCount++;
        if (callCount === 1) {
          throw new Error('appendChild boom on closeButton');
        }
        return originalAppendChild(node);
      });

    await expect(refsOnMap.enable()).rejects.toThrow('appendChild boom');
    appendSpy.mockRestore();

    // showButton уже был вставлен в inventory-delete parent, должен быть снят.
    expect(document.querySelector('.svp-refs-on-map-button')).toBeNull();
    // closeButton/trashButton не были созданы до конца или не прикреплены.
    expect(document.querySelector('.svp-refs-on-map-close')).toBeNull();
    expect(document.querySelector('.svp-refs-on-map-trash')).toBeNull();
    // Стили сняты.
    expect(document.getElementById('svp-refsOnMap')).toBeNull();
    // Слой из карты удалён.
    expect((map.removeLayer as jest.Mock).mock.calls.length).toBeGreaterThan(0);
  });

  test('getOlMap reject: стили откатываются', async () => {
    mockGetOlMap.mockRejectedValueOnce(new Error('getOlMap rejected'));

    await expect(refsOnMap.enable()).rejects.toThrow('getOlMap rejected');

    expect(document.getElementById('svp-refsOnMap')).toBeNull();
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
    mockNgrsZoomModule.disable.mockClear();
    mockNgrsZoomModule.enable.mockClear();
    mockIsModuleEnabled.mockReturnValue(true);
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

  test('disables ngrsZoom when opening viewer', () => {
    mockIsModuleEnabled.mockReturnValue(true);
    setInventoryCache();
    clickShowButton();

    expect(mockNgrsZoomModule.disable).toHaveBeenCalled();
  });

  test('restores ngrsZoom when closing viewer', () => {
    mockIsModuleEnabled.mockReturnValue(true);
    setInventoryCache();
    clickShowButton();
    clickCloseButton();

    expect(mockNgrsZoomModule.enable).toHaveBeenCalled();
  });

  test('does not disable ngrsZoom when it is not enabled', () => {
    mockIsModuleEnabled.mockReturnValue(false);
    mockNgrsZoomModule.disable.mockClear();
    setInventoryCache();
    clickShowButton();

    expect(mockNgrsZoomModule.disable).not.toHaveBeenCalled();
  });

  test('does not restore ngrsZoom if it was not disabled by viewer', () => {
    mockIsModuleEnabled.mockReturnValue(false);
    (mockNgrsZoomModule.enable as jest.Mock).mockClear();
    setInventoryCache();
    clickShowButton();
    clickCloseButton();

    expect(mockNgrsZoomModule.enable).not.toHaveBeenCalled();
  });
});

// ── favorites protection ─────────────────────────────────────────────────────

describe('refsOnMap: защита избранных', () => {
  let view: ReturnType<typeof makeView>;
  let map: ReturnType<typeof makeMap>;
  let confirmSpy: jest.SpyInstance;
  let alertSpy: jest.SpyInstance;
  let consoleWarnSpy: jest.SpyInstance;
  let fetchMock: jest.Mock;
  const originalFetch = global.fetch;

  function clickShowButton(): void {
    const button = document.querySelector('.svp-refs-on-map-button') as HTMLElement;
    button.click();
  }

  function getSourceFromLayer(): ReturnType<typeof makeSource> {
    const calls = (map.addLayer as jest.Mock).mock.calls as [IOlLayer][];
    if (calls.length === 0) throw new Error('no layer added');
    return calls[0][0].getSource() as ReturnType<typeof makeSource>;
  }

  function selectFeature(source: ReturnType<typeof makeSource>, pointGuid: string): IOlFeature {
    const feature = source.getFeatures().find((f) => f.get?.('pointGuid') === pointGuid);
    if (!feature) throw new Error(`feature for ${pointGuid} not found`);
    feature.set?.('isSelected', true);
    return feature;
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

    mockIsModuleActive.mockImplementation((id: string) => id === 'favoritedPoints');
    mockIsFavorited.mockReturnValue(false);
    mockGetFavoritedGuids.mockReturnValue(new Set<string>());
    mockIsFavoritesSnapshotReady.mockReturnValue(true);

    confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true);
    alertSpy = jest.spyOn(window, 'alert').mockImplementation();
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
    // Два вида запросов: /api/point?guid=... (загрузка команды точек, вызывается
    // внутри loadTeamDataForRefs после showViewer) и /api/inventory (DELETE при
    // trash). Разделяем по наличию method=DELETE в options.
    fetchMock = jest.fn().mockImplementation((_url: string, opts?: RequestInit) => {
      if (opts?.method === 'DELETE') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ count: { total: 100 } }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ data: { te: 1 } }),
      });
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await refsOnMap.enable();
  });

  afterEach(async () => {
    await refsOnMap.disable();
    delete window.ol;
    localStorage.removeItem('inventory-cache');
    localStorage.removeItem('follow');
    document.body.innerHTML = '';
    confirmSpy.mockRestore();
    alertSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    global.fetch = originalFetch;
    mockIsFavorited.mockReturnValue(false);
    mockGetFavoritedGuids.mockReturnValue(new Set<string>());
    mockIsFavoritesSnapshotReady.mockReturnValue(true);
    mockIsModuleActive.mockImplementation((id: string) => id === 'favoritedPoints');
  });

  async function clickTrash(): Promise<void> {
    const trash = document.querySelector('.svp-refs-on-map-trash') as HTMLElement;
    trash.click();
    // handleDeleteClick — async: await deleteRefsFromServer + await response.json().
    // Даём микротаскам прокрутиться до конца.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  function getDeleteCalls(): Array<[string, { body: string; method: string }]> {
    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit | undefined]>;
    return calls.filter((call) => call[1]?.method === 'DELETE') as unknown as Array<
      [string, { body: string; method: string }]
    >;
  }

  // ── Уровень 1: визуал ─────────────────────────────────────────────────────

  test('T4.V1: showViewer выставляет isFavorite у фич с pointGuid в избранных', () => {
    mockIsFavorited.mockImplementation((guid: string) => guid === 'point-1');
    setInventoryCache();
    clickShowButton();

    const source = getSourceFromLayer();
    const feature1 = source.getFeatures().find((f) => f.get?.('pointGuid') === 'point-1');
    const feature2 = source.getFeatures().find((f) => f.get?.('pointGuid') === 'point-2');
    expect(feature1?.get?.('isFavorite')).toBe(true);
    expect(feature2?.get?.('isFavorite')).toBe(false);
  });

  test('T4.V2: модуль выключен — isFavorite=false у всех фич', () => {
    mockIsModuleActive.mockReturnValue(false);
    mockIsFavorited.mockReturnValue(true);
    setInventoryCache();
    clickShowButton();

    const source = getSourceFromLayer();
    for (const feature of source.getFeatures()) {
      expect(feature.get?.('isFavorite')).toBe(false);
    }
  });

  test('T4.V3: snapshot не готов — isFavorite=false у всех (защита сработает в delete click)', () => {
    mockIsFavoritesSnapshotReady.mockReturnValue(false);
    mockIsFavorited.mockReturnValue(true);
    setInventoryCache();
    clickShowButton();

    const source = getSourceFromLayer();
    for (const feature of source.getFeatures()) {
      expect(feature.get?.('isFavorite')).toBe(false);
    }
  });

  // ── Уровень 2: клик ───────────────────────────────────────────────────────

  test('T4.C1: клик по isFavorite=true фиче — isSelected не меняется', () => {
    mockIsFavorited.mockImplementation((guid: string) => guid === 'point-1');
    setInventoryCache();
    clickShowButton();

    const source = getSourceFromLayer();
    const feature = source.getFeatures().find((f) => f.get?.('pointGuid') === 'point-1');
    if (!feature) throw new Error('feature not found');

    // Симуляция forEachFeatureAtPixel: последний зарегистрированный listener —
    // это handleMapClick (сам виртуальный клик мы не можем имитировать в OL-mock'е,
    // но можем вызвать тот же путь напрямую через forEachFeatureAtPixel jest.fn).
    const forEachMock = map.forEachFeatureAtPixel as jest.Mock;
    forEachMock.mockImplementation((_pixel: unknown, callback: (f: IOlFeature) => void) => {
      callback(feature);
    });
    const clickListeners = map._clickListeners;
    expect(clickListeners.length).toBeGreaterThan(0);
    clickListeners[0]({ pixel: [0, 0] });

    expect(feature.get?.('isSelected')).not.toBe(true);
  });

  test('T4.C2: клик по обычной фиче — isSelected меняется (регрессия)', () => {
    setInventoryCache();
    clickShowButton();

    const source = getSourceFromLayer();
    const feature = source.getFeatures().find((f) => f.get?.('pointGuid') === 'point-1');
    if (!feature) throw new Error('feature not found');

    (map.forEachFeatureAtPixel as jest.Mock).mockImplementation(
      (_pixel: unknown, callback: (f: IOlFeature) => void) => {
        callback(feature);
      },
    );
    map._clickListeners[0]({ pixel: [0, 0] });

    expect(feature.get?.('isSelected')).toBe(true);
  });

  test('T4.C3: freshness — isFavorite=false на фиче, но isFavorited вернул true — клик блокируется', () => {
    // На момент showViewer точка не избранная.
    setInventoryCache();
    clickShowButton();

    const source = getSourceFromLayer();
    const feature = source.getFeatures().find((f) => f.get?.('pointGuid') === 'point-1');
    if (!feature) throw new Error('feature not found');
    expect(feature.get?.('isFavorite')).toBe(false);

    // Пользователь добавил точку в избранные — isFavorited начинает возвращать true.
    mockIsFavorited.mockImplementation((guid: string) => guid === 'point-1');

    (map.forEachFeatureAtPixel as jest.Mock).mockImplementation(
      (_pixel: unknown, callback: (f: IOlFeature) => void) => {
        callback(feature);
      },
    );
    map._clickListeners[0]({ pixel: [0, 0] });

    expect(feature.get?.('isSelected')).not.toBe(true);
  });

  test('T4.C4: freshness не срабатывает если модуль выключен — клик проходит', () => {
    mockIsModuleActive.mockReturnValue(false);
    setInventoryCache();
    clickShowButton();

    const source = getSourceFromLayer();
    const feature = source.getFeatures().find((f) => f.get?.('pointGuid') === 'point-1');
    if (!feature) throw new Error('feature not found');

    mockIsFavorited.mockReturnValue(true);

    (map.forEachFeatureAtPixel as jest.Mock).mockImplementation(
      (_pixel: unknown, callback: (f: IOlFeature) => void) => {
        callback(feature);
      },
    );
    map._clickListeners[0]({ pixel: [0, 0] });

    expect(feature.get?.('isSelected')).toBe(true);
  });

  // ── Уровень 3: delete guard ───────────────────────────────────────────────

  test('T4.D1: snapshot не готов — alert показан, fetch не вызван', async () => {
    setInventoryCache();
    clickShowButton();
    const source = getSourceFromLayer();
    selectFeature(source, 'point-1');
    // Вручную обновляем счётчик — в реальности его бы обновил toggleFeatureSelection.
    const trash = document.querySelector('.svp-refs-on-map-trash') as HTMLElement;
    trash.style.visibility = 'visible';
    trash.textContent = '🗑️ 1';

    mockIsFavoritesSnapshotReady.mockReturnValue(false);
    // Чтобы handleDeleteClick дошёл до guard'а snapshot, uniqueRefsToDelete>0.
    // Эмулируем клик для увеличения счётчика: через mock forEach + listener.
    (map.forEachFeatureAtPixel as jest.Mock).mockImplementation(
      (_pixel: unknown, callback: (f: IOlFeature) => void) => {
        const feature = source.getFeatures().find((f) => f.get?.('pointGuid') === 'point-2');
        if (feature) callback(feature);
      },
    );
    map._clickListeners[0]({ pixel: [0, 0] });

    await clickTrash();

    expect(alertSpy).toHaveBeenCalled();
    expect(getDeleteCalls()).toHaveLength(0);
  });

  test('T4.D2: смешанный выбор — избранная исключается, не-избранные отправляются в DELETE', async () => {
    const items = [
      { t: 3, a: 4, c: [100.5, 13.7], g: 'ref-1', l: 'point-1', ti: 'P1' },
      { t: 3, a: 2, c: [101.0, 14.0], g: 'ref-2', l: 'point-2', ti: 'P2' },
      { t: 3, a: 3, c: [102.0, 15.0], g: 'ref-3', l: 'point-3', ti: 'P3' },
    ];
    localStorage.setItem('inventory-cache', JSON.stringify(items));
    mockGetFavoritedGuids.mockReturnValue(new Set(['point-2']));
    mockIsFavorited.mockImplementation((guid: string) => guid === 'point-2');

    clickShowButton();
    const source = getSourceFromLayer();

    // Выбираем все три вручную (клик по избранной в реальности заблокирован,
    // но тест специально проверяет финальный guard — что даже если выбор
    // каким-то образом прошёл, DELETE фильтрует).
    for (const pointGuid of ['point-1', 'point-2', 'point-3']) {
      selectFeature(source, pointGuid);
    }

    // Поднимаем счётчик искусственно через клики по обычным фичам.
    for (const pointGuid of ['point-1', 'point-3']) {
      const f = source.getFeatures().find((x) => x.get?.('pointGuid') === pointGuid);
      if (!f) throw new Error(`${pointGuid} not found`);
      f.set?.('isSelected', false);
      (map.forEachFeatureAtPixel as jest.Mock).mockImplementation(
        (_p: unknown, cb: (x: IOlFeature) => void) => {
          cb(f);
        },
      );
      map._clickListeners[0]({ pixel: [0, 0] });
    }

    await clickTrash();

    const deleteCalls = getDeleteCalls();
    expect(deleteCalls).toHaveLength(1);
    const body = JSON.parse(deleteCalls[0][1].body) as {
      selection: Record<string, number>;
      tab: number;
    };
    expect(body.selection).toEqual({ 'ref-1': 4, 'ref-3': 3 });
    expect(body.selection['ref-2']).toBeUndefined();
    expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining('избранных'));

    // Избранная фича осталась в source, не-избранные удалены.
    const remainingGuids = source.getFeatures().map((f) => f.get?.('pointGuid'));
    expect(remainingGuids).toContain('point-2');
    expect(remainingGuids).not.toContain('point-1');
    expect(remainingGuids).not.toContain('point-3');
  });

  test('T4.D3: все выбранные — избранные, alert показан, fetch не вызван', async () => {
    setInventoryCache();
    // Сценарий: на момент showViewer никто не избранный — клики разрешены, счётчик
    // инкрементируется. Перед trash все выбранные становятся избранными (пользователь
    // добавил их в избранные), финальный guard исключает их всех, items пуст —
    // показываем alert «все избранные, удаление отменено».
    setInventoryCache();
    clickShowButton();
    const source = getSourceFromLayer();

    for (const pointGuid of ['point-1', 'point-2']) {
      const f = source.getFeatures().find((x) => x.get?.('pointGuid') === pointGuid);
      if (!f) throw new Error(`${pointGuid} not found`);
      (map.forEachFeatureAtPixel as jest.Mock).mockImplementation(
        (_p: unknown, cb: (x: IOlFeature) => void) => {
          cb(f);
        },
      );
      map._clickListeners[0]({ pixel: [0, 0] });
    }

    // Перед trash — обе точки становятся избранными (runtime-переключение).
    mockGetFavoritedGuids.mockReturnValue(new Set(['point-1', 'point-2']));
    mockIsFavorited.mockImplementation((guid: string) => guid === 'point-1' || guid === 'point-2');

    await clickTrash();

    expect(getDeleteCalls()).toHaveLength(0);
    expect(alertSpy).toHaveBeenCalled();
  });

  test('T4.D4: freshness — getFavoritedGuids стал содержать pointGuid между showViewer и trash', async () => {
    setInventoryCache();
    clickShowButton(); // на момент showViewer никто не избранный
    const source = getSourceFromLayer();

    const feature1 = source.getFeatures().find((f) => f.get?.('pointGuid') === 'point-1');
    const feature2 = source.getFeatures().find((f) => f.get?.('pointGuid') === 'point-2');
    if (!feature1 || !feature2) throw new Error('features not found');

    // Кликаем по обеим, чтобы счётчик стал 2.
    for (const f of [feature1, feature2]) {
      (map.forEachFeatureAtPixel as jest.Mock).mockImplementation(
        (_p: unknown, cb: (x: IOlFeature) => void) => {
          cb(f);
        },
      );
      map._clickListeners[0]({ pixel: [0, 0] });
    }
    expect(feature1.get?.('isSelected')).toBe(true);
    expect(feature2.get?.('isSelected')).toBe(true);

    // Перед trash — добавляем point-1 в избранные. На feature1 флаг isFavorite
    // всё ещё false (снапшот устарел), но getFavoritedGuids уже включает point-1.
    mockGetFavoritedGuids.mockReturnValue(new Set(['point-1']));

    await clickTrash();

    const deleteCalls = getDeleteCalls();
    expect(deleteCalls).toHaveLength(1);
    const body = JSON.parse(deleteCalls[0][1].body) as {
      selection: Record<string, number>;
    };
    expect(body.selection['ref-1']).toBeUndefined();
    expect(body.selection['ref-2']).toBe(2);
  });

  test('T4.D5: защита выключена — избранные удаляются как обычные', async () => {
    mockIsModuleActive.mockReturnValue(false);
    setInventoryCache();
    mockIsFavorited.mockReturnValue(true); // не важно — защита выключена
    mockGetFavoritedGuids.mockReturnValue(new Set(['point-1', 'point-2']));

    clickShowButton();
    const source = getSourceFromLayer();

    for (const pointGuid of ['point-1', 'point-2']) {
      const f = source.getFeatures().find((x) => x.get?.('pointGuid') === pointGuid);
      if (!f) throw new Error(`${pointGuid} not found`);
      (map.forEachFeatureAtPixel as jest.Mock).mockImplementation(
        (_p: unknown, cb: (x: IOlFeature) => void) => {
          cb(f);
        },
      );
      map._clickListeners[0]({ pixel: [0, 0] });
    }

    await clickTrash();

    const deleteCalls = getDeleteCalls();
    expect(deleteCalls).toHaveLength(1);
    const body = JSON.parse(deleteCalls[0][1].body) as {
      selection: Record<string, number>;
    };
    expect(body.selection['ref-1']).toBe(4);
    expect(body.selection['ref-2']).toBe(2);
  });
});

// ── removeRefsFromCache defence-in-depth ─────────────────────────────────────

describe('refsOnMap: removeRefsFromCache (defence-in-depth)', () => {
  // removeRefsFromCache — internal функция. Протестируем её через публичный путь
  // handleDeleteClick, но задача R1-R4 — документация контракта, а не новая механика.
  // Основная защита — на delete guard (T4.D2/D3/D4). Здесь только проверим, что при
  // patологическом вызове removeRefsFromCache с GUID избранной записи кэш не теряет
  // эту запись. Тестируем через handleDeleteClick flow с принудительно исправленным
  // deletedGuids — через side-effect, не прямым доступом.

  test('R1/R2: кэш сохраняет избранную запись при успешном DELETE (косвенно, через flow)', async () => {
    // Этот кейс частично дублирует T4.D2: после DELETE point-1 и point-3 кэш
    // не содержит ref-1/ref-3, но содержит ref-2 (избранный). R1 (сохранение
    // избранного при попадании в deletedGuids) проверяется через console.warn
    // и присутствие записи.
    const items = [
      { t: 3, a: 4, c: [100.5, 13.7], g: 'ref-1', l: 'point-1', ti: 'P1' },
      { t: 3, a: 2, c: [101.0, 14.0], g: 'ref-2', l: 'point-2', ti: 'P2' },
    ];
    localStorage.setItem('inventory-cache', JSON.stringify(items));

    setupInventoryDom();
    const view = makeView(16, 0.5);
    const map = makeMap(
      [makeLayer('points', makeSource()), makeLayer('lines', makeSource())],
      view,
    );
    mockGetOlMap.mockResolvedValue(map);
    mockOl();
    mockIsFavoritesSnapshotReady.mockReturnValue(true);
    mockIsFavorited.mockImplementation((guid: string) => guid === 'point-2');
    mockGetFavoritedGuids.mockReturnValue(new Set(['point-2']));
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true);
    const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
    const savedFetch = global.fetch;
    const fetchMockLocal = jest.fn().mockImplementation((_url: string, opts?: RequestInit) => {
      if (opts?.method === 'DELETE') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ count: { total: 50 } }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ data: { te: 1 } }),
      });
    });
    global.fetch = fetchMockLocal as unknown as typeof fetch;

    await refsOnMap.enable();
    (document.querySelector('.svp-refs-on-map-button') as HTMLElement).click();

    const addLayerCalls = (map.addLayer as jest.Mock).mock.calls as [IOlLayer][];
    const sourceLayer = addLayerCalls[0][0];
    const source = sourceLayer.getSource() as ReturnType<typeof makeSource>;
    const f1 = source.getFeatures().find((f) => f.get?.('pointGuid') === 'point-1');
    if (!f1) throw new Error('f1 not found');
    (map.forEachFeatureAtPixel as jest.Mock).mockImplementation(
      (_p: unknown, cb: (x: IOlFeature) => void) => {
        cb(f1);
      },
    );
    map._clickListeners[0]({ pixel: [0, 0] });

    const trash = document.querySelector('.svp-refs-on-map-trash') as HTMLElement;
    trash.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const cache = JSON.parse(localStorage.getItem('inventory-cache') ?? '[]') as {
      g: string;
    }[];
    const cacheGuids = cache.map((item) => item.g);
    // ref-1 удалён (не избранный), ref-2 остался (избранный).
    expect(cacheGuids).not.toContain('ref-1');
    expect(cacheGuids).toContain('ref-2');

    await refsOnMap.disable();
    confirmSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    global.fetch = savedFetch;
    expect(fetchMockLocal).toHaveBeenCalled();
    delete window.ol;
    localStorage.removeItem('inventory-cache');
    document.body.innerHTML = '';
  });
});
