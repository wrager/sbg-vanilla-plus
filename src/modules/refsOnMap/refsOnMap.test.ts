import { refsOnMap, uninstallInviewFetchHookForTest } from './refsOnMap';
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
): IOlMap & {
  _clickListeners: ((event: unknown) => void)[];
  _moveendListeners: (() => void)[];
} {
  const clickListeners: ((event: unknown) => void)[] = [];
  const moveendListeners: (() => void)[] = [];
  return {
    _clickListeners: clickListeners,
    _moveendListeners: moveendListeners,
    getView: () => view,
    getSize: () => [800, 600],
    getLayers: () => ({ getArray: () => layers }),
    getInteractions: () => ({ getArray: () => [] }),
    addLayer: jest.fn(),
    removeLayer: jest.fn(),
    updateSize: jest.fn(),
    on: jest.fn((type: string, listener: (event: unknown) => void) => {
      // OL диспетчеризует click через map.on('click', ...) и moveend через
      // map.on('moveend', ...). Раскладываем по подходящим листенерам, чтобы
      // тесты могли симулировать каждый тип независимо.
      if (type === 'moveend') {
        moveendListeners.push(listener as () => void);
        return;
      }
      clickListeners.push(listener);
    }),
    un: jest.fn((type: string, listener: (event: unknown) => void) => {
      if (type === 'moveend') {
        const index = moveendListeners.indexOf(listener as () => void);
        if (index >= 0) moveendListeners.splice(index, 1);
        return;
      }
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
        options: Record<string, unknown>,
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
        options: Record<string, unknown>,
      ) => unknown,
      Text: jest
        .fn()
        .mockImplementation((options: Record<string, unknown>) => options) as unknown as new (
        options: Record<string, unknown>,
      ) => unknown,
      Fill: jest
        .fn()
        .mockImplementation((options: Record<string, unknown>) => options) as unknown as new (
        options: Record<string, unknown>,
      ) => unknown,
      Stroke: jest
        .fn()
        .mockImplementation((options: Record<string, unknown>) => options) as unknown as new (
        options: Record<string, unknown>,
      ) => unknown,
      Circle: jest
        .fn()
        .mockImplementation((options: Record<string, unknown>) => options) as unknown as new (
        options: Record<string, unknown>,
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

/**
 * Возвращает ответ, имитирующий /api/inview. Поле `t` опционально - для
 * проверки fallback /api/point handleInviewResponse при отсутствии команды.
 * `clone()` обязателен: refsOnMap читает body через response.clone().json().
 */
function makeInviewResponse(p: { g: string; t?: number }[]): Response {
  const body = { p };
  const factory = (): Response =>
    ({
      ok: true,
      status: 200,
      clone: factory,
      json: () => Promise.resolve(body),
    }) as unknown as Response;
  return factory();
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
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- requireActual returns any
  findLayerByName: jest.requireActual('../../core/olMap').findLayerByName,
}));

jest.mock('../../core/refsHighlightSync', () => ({
  syncRefsCountForPoints: jest.fn(() => Promise.resolve()),
}));

// jsdom отбрасывает CSS-значения с var(--...) при присваивании style.color,
// а getPlayerTeam парсит именно var(--team-N). В реальном браузере это
// работает - SBG выставляет цвет через jQuery .css(). Чтобы тестам не
// приходилось обходить jsdom, мокаем модуль и управляем возвращаемым
// значением через .mockReturnValue в beforeEach/тестах.
jest.mock('../../core/playerTeam', () => ({
  getPlayerTeam: jest.fn(),
}));

import { getOlMap } from '../../core/olMap';
import { getPlayerTeam } from '../../core/playerTeam';

const mockGetPlayerTeam = getPlayerTeam as jest.MockedFunction<typeof getPlayerTeam>;

const mockGetOlMap = getOlMap as jest.MockedFunction<typeof getOlMap>;

/**
 * Прокручивает микротаски, чтобы /inview-handler и worker /api/point успели
 * пройти через своё then-цепочки до assertion'ов.
 */
async function flushAsync(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}

describe('refsOnMap enable/disable', () => {
  let view: ReturnType<typeof makeView>;
  let map: ReturnType<typeof makeMap>;
  let originalFetch: typeof window.fetch;

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
    originalFetch = window.fetch;
  });

  afterEach(async () => {
    await refsOnMap.disable();
    uninstallInviewFetchHookForTest();
    window.fetch = originalFetch;
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
    const ol = window.ol;
    if (!ol?.layer) throw new Error('ol.layer not mocked');
    (ol.layer.Vector as jest.Mock).mockImplementationOnce(() => {
      throw new Error('OlVectorLayer constructor failed');
    });

    await expect(refsOnMap.enable()).rejects.toThrow('OlVectorLayer constructor failed');

    expect(document.getElementById('svp-refsOnMap')).toBeNull();
    expect(document.querySelector('.svp-refs-on-map-close')).toBeNull();
    expect(document.querySelector('.svp-refs-on-map-trash')).toBeNull();
    expect(document.querySelector('.svp-refs-on-map-button')).toBeNull();
  });

  test('частичный провал после создания showButton: все элементы убраны', async () => {
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

    expect(document.querySelector('.svp-refs-on-map-button')).toBeNull();
    expect(document.querySelector('.svp-refs-on-map-close')).toBeNull();
    expect(document.querySelector('.svp-refs-on-map-trash')).toBeNull();
    expect(document.getElementById('svp-refsOnMap')).toBeNull();
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
  let originalFetch: typeof window.fetch;

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
    originalFetch = window.fetch;
    await refsOnMap.enable();
  });

  afterEach(async () => {
    await refsOnMap.disable();
    uninstallInviewFetchHookForTest();
    window.fetch = originalFetch;
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

  test('shows locked-note while viewer is open and hides it on close', () => {
    setInventoryCache();
    clickShowButton();
    const note = document.querySelector('.svp-refs-on-map-locked-note') as HTMLElement;
    expect(note).not.toBeNull();
    expect(note.style.display).toBe('');
    expect(note.textContent).toMatch(/locked|защищ/i);
    clickCloseButton();
    expect(note.style.display).toBe('none');
  });
});

// ── lock protection at delete ────────────────────────────────────────────────

describe('refsOnMap lock protection', () => {
  let view: ReturnType<typeof makeView>;
  let map: ReturnType<typeof makeMap>;
  let originalConfirm: typeof window.confirm;
  let originalFetch: typeof window.fetch;

  function clickShowButton(): void {
    const button = document.querySelector('.svp-refs-on-map-button') as HTMLElement;
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
    originalConfirm = window.confirm;
    originalFetch = window.fetch;
    // По умолчанию fetch отвечает пустым для /api/point - тесты этого блока
    // не зависят от /inview-перехвата, они вручную проставляют team на
    // features через свойства feature и проверяют partition.
    window.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
      } as unknown as Response),
    ) as unknown as typeof window.fetch;
    localStorage.setItem('auth', 'test-token');
    await refsOnMap.enable();
  });

  afterEach(async () => {
    await refsOnMap.disable();
    uninstallInviewFetchHookForTest();
    delete window.ol;
    localStorage.removeItem('inventory-cache');
    localStorage.removeItem('follow');
    localStorage.removeItem('auth');
    document.body.innerHTML = '';
    window.confirm = originalConfirm;
    window.fetch = originalFetch;
  });

  function setInventoryCacheWithLocks(): void {
    // ref-2 в стопке locked (бит 0b10 поля f) - точка point-2 защищена.
    const items = [
      { t: 3, a: 4, c: [100.5, 13.7], g: 'ref-1', l: 'point-1', ti: 'Open Point', f: 0 },
      { t: 3, a: 2, c: [101.0, 14.0], g: 'ref-2', l: 'point-2', ti: 'Locked Point', f: 0b10 },
    ];
    localStorage.setItem('inventory-cache', JSON.stringify(items));
  }

  test('clicking trash with all-locked selection toasts and skips delete', async () => {
    setInventoryCacheWithLocks();
    clickShowButton();
    await flushAsync();
    const fetchSpy = jest.fn(() =>
      Promise.resolve({ json: () => Promise.resolve({}) } as unknown as Response),
    );
    window.fetch = fetchSpy as unknown as typeof window.fetch;

    const trash = document.querySelector('.svp-refs-on-map-trash') as HTMLElement;
    trash.click();
    await Promise.resolve();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('partitionByLockProtection через handleDeleteClick: locked не уходит в payload', async () => {
    setInventoryCacheWithLocks();
    clickShowButton();
    await flushAsync();

    const clickHandler = map._clickListeners[0];
    expect(clickHandler).toBeDefined();

    const allFeatures = (window.ol?.Feature as unknown as jest.Mock).mock.results.map(
      (r) => r.value as IOlFeature,
    );
    expect(allFeatures.length).toBe(2);

    (map.forEachFeatureAtPixel as jest.Mock).mockImplementation(
      (_pixel: unknown, callback: (feature: IOlFeature) => void) => {
        callback(allFeatures[0]);
      },
    );
    clickHandler({ pixel: [0, 0] });
    (map.forEachFeatureAtPixel as jest.Mock).mockImplementation(
      (_pixel: unknown, callback: (feature: IOlFeature) => void) => {
        callback(allFeatures[1]);
      },
    );
    clickHandler({ pixel: [0, 0] });

    window.confirm = jest.fn(() => true);
    const fetchSpy = jest.fn((..._args: [RequestInfo | URL, RequestInit?]) => {
      void _args;
      return Promise.resolve({
        json: () => Promise.resolve({ count: { total: 90 } }),
      } as unknown as Response);
    });
    window.fetch = fetchSpy as unknown as typeof window.fetch;

    const trash = document.querySelector('.svp-refs-on-map-trash') as HTMLElement;
    trash.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    expect(init.headers).toMatchObject({
      authorization: 'Bearer test-token',
      'content-type': 'application/json',
    });
    const body = JSON.parse(init.body as string) as { selection: Record<string, number> };
    expect(body.selection).toHaveProperty('ref-1');
    expect(body.selection).not.toHaveProperty('ref-2');
  });

  test('без auth-токена delete не отправляет fetch', async () => {
    localStorage.removeItem('auth');
    setInventoryCacheWithLocks();
    clickShowButton();
    await flushAsync();
    const clickHandler = map._clickListeners[0];
    const allFeatures = (window.ol?.Feature as unknown as jest.Mock).mock.results.map(
      (r) => r.value as IOlFeature,
    );
    (map.forEachFeatureAtPixel as jest.Mock).mockImplementation(
      (_pixel: unknown, callback: (feature: IOlFeature) => void) => {
        callback(allFeatures[0]);
      },
    );
    clickHandler({ pixel: [0, 0] });

    window.confirm = jest.fn(() => true);
    const fetchSpy = jest.fn();
    window.fetch = fetchSpy as unknown as typeof window.fetch;
    const errorSpy = jest.spyOn(console, 'error').mockImplementation();

    const trash = document.querySelector('.svp-refs-on-map-trash') as HTMLElement;
    trash.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('refsOnMap'),
      expect.stringContaining('Auth token'),
    );
    errorSpy.mockRestore();
  });

  test('all-locked selection: confirm не вызывается, fetch не идёт, показан toast', async () => {
    setInventoryCacheWithLocks();
    clickShowButton();
    await flushAsync();
    const clickHandler = map._clickListeners[0];
    const allFeatures = (window.ol?.Feature as unknown as jest.Mock).mock.results.map(
      (r) => r.value as IOlFeature,
    );
    (map.forEachFeatureAtPixel as jest.Mock).mockImplementation(
      (_pixel: unknown, callback: (feature: IOlFeature) => void) => {
        callback(allFeatures[1]);
      },
    );
    clickHandler({ pixel: [0, 0] });

    const confirmSpy = jest.fn(() => true);
    window.confirm = confirmSpy;
    const fetchSpy = jest.fn();
    window.fetch = fetchSpy as unknown as typeof window.fetch;

    const trash = document.querySelector('.svp-refs-on-map-trash') as HTMLElement;
    trash.click();
    await Promise.resolve();

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(document.querySelector('.svp-toast')).not.toBeNull();
  });

  test('mix-кэш блокирует удаление: одна стопка без поля f - confirm и fetch не вызываются, показан toast', async () => {
    const items = [
      { t: 3, a: 4, c: [100.5, 13.7], g: 'ref-1', l: 'point-1', ti: 'Mixed Open' },
      { t: 3, a: 2, c: [101.0, 14.0], g: 'ref-2', l: 'point-2', ti: 'Mixed Locked', f: 0b10 },
    ];
    localStorage.setItem('inventory-cache', JSON.stringify(items));
    clickShowButton();
    await flushAsync();

    const clickHandler = map._clickListeners[0];
    const allFeatures = (window.ol?.Feature as unknown as jest.Mock).mock.results.map(
      (r) => r.value as IOlFeature,
    );
    (map.forEachFeatureAtPixel as jest.Mock).mockImplementation(
      (_pixel: unknown, callback: (feature: IOlFeature) => void) => {
        callback(allFeatures[0]);
      },
    );
    clickHandler({ pixel: [0, 0] });

    const confirmSpy = jest.fn(() => true);
    window.confirm = confirmSpy;
    const fetchSpy = jest.fn();
    window.fetch = fetchSpy as unknown as typeof window.fetch;

    const trash = document.querySelector('.svp-refs-on-map-trash') as HTMLElement;
    trash.click();
    await Promise.resolve();

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(document.querySelector('.svp-toast')?.textContent).toMatch(/lock|нативный|f-flag/i);
  });

  test('0.6.0 кэш без поля f целиком: удаление заблокировано', async () => {
    const items = [
      { t: 3, a: 4, c: [100.5, 13.7], g: 'ref-1', l: 'point-1', ti: 'Old A' },
      { t: 3, a: 2, c: [101.0, 14.0], g: 'ref-2', l: 'point-2', ti: 'Old B' },
    ];
    localStorage.setItem('inventory-cache', JSON.stringify(items));
    clickShowButton();
    await flushAsync();

    const clickHandler = map._clickListeners[0];
    const allFeatures = (window.ol?.Feature as unknown as jest.Mock).mock.results.map(
      (r) => r.value as IOlFeature,
    );
    (map.forEachFeatureAtPixel as jest.Mock).mockImplementation(
      (_pixel: unknown, callback: (feature: IOlFeature) => void) => {
        callback(allFeatures[0]);
      },
    );
    clickHandler({ pixel: [0, 0] });

    const confirmSpy = jest.fn(() => true);
    window.confirm = confirmSpy;
    const fetchSpy = jest.fn();
    window.fetch = fetchSpy as unknown as typeof window.fetch;

    const trash = document.querySelector('.svp-refs-on-map-trash') as HTMLElement;
    trash.click();
    await Promise.resolve();

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(document.querySelector('.svp-toast')?.textContent).toMatch(/lock|нативный|f-flag/i);
  });
});

// ── own-team protection ──────────────────────────────────────────────────────

describe('refsOnMap own-team protection', () => {
  let view: ReturnType<typeof makeView>;
  let map: ReturnType<typeof makeMap>;
  let originalConfirm: typeof window.confirm;
  let originalFetch: typeof window.fetch;

  function clickShowButton(): void {
    const button = document.querySelector('.svp-refs-on-map-button') as HTMLElement;
    button.click();
  }

  function setPlayerTeam(team: number | null): void {
    mockGetPlayerTeam.mockReturnValue(team);
  }

  function applyTeamsToFeatures(teamsByPoint: Record<string, number | null>): void {
    const allFeatures = (window.ol?.Feature as unknown as jest.Mock).mock.results.map(
      (r) => r.value as IOlFeature,
    );
    for (const feature of allFeatures) {
      const pointGuid = feature.getProperties?.().pointGuid;
      if (typeof pointGuid !== 'string') continue;
      const team = teamsByPoint[pointGuid];
      if (typeof team === 'number') {
        feature.set?.('team', team);
      }
    }
  }

  /**
   * Эмулирует пользовательский flow включения чекбокса: выбор фичи
   * (uniqueRefsToDelete>0 ⇒ чекбокс становится visible), затем клик-toggle.
   * Прямая запись keepOwnTeam через localStorage больше не работает -
   * флаг эфемерный.
   */
  function enableKeepOwnTeamCheckbox(): void {
    const checkbox = document.querySelector(
      '.svp-refs-on-map-keep-own input[type="checkbox"]',
    ) as HTMLInputElement;
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));
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
    originalConfirm = window.confirm;
    originalFetch = window.fetch;
    // Дефолтный fetch не моделирует /api/inview - тесты ставят team вручную
    // через applyTeamsToFeatures. Хук /inview не активируется без специально
    // отправленного запроса на /api/inview, что соответствует тестируемому
    // блоку: проверка partition по team, не источник team.
    window.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
      } as unknown as Response),
    ) as unknown as typeof window.fetch;
    localStorage.setItem('auth', 'test-token');
    setPlayerTeam(1);
    await refsOnMap.enable();
  });

  afterEach(async () => {
    await refsOnMap.disable();
    uninstallInviewFetchHookForTest();
    delete window.ol;
    localStorage.removeItem('inventory-cache');
    localStorage.removeItem('follow');
    localStorage.removeItem('auth');
    document.body.innerHTML = '';
    window.confirm = originalConfirm;
    window.fetch = originalFetch;
  });

  function setMixedInventoryCache(): void {
    const items = [
      { t: 3, a: 4, c: [100.5, 13.7], g: 'ref-1', l: 'point-own', ti: 'Mine', f: 0 },
      { t: 3, a: 2, c: [101.0, 14.0], g: 'ref-2', l: 'point-enemy', ti: 'Enemy', f: 0 },
    ];
    localStorage.setItem('inventory-cache', JSON.stringify(items));
  }

  test('keepOwnTeam=true, playerTeam=1: своя точка в protected, чужая в payload', async () => {
    setMixedInventoryCache();
    clickShowButton();
    await flushAsync();
    applyTeamsToFeatures({ 'point-own': 1, 'point-enemy': 2 });

    const clickHandler = map._clickListeners[0];
    const allFeatures = (window.ol?.Feature as unknown as jest.Mock).mock.results.map(
      (r) => r.value as IOlFeature,
    );
    expect(allFeatures.length).toBe(2);
    (map.forEachFeatureAtPixel as jest.Mock).mockImplementation(
      (_pixel: unknown, callback: (feature: IOlFeature) => void) => {
        callback(allFeatures[0]);
      },
    );
    clickHandler({ pixel: [0, 0] });
    (map.forEachFeatureAtPixel as jest.Mock).mockImplementation(
      (_pixel: unknown, callback: (feature: IOlFeature) => void) => {
        callback(allFeatures[1]);
      },
    );
    clickHandler({ pixel: [0, 0] });

    enableKeepOwnTeamCheckbox();

    window.confirm = jest.fn(() => true);
    const fetchSpy = jest.fn((..._args: [RequestInfo | URL, RequestInit?]) => {
      void _args;
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ count: { total: 90 } }),
      } as unknown as Response);
    });
    window.fetch = fetchSpy as unknown as typeof window.fetch;

    const trash = document.querySelector('.svp-refs-on-map-trash') as HTMLElement;
    trash.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(init.body as string) as { selection: Record<string, number> };
    expect(body.selection).not.toHaveProperty('ref-1');
    expect(body.selection).toHaveProperty('ref-2');
  });

  test('keepOwnTeam=false (по дефолту): фильтр не работает, обе точки в payload', async () => {
    setMixedInventoryCache();
    clickShowButton();
    await flushAsync();
    applyTeamsToFeatures({ 'point-own': 1, 'point-enemy': 2 });

    const clickHandler = map._clickListeners[0];
    const allFeatures = (window.ol?.Feature as unknown as jest.Mock).mock.results.map(
      (r) => r.value as IOlFeature,
    );
    (map.forEachFeatureAtPixel as jest.Mock).mockImplementation(
      (_pixel: unknown, callback: (feature: IOlFeature) => void) => {
        callback(allFeatures[0]);
      },
    );
    clickHandler({ pixel: [0, 0] });
    (map.forEachFeatureAtPixel as jest.Mock).mockImplementation(
      (_pixel: unknown, callback: (feature: IOlFeature) => void) => {
        callback(allFeatures[1]);
      },
    );
    clickHandler({ pixel: [0, 0] });

    window.confirm = jest.fn(() => true);
    const fetchSpy = jest.fn((..._args: [RequestInfo | URL, RequestInit?]) => {
      void _args;
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ count: { total: 90 } }),
      } as unknown as Response);
    });
    window.fetch = fetchSpy as unknown as typeof window.fetch;

    const trash = document.querySelector('.svp-refs-on-map-trash') as HTMLElement;
    trash.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(init.body as string) as { selection: Record<string, number> };
    expect(body.selection).toHaveProperty('ref-1');
    expect(body.selection).toHaveProperty('ref-2');
  });

  test('keepOwnTeam=true + playerTeam=null: удаление заблокировано, fetch не идёт', async () => {
    setMixedInventoryCache();
    clickShowButton();
    await flushAsync();
    applyTeamsToFeatures({ 'point-own': 1, 'point-enemy': 2 });

    const clickHandler = map._clickListeners[0];
    const allFeatures = (window.ol?.Feature as unknown as jest.Mock).mock.results.map(
      (r) => r.value as IOlFeature,
    );
    (map.forEachFeatureAtPixel as jest.Mock).mockImplementation(
      (_pixel: unknown, callback: (feature: IOlFeature) => void) => {
        callback(allFeatures[0]);
      },
    );
    clickHandler({ pixel: [0, 0] });

    enableKeepOwnTeamCheckbox();
    setPlayerTeam(null);

    const confirmSpy = jest.fn(() => true);
    window.confirm = confirmSpy;
    const fetchSpy = jest.fn();
    window.fetch = fetchSpy as unknown as typeof window.fetch;

    const trash = document.querySelector('.svp-refs-on-map-trash') as HTMLElement;
    trash.click();
    await Promise.resolve();

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(document.querySelector('.svp-toast')?.textContent).toMatch(/команд|team|player/i);
  });

  test('keepOwnTeam=true: точка с team=undefined fail-safe защищена', async () => {
    const items = [
      { t: 3, a: 4, c: [100.5, 13.7], g: 'ref-1', l: 'point-unknown', ti: 'Unk', f: 0 },
      { t: 3, a: 2, c: [101.0, 14.0], g: 'ref-2', l: 'point-enemy', ti: 'Enemy', f: 0 },
    ];
    localStorage.setItem('inventory-cache', JSON.stringify(items));
    clickShowButton();
    await flushAsync();
    // point-unknown без team (имитация: API не вернул); point-enemy = команда 2.
    applyTeamsToFeatures({ 'point-enemy': 2 });

    const clickHandler = map._clickListeners[0];
    const allFeatures = (window.ol?.Feature as unknown as jest.Mock).mock.results.map(
      (r) => r.value as IOlFeature,
    );
    (map.forEachFeatureAtPixel as jest.Mock).mockImplementation(
      (_pixel: unknown, callback: (feature: IOlFeature) => void) => {
        callback(allFeatures[0]);
      },
    );
    clickHandler({ pixel: [0, 0] });
    (map.forEachFeatureAtPixel as jest.Mock).mockImplementation(
      (_pixel: unknown, callback: (feature: IOlFeature) => void) => {
        callback(allFeatures[1]);
      },
    );
    clickHandler({ pixel: [0, 0] });

    enableKeepOwnTeamCheckbox();

    window.confirm = jest.fn(() => true);
    const fetchSpy = jest.fn((..._args: [RequestInfo | URL, RequestInit?]) => {
      void _args;
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ count: { total: 90 } }),
      } as unknown as Response);
    });
    window.fetch = fetchSpy as unknown as typeof window.fetch;

    const trash = document.querySelector('.svp-refs-on-map-trash') as HTMLElement;
    trash.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(init.body as string) as { selection: Record<string, number> };
    expect(body.selection).not.toHaveProperty('ref-1');
    expect(body.selection).toHaveProperty('ref-2');
  });

  test('keepOwnTeam=true, deletable=0: только свои - тост "your team"', async () => {
    setMixedInventoryCache();
    clickShowButton();
    await flushAsync();
    applyTeamsToFeatures({ 'point-own': 1, 'point-enemy': 1 });

    const clickHandler = map._clickListeners[0];
    const allFeatures = (window.ol?.Feature as unknown as jest.Mock).mock.results.map(
      (r) => r.value as IOlFeature,
    );
    (map.forEachFeatureAtPixel as jest.Mock).mockImplementation(
      (_pixel: unknown, callback: (feature: IOlFeature) => void) => {
        callback(allFeatures[0]);
      },
    );
    clickHandler({ pixel: [0, 0] });
    (map.forEachFeatureAtPixel as jest.Mock).mockImplementation(
      (_pixel: unknown, callback: (feature: IOlFeature) => void) => {
        callback(allFeatures[1]);
      },
    );
    clickHandler({ pixel: [0, 0] });

    enableKeepOwnTeamCheckbox();

    const confirmSpy = jest.fn(() => true);
    window.confirm = confirmSpy;
    const fetchSpy = jest.fn();
    window.fetch = fetchSpy as unknown as typeof window.fetch;

    const trash = document.querySelector('.svp-refs-on-map-trash') as HTMLElement;
    trash.click();
    await Promise.resolve();

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    const toast = document.querySelector('.svp-toast')?.textContent ?? '';
    expect(toast).toMatch(/свои|your team/i);
    expect(toast).not.toMatch(/locked|замочк/i);
    expect(toast).not.toMatch(/unknown|не загружен/i);
  });

  test('keepOwnTeam=true, deletable=0: только unknown - тост "unknown team color"', async () => {
    setMixedInventoryCache();
    clickShowButton();
    await flushAsync();
    // Обе точки без team - все попадают в protectedByUnknownTeam.

    const clickHandler = map._clickListeners[0];
    const allFeatures = (window.ol?.Feature as unknown as jest.Mock).mock.results.map(
      (r) => r.value as IOlFeature,
    );
    (map.forEachFeatureAtPixel as jest.Mock).mockImplementation(
      (_pixel: unknown, callback: (feature: IOlFeature) => void) => {
        callback(allFeatures[0]);
      },
    );
    clickHandler({ pixel: [0, 0] });
    (map.forEachFeatureAtPixel as jest.Mock).mockImplementation(
      (_pixel: unknown, callback: (feature: IOlFeature) => void) => {
        callback(allFeatures[1]);
      },
    );
    clickHandler({ pixel: [0, 0] });

    enableKeepOwnTeamCheckbox();

    const confirmSpy = jest.fn(() => true);
    window.confirm = confirmSpy;
    const fetchSpy = jest.fn();
    window.fetch = fetchSpy as unknown as typeof window.fetch;

    const trash = document.querySelector('.svp-refs-on-map-trash') as HTMLElement;
    trash.click();
    await Promise.resolve();

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    const toast = document.querySelector('.svp-toast')?.textContent ?? '';
    expect(toast).toMatch(/unknown|не загружен/i);
    expect(toast).not.toMatch(/your team|свои - оставлены/i);
  });

  test('keepOwnTeam=true, 1 своя + 1 чужая (сценарий пользователя): чужая удаляется, тост "Свои"', async () => {
    setMixedInventoryCache();
    clickShowButton();
    await flushAsync();
    applyTeamsToFeatures({ 'point-own': 1, 'point-enemy': 2 });

    const clickHandler = map._clickListeners[0];
    const allFeatures = (window.ol?.Feature as unknown as jest.Mock).mock.results.map(
      (r) => r.value as IOlFeature,
    );
    (map.forEachFeatureAtPixel as jest.Mock).mockImplementation(
      (_pixel: unknown, callback: (feature: IOlFeature) => void) => {
        callback(allFeatures[0]);
      },
    );
    clickHandler({ pixel: [0, 0] });
    (map.forEachFeatureAtPixel as jest.Mock).mockImplementation(
      (_pixel: unknown, callback: (feature: IOlFeature) => void) => {
        callback(allFeatures[1]);
      },
    );
    clickHandler({ pixel: [0, 0] });

    enableKeepOwnTeamCheckbox();

    window.confirm = jest.fn(() => true);
    const fetchSpy = jest.fn((..._args: [RequestInfo | URL, RequestInit?]) => {
      void _args;
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ count: { total: 90 } }),
      } as unknown as Response);
    });
    window.fetch = fetchSpy as unknown as typeof window.fetch;

    const trash = document.querySelector('.svp-refs-on-map-trash') as HTMLElement;
    trash.click();
    await flushAsync();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const toast = document.querySelector('.svp-toast')?.textContent ?? '';
    expect(toast).toMatch(/свои|own team/i);
    expect(toast).not.toMatch(/unknown|не загружен/i);
  });
});

// ── /inview-driven team load ─────────────────────────────────────────────────

describe('refsOnMap /inview team load', () => {
  let view: ReturnType<typeof makeView>;
  let map: ReturnType<typeof makeMap>;
  let originalFetch: typeof window.fetch;
  // fetchSpy создаётся ДО enable() и присваивается на window.fetch, чтобы
  // installInviewFetchHook захватил его как `originalFetch` внутри хука.
  // Перезапись window.fetch=fetchSpy ПОСЛЕ enable() сломала бы цепочку.
  let fetchSpy: jest.Mock;

  function clickShowButton(): void {
    const button = document.querySelector('.svp-refs-on-map-button') as HTMLElement;
    button.click();
  }

  function setInventory(): void {
    const items = [
      { t: 3, a: 4, c: [100.5, 13.7], g: 'ref-1', l: 'point-1', ti: 'A', f: 0 },
      { t: 3, a: 2, c: [101.0, 14.0], g: 'ref-2', l: 'point-2', ti: 'B', f: 0 },
    ];
    localStorage.setItem('inventory-cache', JSON.stringify(items));
  }

  /**
   * Заглушает active pull (visible-only через /api/point) - extent
   * выставлен далеко от моковых координат features [0, 0], так что
   * getVisiblePointGuids возвращает пусто и worker не стартует. Тесты
   * этого блока проверяют именно /inview hook без шума /api/point.
   */
  function setExtentOutsideFeatures(): void {
    view.calculateExtent = (): number[] => [100, 100, 200, 200];
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
    originalFetch = window.fetch;
    fetchSpy = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
      } as unknown as Response),
    );
    window.fetch = fetchSpy as unknown as typeof window.fetch;
    localStorage.setItem('auth', 'test-token');
    await refsOnMap.enable();
  });

  afterEach(async () => {
    await refsOnMap.disable();
    uninstallInviewFetchHookForTest();
    delete window.ol;
    localStorage.removeItem('inventory-cache');
    localStorage.removeItem('follow');
    localStorage.removeItem('auth');
    document.body.innerHTML = '';
    window.fetch = originalFetch;
  });

  test('/inview-ответ с p[].t пишет team в feature, /api/point не вызывается', async () => {
    fetchSpy.mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.includes('/api/inview')) {
        return Promise.resolve(
          makeInviewResponse([
            { g: 'point-1', t: 2 },
            { g: 'point-2', t: 3 },
          ]),
        );
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
      } as unknown as Response);
    });

    setInventory();
    setExtentOutsideFeatures();
    clickShowButton();

    await window.fetch('/api/inview?sw=1&ne=2&z=14');
    await flushAsync();

    const allFeatures = (window.ol?.Feature as unknown as jest.Mock).mock.results.map(
      (r) => r.value as IOlFeature,
    );
    expect(allFeatures[0].getProperties?.().team).toBe(2);
    expect(allFeatures[1].getProperties?.().team).toBe(3);
    const pointCalls = (fetchSpy.mock.calls as [RequestInfo | URL][]).filter(([arg]) => {
      const url = typeof arg === 'string' ? arg : arg instanceof URL ? arg.href : arg.url;
      return url.includes('/api/point');
    });
    expect(pointCalls.length).toBe(0);
  });

  test('/inview без поля t для guid: handleInviewResponse не делает fallback /api/point (active pull покрывает)', async () => {
    // Active pull загружает все видимые ref-точки через /api/point на
    // showViewer/moveend; handleInviewResponse fallback для guid без t -
    // дубль, который порождал race за teamLoadQueue (см. commit comment).
    // Тест фиксирует: /inview без t НЕ триггерит /api/point из
    // handleInviewResponse - запрос идёт ТОЛЬКО если active pull его
    // запланировал. Здесь extent выставлен далеко от features, active
    // pull спит -> /api/point не должен быть вызван вообще.
    const pointFetchSpy = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ data: { te: 5 } }),
      } as unknown as Response),
    );
    fetchSpy.mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.includes('/api/inview')) {
        return Promise.resolve(makeInviewResponse([{ g: 'point-1' }]));
      }
      if (url.includes('/api/point')) {
        return pointFetchSpy();
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
      } as unknown as Response);
    });

    setInventory();
    setExtentOutsideFeatures();
    clickShowButton();

    await window.fetch('/api/inview?sw=1&ne=2&z=14');
    await flushAsync();

    expect(pointFetchSpy).not.toHaveBeenCalled();
  });

  test('повторный /inview с теми же guid: новых guid нет, повторных запросов /api/point нет', async () => {
    const pointFetchSpy = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ data: { te: 1 } }),
      } as unknown as Response),
    );
    fetchSpy.mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.includes('/api/inview')) {
        return Promise.resolve(
          makeInviewResponse([
            { g: 'point-1', t: 1 },
            { g: 'point-2', t: 1 },
          ]),
        );
      }
      if (url.includes('/api/point')) {
        return pointFetchSpy();
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
      } as unknown as Response);
    });

    setInventory();
    setExtentOutsideFeatures();
    clickShowButton();

    await window.fetch('/api/inview?sw=1&ne=2&z=14');
    await flushAsync();
    await window.fetch('/api/inview?sw=1&ne=2&z=14');
    await flushAsync();

    expect(pointFetchSpy).not.toHaveBeenCalled();
  });
});

// ── visible-only active pull (/api/point worker по extent) ─────────────────

describe('refsOnMap visible-only active pull', () => {
  let view: ReturnType<typeof makeView>;
  let map: ReturnType<typeof makeMap>;
  let originalFetch: typeof window.fetch;
  let teamFetchSpy: jest.Mock;

  function clickShowButton(): void {
    const button = document.querySelector('.svp-refs-on-map-button') as HTMLElement;
    button.click();
  }

  function setExtent(extent: number[]): void {
    view.calculateExtent = (): number[] => extent;
  }

  function emitMoveend(): void {
    // OL fires `moveend` на Map (refs/game/script.js: map.on('moveend')),
    // не на View. refsOnMap подписывается через olMap.on('moveend'), так
    // что симулировать надо через map listeners, не view.
    for (const listener of map._moveendListeners) listener();
  }

  function setInventory(): void {
    const items = [
      { t: 3, a: 4, c: [100.5, 13.7], g: 'ref-1', l: 'point-1', ti: 'A', f: 0 },
      { t: 3, a: 2, c: [101.0, 14.0], g: 'ref-2', l: 'point-2', ti: 'B', f: 0 },
    ];
    localStorage.setItem('inventory-cache', JSON.stringify(items));
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
    originalFetch = window.fetch;
    teamFetchSpy = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ data: { te: 1 } }),
      } as unknown as Response),
    );
    window.fetch = teamFetchSpy as unknown as typeof window.fetch;
    localStorage.setItem('auth', 'test-token');
    await refsOnMap.enable();
  });

  afterEach(async () => {
    await refsOnMap.disable();
    uninstallInviewFetchHookForTest();
    delete window.ol;
    localStorage.removeItem('inventory-cache');
    localStorage.removeItem('follow');
    localStorage.removeItem('auth');
    document.body.innerHTML = '';
    window.fetch = originalFetch;
  });

  test('extent не покрывает точки: /api/point не идёт, прогресс-бар не показан, teamsLoading=false', async () => {
    setInventory();
    setExtent([100, 100, 200, 200]); // далеко от моковых coord [0, 0]
    clickShowButton();
    await flushAsync();

    expect(teamFetchSpy).not.toHaveBeenCalled();
    const progress = document.querySelector('.svp-refs-on-map-progress') as HTMLElement;
    expect(progress.style.display).toBe('none');
    const trash = document.querySelector('.svp-refs-on-map-trash') as HTMLButtonElement;
    expect(trash.disabled).toBe(false);
  });

  test('extent покрывает все точки: /api/point вызван по разу для каждого pointGuid', async () => {
    setInventory();
    setExtent([-1000, -1000, 1000, 1000]);
    clickShowButton();
    await flushAsync();

    expect(teamFetchSpy).toHaveBeenCalledTimes(2);
  });

  test('moveend на покрывающий extent догружает ранее невидимые точки', async () => {
    setInventory();
    setExtent([100, 100, 200, 200]);
    clickShowButton();
    await flushAsync();
    expect(teamFetchSpy).toHaveBeenCalledTimes(0);

    setExtent([-1000, -1000, 1000, 1000]);
    emitMoveend();
    await flushAsync();

    expect(teamFetchSpy).toHaveBeenCalledTimes(2);
  });

  test('moveend на тот же extent не вызывает повторного fetch (точки уже в кэше)', async () => {
    setInventory();
    setExtent([-1000, -1000, 1000, 1000]);
    clickShowButton();
    await flushAsync();
    expect(teamFetchSpy).toHaveBeenCalledTimes(2);

    emitMoveend();
    await flushAsync();
    expect(teamFetchSpy).toHaveBeenCalledTimes(2);
  });

  test('hideViewer снимает moveend handler: после закрытия pan не триггерит fetch', async () => {
    setInventory();
    setExtent([100, 100, 200, 200]);
    clickShowButton();
    await flushAsync();
    expect(teamFetchSpy).not.toHaveBeenCalled();

    const closeButton = document.querySelector('.svp-refs-on-map-close') as HTMLElement;
    closeButton.click();

    setExtent([-1000, -1000, 1000, 1000]);
    emitMoveend();
    await flushAsync();

    expect(teamFetchSpy).not.toHaveBeenCalled();
  });

  test('auto-disable keepOwnTeam на moveend с новым видимым guid', async () => {
    setInventory();
    // Начинаем с extent, покрывающего только point-1 (по факту coord
    // обоих [0,0] в моках, но добавление в visible Set гарантирует
    // unique - active pull увидит обе одновременно). Чтобы изолировать
    // именно moveend-триггер, стартуем с пустого extent и включаем
    // фильтр через явный select+toggle.
    setExtent([100, 100, 200, 200]);
    clickShowButton();
    await flushAsync();

    // На первом /inview-моке ничего не приходит (fetch на /inview не
    // вызывался) - teamCache пуст. Выбор фичи + включение чекбокса.
    const clickHandler = map._clickListeners[0];
    const allFeatures = (window.ol?.Feature as unknown as jest.Mock).mock.results.map(
      (r) => r.value as IOlFeature,
    );
    (map.forEachFeatureAtPixel as jest.Mock).mockImplementation(
      (_pixel: unknown, callback: (feature: IOlFeature) => void) => {
        callback(allFeatures[0]);
      },
    );
    clickHandler({ pixel: [0, 0] });
    const checkbox = document.querySelector(
      '.svp-refs-on-map-keep-own input[type="checkbox"]',
    ) as HTMLInputElement;
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));
    expect(checkbox.checked).toBe(true);

    // Pan карты в новый extent, покрывающий [0, 0] - в visible
    // появляются point-1 и point-2 (новые guid'ы) -> auto-disable.
    setExtent([-1000, -1000, 1000, 1000]);
    emitMoveend();
    await flushAsync();

    expect(checkbox.checked).toBe(false);
    const toast = document.querySelector('.svp-toast');
    expect(toast).not.toBeNull();
    expect(toast?.textContent).toMatch(/keep own team|не удалять свои/i);
  });
});

// ── checkbox visibility ──────────────────────────────────────────────────────

describe('refsOnMap checkbox visibility', () => {
  let view: ReturnType<typeof makeView>;
  let map: ReturnType<typeof makeMap>;
  let originalFetch: typeof window.fetch;

  function clickShowButton(): void {
    const button = document.querySelector('.svp-refs-on-map-button') as HTMLElement;
    button.click();
  }

  function setInventory(): void {
    const items = [{ t: 3, a: 4, c: [100.5, 13.7], g: 'ref-1', l: 'point-1', ti: 'A', f: 0 }];
    localStorage.setItem('inventory-cache', JSON.stringify(items));
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
    originalFetch = window.fetch;
    window.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
      } as unknown as Response),
    ) as unknown as typeof window.fetch;
    localStorage.setItem('auth', 'test-token');
    await refsOnMap.enable();
  });

  afterEach(async () => {
    await refsOnMap.disable();
    uninstallInviewFetchHookForTest();
    delete window.ol;
    localStorage.removeItem('inventory-cache');
    localStorage.removeItem('follow');
    localStorage.removeItem('auth');
    document.body.innerHTML = '';
    window.fetch = originalFetch;
  });

  test('viewer открыт, 0 selected: чекбокс hidden', async () => {
    setInventory();
    clickShowButton();
    await flushAsync();

    const label = document.querySelector('.svp-refs-on-map-keep-own') as HTMLElement;
    expect(label).not.toBeNull();
    expect(label.style.display).toBe('none');
  });

  test('select feature: чекбокс становится visible; deselect: скрывается обратно', async () => {
    setInventory();
    clickShowButton();
    await flushAsync();

    const label = document.querySelector('.svp-refs-on-map-keep-own') as HTMLElement;
    const clickHandler = map._clickListeners[0];
    const allFeatures = (window.ol?.Feature as unknown as jest.Mock).mock.results.map(
      (r) => r.value as IOlFeature,
    );
    (map.forEachFeatureAtPixel as jest.Mock).mockImplementation(
      (_pixel: unknown, callback: (feature: IOlFeature) => void) => {
        callback(allFeatures[0]);
      },
    );

    // Select.
    clickHandler({ pixel: [0, 0] });
    expect(label.style.display).not.toBe('none');

    // Deselect (повторный клик на ту же фичу).
    clickHandler({ pixel: [0, 0] });
    expect(label.style.display).toBe('none');
  });
});

// ── auto-disable keepOwnTeam on new visibility ───────────────────────────────

describe('refsOnMap auto-disable keepOwnTeam', () => {
  let view: ReturnType<typeof makeView>;
  let map: ReturnType<typeof makeMap>;
  let originalFetch: typeof window.fetch;
  let fetchSpy: jest.Mock;

  function clickShowButton(): void {
    const button = document.querySelector('.svp-refs-on-map-button') as HTMLElement;
    button.click();
  }

  function setInventory(): void {
    const items = [{ t: 3, a: 4, c: [100.5, 13.7], g: 'ref-1', l: 'point-1', ti: 'A', f: 0 }];
    localStorage.setItem('inventory-cache', JSON.stringify(items));
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
    originalFetch = window.fetch;
    fetchSpy = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
      } as unknown as Response),
    );
    window.fetch = fetchSpy as unknown as typeof window.fetch;
    localStorage.setItem('auth', 'test-token');
    await refsOnMap.enable();
  });

  afterEach(async () => {
    await refsOnMap.disable();
    uninstallInviewFetchHookForTest();
    delete window.ol;
    localStorage.removeItem('inventory-cache');
    localStorage.removeItem('follow');
    localStorage.removeItem('auth');
    document.body.innerHTML = '';
    window.fetch = originalFetch;
  });

  test('новый guid в /inview при включённом keepOwnTeam: сброс + toast', async () => {
    let inviewPoints: { g: string; t: number }[] = [{ g: 'point-1', t: 1 }];
    fetchSpy.mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.includes('/api/inview')) {
        return Promise.resolve(makeInviewResponse(inviewPoints));
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
      } as unknown as Response);
    });

    setInventory();
    clickShowButton();
    await flushAsync();

    // Первый /inview: всё новое, но keepOwnTeam=false (свежий viewer-сеанс),
    // сброс не срабатывает, toast не появляется.
    await window.fetch('/api/inview?sw=1&ne=2&z=14');
    await flushAsync();
    expect(document.querySelectorAll('.svp-toast').length).toBe(0);

    // Включаем чекбокс. Для visibility - сначала выбор фичи.
    const clickHandler = map._clickListeners[0];
    const allFeatures = (window.ol?.Feature as unknown as jest.Mock).mock.results.map(
      (r) => r.value as IOlFeature,
    );
    (map.forEachFeatureAtPixel as jest.Mock).mockImplementation(
      (_pixel: unknown, callback: (feature: IOlFeature) => void) => {
        callback(allFeatures[0]);
      },
    );
    clickHandler({ pixel: [0, 0] });

    const checkbox = document.querySelector(
      '.svp-refs-on-map-keep-own input[type="checkbox"]',
    ) as HTMLInputElement;
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));
    expect(checkbox.checked).toBe(true);

    // Игра дёрнула /inview снова с НОВЫМ guid'ом (point-new ещё не было в
    // teamCache) - срабатывает auto-disable.
    inviewPoints = [
      { g: 'point-1', t: 1 },
      { g: 'point-new', t: 2 },
    ];
    await window.fetch('/api/inview?sw=2&ne=3&z=14');
    await flushAsync();

    expect(checkbox.checked).toBe(false);
    const toast = document.querySelector('.svp-toast');
    expect(toast).not.toBeNull();
    expect(toast?.textContent).toMatch(/keep own team|не удалять свои/i);
  });

  test('повторный /inview с теми же guid: keepOwnTeam НЕ сбрасывается, toast не появляется', async () => {
    fetchSpy.mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.includes('/api/inview')) {
        return Promise.resolve(makeInviewResponse([{ g: 'point-1', t: 1 }]));
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
      } as unknown as Response);
    });

    setInventory();
    clickShowButton();
    await flushAsync();
    await window.fetch('/api/inview?sw=1&ne=2&z=14');
    await flushAsync();

    const clickHandler = map._clickListeners[0];
    const allFeatures = (window.ol?.Feature as unknown as jest.Mock).mock.results.map(
      (r) => r.value as IOlFeature,
    );
    (map.forEachFeatureAtPixel as jest.Mock).mockImplementation(
      (_pixel: unknown, callback: (feature: IOlFeature) => void) => {
        callback(allFeatures[0]);
      },
    );
    clickHandler({ pixel: [0, 0] });
    const checkbox = document.querySelector(
      '.svp-refs-on-map-keep-own input[type="checkbox"]',
    ) as HTMLInputElement;
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));

    await window.fetch('/api/inview?sw=1&ne=2&z=14');
    await flushAsync();

    expect(checkbox.checked).toBe(true);
    expect(document.querySelector('.svp-toast')).toBeNull();
  });

  test('новый guid в /inview при выключенном keepOwnTeam: тоста нет, состояние не меняется', async () => {
    let inviewPoints: { g: string; t: number }[] = [{ g: 'point-1', t: 1 }];
    fetchSpy.mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.includes('/api/inview')) {
        return Promise.resolve(makeInviewResponse(inviewPoints));
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
      } as unknown as Response);
    });

    setInventory();
    clickShowButton();
    await flushAsync();
    await window.fetch('/api/inview?sw=1&ne=2&z=14');
    await flushAsync();

    inviewPoints = [
      { g: 'point-1', t: 1 },
      { g: 'point-new', t: 2 },
    ];
    await window.fetch('/api/inview?sw=2&ne=3&z=14');
    await flushAsync();

    expect(document.querySelector('.svp-toast')).toBeNull();
  });
});

// ── ephemeral keepOwnTeam ────────────────────────────────────────────────────

describe('refsOnMap ephemeral keepOwnTeam', () => {
  let view: ReturnType<typeof makeView>;
  let map: ReturnType<typeof makeMap>;
  let originalFetch: typeof window.fetch;

  function clickShowButton(): void {
    const button = document.querySelector('.svp-refs-on-map-button') as HTMLElement;
    button.click();
  }

  function clickCloseButton(): void {
    const button = document.querySelector('.svp-refs-on-map-close') as HTMLElement;
    button.click();
  }

  function setInventory(): void {
    const items = [{ t: 3, a: 4, c: [100.5, 13.7], g: 'ref-1', l: 'point-1', ti: 'A', f: 0 }];
    localStorage.setItem('inventory-cache', JSON.stringify(items));
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
    originalFetch = window.fetch;
    window.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
      } as unknown as Response),
    ) as unknown as typeof window.fetch;
    localStorage.setItem('auth', 'test-token');
    await refsOnMap.enable();
  });

  afterEach(async () => {
    await refsOnMap.disable();
    uninstallInviewFetchHookForTest();
    delete window.ol;
    localStorage.removeItem('inventory-cache');
    localStorage.removeItem('follow');
    localStorage.removeItem('auth');
    document.body.innerHTML = '';
    window.fetch = originalFetch;
  });

  test('reopen viewer: чекбокс off независимо от прошлого state, localStorage svp_refsOnMap отсутствует', async () => {
    setInventory();
    clickShowButton();
    await flushAsync();

    // Эмулируем включение в первом сеансе.
    const clickHandler = map._clickListeners[0];
    const allFeatures = (window.ol?.Feature as unknown as jest.Mock).mock.results.map(
      (r) => r.value as IOlFeature,
    );
    (map.forEachFeatureAtPixel as jest.Mock).mockImplementation(
      (_pixel: unknown, callback: (feature: IOlFeature) => void) => {
        callback(allFeatures[0]);
      },
    );
    clickHandler({ pixel: [0, 0] });
    const checkbox = document.querySelector(
      '.svp-refs-on-map-keep-own input[type="checkbox"]',
    ) as HTMLInputElement;
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));
    expect(checkbox.checked).toBe(true);

    // Закрываем viewer, открываем повторно.
    clickCloseButton();
    clickShowButton();
    await flushAsync();

    expect(checkbox.checked).toBe(false);
    expect(localStorage.getItem('svp_refsOnMap')).toBeNull();
  });
});

// ── progress + interaction lock (fallback /api/point worker) ─────────────────

describe('refsOnMap progress + interaction lock', () => {
  let view: ReturnType<typeof makeView>;
  let map: ReturnType<typeof makeMap>;
  let originalFetch: typeof window.fetch;
  let fetchSpy: jest.Mock;

  function clickShowButton(): void {
    const button = document.querySelector('.svp-refs-on-map-button') as HTMLElement;
    button.click();
  }

  function setInventory(): void {
    const items = [{ t: 3, a: 4, c: [100.5, 13.7], g: 'ref-1', l: 'point-1', ti: 'A', f: 0 }];
    localStorage.setItem('inventory-cache', JSON.stringify(items));
  }

  /**
   * Имитирует медленный /api/point с управляемым resolve. /inview сразу
   * отдаёт guid без `t`, чтобы handleInviewResponse поднял teamsLoading
   * через очередь fallback.
   */
  function configureSlowFallback(): { resolveAll: () => void } {
    const pending: (() => void)[] = [];
    fetchSpy.mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.includes('/api/inview')) {
        return Promise.resolve(makeInviewResponse([{ g: 'point-1' }]));
      }
      if (url.includes('/api/point')) {
        return new Promise<Response>((resolve) => {
          pending.push(() => {
            resolve({
              ok: true,
              json: () => Promise.resolve({ data: { te: 1 } }),
            } as unknown as Response);
          });
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
      } as unknown as Response);
    });
    return {
      resolveAll: () => {
        for (const r of pending) r();
        pending.length = 0;
      },
    };
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
    originalFetch = window.fetch;
    fetchSpy = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
      } as unknown as Response),
    );
    window.fetch = fetchSpy as unknown as typeof window.fetch;
    localStorage.setItem('auth', 'test-token');
    await refsOnMap.enable();
  });

  afterEach(async () => {
    await refsOnMap.disable();
    uninstallInviewFetchHookForTest();
    delete window.ol;
    localStorage.removeItem('inventory-cache');
    localStorage.removeItem('follow');
    localStorage.removeItem('auth');
    document.body.innerHTML = '';
    window.fetch = originalFetch;
  });

  test('во время fallback /api/point: trashButton disabled, прогресс-бар видим', async () => {
    setInventory();
    const slow = configureSlowFallback();
    clickShowButton();
    await flushAsync();

    await window.fetch('/api/inview?sw=1&ne=2&z=14');
    await flushAsync();

    const trash = document.querySelector('.svp-refs-on-map-trash') as HTMLButtonElement;
    expect(trash.disabled).toBe(true);
    const progress = document.querySelector('.svp-refs-on-map-progress') as HTMLElement;
    expect(progress.style.display).not.toBe('none');

    slow.resolveAll();
    await flushAsync();

    expect(trash.disabled).toBe(false);
    expect(progress.style.display).toBe('none');
  });

  test('во время fallback /api/point: клик по карте не выбирает фичу', async () => {
    setInventory();
    const slow = configureSlowFallback();
    clickShowButton();
    await flushAsync();
    await window.fetch('/api/inview?sw=1&ne=2&z=14');
    await flushAsync();

    const clickHandler = map._clickListeners[0];
    (map.forEachFeatureAtPixel as jest.Mock).mockClear();
    clickHandler({ pixel: [0, 0] });

    expect((map.forEachFeatureAtPixel as jest.Mock).mock.calls.length).toBe(0);

    slow.resolveAll();
    await flushAsync();
  });
});
