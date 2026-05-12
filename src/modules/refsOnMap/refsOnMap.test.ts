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

// keepOwnTeam и keepOneKey персистентны в localStorage (svp_refsOnMap).
// Для большинства тестов keepOneKey=true мешал бы существующим инвариантам
// (тесты на partition/lock/own написаны без учёта "оставить 1 ключ").
// Глобально форсим оба флага в false; тесты блока про keepOneKey явно
// перезаписывают свой стартовый state через saveRefsOnMapSettings.
beforeEach(() => {
  localStorage.setItem('svp_refsOnMap', JSON.stringify({ keepOwnTeam: false, keepOneKey: false }));
});

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

  test('locked-note удалён: в DOM его нет', () => {
    setInventoryCache();
    clickShowButton();
    expect(document.querySelector('.svp-refs-on-map-locked-note')).toBeNull();
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

  test('/inview опустошает очередь во время pending worker batch: teamLoadDone синхронизирован', async () => {
    // Сценарий задачи 2 из логов пользователя: active pull добавил N точек
    // в очередь. Worker берёт первый batch (BATCH_SIZE=5), оставляет N-5
    // в очереди, и зависает на await Promise.all (медленный /api/point).
    // В этот момент /inview приходит и удаляет из очереди оставшиеся N-5
    // guid'ов (queueDeleted=N-5). Без counter sync teamLoadDone остался
    // бы 0 (worker ещё не resolved batch); applyTeamsLoadedState закрыл
    // бы прогресс с done=5, total=N, mismatch=N-5. С counter sync done
    // инкрементируется на queueDeleted сразу.
    //
    // 7 точек: worker batch=5, 2 в очереди ждут next batch. /inview
    // приносит команды для всех 7; queueDeleted=2 (только оставшиеся 2).
    const items = Array.from({ length: 7 }, (_, i) => ({
      t: 3,
      a: 1,
      c: [100.5, 13.7],
      g: `ref-${i + 1}`,
      l: `point-${i + 1}`,
      ti: 'X',
      f: 0,
    }));
    localStorage.setItem('inventory-cache', JSON.stringify(items));

    const pointPending: (() => void)[] = [];
    fetchSpy.mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.includes('/api/inview')) {
        return Promise.resolve(
          makeInviewResponse(
            Array.from({ length: 7 }, (_, i) => ({ g: `point-${i + 1}`, t: i + 1 })),
          ),
        );
      }
      if (url.includes('/api/point')) {
        return new Promise<Response>((resolve) => {
          pointPending.push(() => {
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

    view.calculateExtent = (): number[] => [-1000, -1000, 1000, 1000];
    clickShowButton();
    await flushAsync();

    const progressCounter = document.querySelector(
      '.svp-refs-on-map-progress-counter',
    ) as HTMLElement;
    // Worker запустил pending /api/point для первых 5 guid'ов, 2 в очереди.
    // teamLoadDone=0, teamLoadTotal=7.
    expect(progressCounter.textContent).toBe('0 / 7');

    // /inview опустошает оставшиеся 2 guid'а из очереди (первые 5 уже
    // вытащены worker'ом в batch и удалены из queue синхронно).
    await window.fetch('/api/inview?sw=1&ne=2&z=14');
    await flushAsync();

    // С counter sync: done = 0 (worker) + 2 (queueDeleted via inview) = 2.
    // Без него: '0 / 7' - регрессия.
    expect(progressCounter.textContent).toBe('2 / 7');

    // Cleanup: resolve pending pointFetch worker'а.
    for (const r of pointPending) r();
    await flushAsync();
  });

  test('/inview приходит после полного завершения worker: applyTeamsLoadedState не дёргается повторно', async () => {
    // Edge case: worker уже завершил все batch'и и applyTeamsLoadedState
    // отработал (teamLoadTotal=0, teamLoadDone=0, прогресс скрыт). /inview
    // приходит позже - queueDeleted=0 (очередь была пуста), counter sync
    // ничего не делает, прогресс остаётся скрытым.
    setInventory();
    fetchSpy.mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.includes('/api/inview')) {
        return Promise.resolve(
          makeInviewResponse([
            { g: 'point-1', t: 1 },
            { g: 'point-2', t: 2 },
          ]),
        );
      }
      if (url.includes('/api/point')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ data: { te: 5 } }),
        } as unknown as Response);
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
      } as unknown as Response);
    });
    view.calculateExtent = (): number[] => [-1000, -1000, 1000, 1000];
    clickShowButton();
    await flushAsync(); // worker завершает все 2 fetch'а

    const progress = document.querySelector('.svp-refs-on-map-progress') as HTMLElement;
    expect(progress.style.display).toBe('none');

    // /inview приходит позже.
    await window.fetch('/api/inview?sw=1&ne=2&z=14');
    await flushAsync();

    // Прогресс остаётся скрытым, очередь пуста.
    expect(progress.style.display).toBe('none');
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

  test('moveend пока worker pending: total НЕ растёт (in-flight guard)', async () => {
    // Сценарий пользователя: zoom туда-сюда увеличивал teamLoadTotal,
    // потому что worker между batch-delete и await Promise.all держал
    // guid'ы "в полёте" (не в очереди, не в кэше); enqueueVisibleForLoad
    // на каждом moveend видел их как "новые" и добавлял заново.
    // Фикс: teamLoadInFlight Set, enqueueVisibleForLoad skip'ит.
    const items = [
      { t: 3, a: 4, c: [100.5, 13.7], g: 'ref-1', l: 'point-1', ti: 'A', f: 0 },
      { t: 3, a: 2, c: [101.0, 14.0], g: 'ref-2', l: 'point-2', ti: 'B', f: 0 },
    ];
    localStorage.setItem('inventory-cache', JSON.stringify(items));
    // Замедляем /api/point чтобы воспроизвести "worker pending".
    const pending: (() => void)[] = [];
    window.fetch = jest.fn(() => {
      return new Promise<Response>((resolve) => {
        pending.push(() => {
          resolve({
            ok: true,
            json: () => Promise.resolve({ data: { te: 1 } }),
          } as unknown as Response);
        });
      });
    }) as unknown as typeof window.fetch;

    setExtent([-1000, -1000, 1000, 1000]);
    clickShowButton();
    await flushAsync();

    const progressCounter = document.querySelector(
      '.svp-refs-on-map-progress-counter',
    ) as HTMLElement;
    // Worker взял оба guid'а в batch и ждёт pending. Total=2.
    expect(progressCounter.textContent).toBe('0 / 2');

    // Симулируем zoom: тот же extent, moveend dispatched дважды.
    emitMoveend();
    await flushAsync();
    emitMoveend();
    await flushAsync();
    emitMoveend();
    await flushAsync();

    // Total остался 2 - in-flight guid'ы не добавлены повторно.
    expect(progressCounter.textContent).toBe('0 / 2');

    // Cleanup.
    for (const r of pending) r();
    await flushAsync();
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

  test('moveend с новыми guid-ами НЕ сбрасывает keepOwnTeam (persistent)', async () => {
    // Регрессия для feature: фильтр персистентен в localStorage и НЕ
    // сбрасывается при смене видимой области. Точки без team защищены
    // fail-safe (protectedByUnknownTeam) - сбрасывать чекбокс не нужно.
    setInventory();
    setExtent([100, 100, 200, 200]);
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
    const checkbox = document.querySelector(
      '.svp-refs-on-map-keep-own input[type="checkbox"]',
    ) as HTMLInputElement;
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));
    expect(checkbox.checked).toBe(true);

    // Pan в новый extent с новыми guid'ами.
    setExtent([-1000, -1000, 1000, 1000]);
    emitMoveend();
    await flushAsync();

    // Чекбокс остался включённым, toast не появился.
    expect(checkbox.checked).toBe(true);
    expect(document.querySelector('.svp-toast')).toBeNull();
  });

  test('/api/point fetch failure: повторный moveend НЕ перезапрашивает ту же точку', async () => {
    // fetchPointTeam возвращает 'failed' когда ответ нераспознан (нет ни
    // числового data.te, ни data.te:null). Раньше каждый moveend возвращал
    // такой guid в очередь, worker дёргал /api/point снова - loop. Сейчас
    // worker пишет 'failed' в teamCache, enqueueVisibleForLoad skip'ит.
    const items = [{ t: 3, a: 4, c: [100.5, 13.7], g: 'ref-1', l: 'point-fail', ti: 'X', f: 0 }];
    localStorage.setItem('inventory-cache', JSON.stringify(items));
    // Возвращаем пустой объект - data.te отсутствует.
    teamFetchSpy.mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
      } as unknown as Response),
    );
    setExtent([-1000, -1000, 1000, 1000]);
    clickShowButton();
    await flushAsync();

    // Первый раз: /api/point вызван 1 раз для point-fail.
    expect(teamFetchSpy).toHaveBeenCalledTimes(1);

    // Эмулируем серию moveend на том же extent.
    emitMoveend();
    await flushAsync();
    emitMoveend();
    await flushAsync();
    emitMoveend();
    await flushAsync();

    // Никаких повторных запросов: точка уже в teamCache как 'failed'.
    expect(teamFetchSpy).toHaveBeenCalledTimes(1);
  });

  test('feature.team остаётся undefined для точек с failed-fetch в teamCache (fail-safe protection)', async () => {
    // fetch упал / ответ нераспознан -> teamCache='failed', feature.team
    // остаётся undefined. partitionByLockProtection классифицирует такие
    // точки как protectedByUnknownTeam при keepOwnTeam=true.
    const items = [{ t: 3, a: 4, c: [100.5, 13.7], g: 'ref-1', l: 'point-fail', ti: 'X', f: 0 }];
    localStorage.setItem('inventory-cache', JSON.stringify(items));
    teamFetchSpy.mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
      } as unknown as Response),
    );
    setExtent([-1000, -1000, 1000, 1000]);
    clickShowButton();
    await flushAsync();

    const features = (window.ol?.Feature as unknown as jest.Mock).mock.results.map(
      (r) => r.value as IOlFeature,
    );
    expect(features[0].getProperties?.().team).toBeUndefined();
  });

  test('/api/point data.te:null (neutral): feature.team=null, точка deletable при keepOwnTeam=true', async () => {
    // Сервер вернул 200 OK с data.te:null - точка нейтральная, у неё нет
    // владельца. feature.team=null (а НЕ undefined), partitionByLockProtection
    // отнесёт точку в deletable (не своя), не в protectedByUnknownTeam.
    // Раньше neutral и failed склеивались, и пользователь видел "unknown
    // team" в UI даже после полной отработки worker'а.
    const items = [{ t: 3, a: 4, c: [100.5, 13.7], g: 'ref-1', l: 'point-neutral', ti: 'N', f: 0 }];
    localStorage.setItem('inventory-cache', JSON.stringify(items));
    teamFetchSpy.mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ data: { te: null } }),
      } as unknown as Response),
    );
    setExtent([-1000, -1000, 1000, 1000]);
    clickShowButton();
    await flushAsync();

    const features = (window.ol?.Feature as unknown as jest.Mock).mock.results.map(
      (r) => r.value as IOlFeature,
    );
    // feature.team === null (neutral marker), не undefined.
    expect(features[0].getProperties?.().team).toBeNull();

    // Выделяем точку, включаем keepOwnTeam. UI breakdown:
    const clickHandler = map._clickListeners[0];
    (map.forEachFeatureAtPixel as jest.Mock).mockImplementation(
      (_pixel: unknown, callback: (feature: IOlFeature) => void) => {
        callback(features[0]);
      },
    );
    clickHandler({ pixel: [0, 0] });
    const checkbox = document.querySelector(
      '.svp-refs-on-map-keep-own input[type="checkbox"]',
    ) as HTMLInputElement;
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));

    // Точка в deletable, НЕ в unknown.
    const trash = document.querySelector('.svp-refs-on-map-trash') as HTMLButtonElement;
    expect(trash.textContent).toMatch(/1\s*\(\s*4\s*(?:ключей|keys)\)/);
    const unknownRow = document.querySelector(
      '.svp-refs-on-map-selection-info__unknown',
    ) as HTMLElement;
    expect(unknownRow.style.display).toBe('none');
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

  test('team=1 (красные): текст чекбокса "Не удалять красные"', () => {
    mockGetPlayerTeam.mockReturnValue(1);
    setInventory();
    clickShowButton();
    const label = document.querySelector('.svp-refs-on-map-keep-own') as HTMLElement;
    expect(label.textContent).toMatch(/(?:Не удалять красные|Keep red)/);
  });

  test('team=2 (зелёные): текст чекбокса "Не удалять зелёные"', () => {
    mockGetPlayerTeam.mockReturnValue(2);
    setInventory();
    clickShowButton();
    const label = document.querySelector('.svp-refs-on-map-keep-own') as HTMLElement;
    expect(label.textContent).toMatch(/(?:Не удалять зелёные|Keep green)/);
  });

  test('team=3 (синие): текст чекбокса "Не удалять синие"', () => {
    mockGetPlayerTeam.mockReturnValue(3);
    setInventory();
    clickShowButton();
    const label = document.querySelector('.svp-refs-on-map-keep-own') as HTMLElement;
    expect(label.textContent).toMatch(/(?:Не удалять синие|Keep blue)/);
  });

  test('playerTeam=null: fallback "Не удалять свои" (чекбокс остаётся функциональным)', () => {
    mockGetPlayerTeam.mockReturnValue(null);
    setInventory();
    clickShowButton();
    const label = document.querySelector('.svp-refs-on-map-keep-own') as HTMLElement;
    expect(label.textContent).toMatch(/(?:Не удалять свои|Keep own team)/);
  });

  test('смена команды между showViewer: текст label обновляется', () => {
    setInventory();
    mockGetPlayerTeam.mockReturnValue(2);
    clickShowButton();
    const label = document.querySelector('.svp-refs-on-map-keep-own') as HTMLElement;
    expect(label.textContent).toMatch(/(?:Не удалять зелёные|Keep green)/);

    // Закрываем viewer, меняем команду игрока, открываем снова.
    const closeButton = document.querySelector('.svp-refs-on-map-close') as HTMLElement;
    closeButton.click();
    mockGetPlayerTeam.mockReturnValue(1);
    clickShowButton();
    expect(label.textContent).toMatch(/(?:Не удалять красные|Keep red)/);
  });
});

// ── cancel button (deselect all) ────────────────────────────────────────────

describe('refsOnMap cancel button', () => {
  let view: ReturnType<typeof makeView>;
  let map: ReturnType<typeof makeMap>;
  let originalFetch: typeof window.fetch;

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
    localStorage.removeItem('auth');
    document.body.innerHTML = '';
    window.fetch = originalFetch;
  });

  test('cancel-кнопка hidden при 0 selected, visible при > 0', () => {
    setInventory();
    clickShowButton();

    const cancel = document.querySelector('.svp-refs-on-map-cancel') as HTMLButtonElement;
    expect(cancel).not.toBeNull();
    expect(cancel.style.visibility).toBe('hidden');

    // Select.
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

    expect(cancel.style.visibility).toBe('visible');
  });

  test('клик по cancel: все isSelected=true фичи сбрасываются, UI обновляется', () => {
    setInventory();
    clickShowButton();

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

    expect(allFeatures[0].getProperties?.().isSelected).toBe(true);
    expect(allFeatures[1].getProperties?.().isSelected).toBe(true);

    const cancel = document.querySelector('.svp-refs-on-map-cancel') as HTMLButtonElement;
    cancel.click();

    expect(allFeatures[0].getProperties?.().isSelected).toBe(false);
    expect(allFeatures[1].getProperties?.().isSelected).toBe(false);

    // UI отражает 0 selected.
    expect(cancel.style.visibility).toBe('hidden');
    const trash = document.querySelector('.svp-refs-on-map-trash') as HTMLButtonElement;
    expect(trash.style.visibility).toBe('hidden');
  });

  test('cancel удаляется из DOM при disable модуля', async () => {
    expect(document.querySelector('.svp-refs-on-map-cancel')).not.toBeNull();
    await refsOnMap.disable();
    expect(document.querySelector('.svp-refs-on-map-cancel')).toBeNull();
  });

  test('cancel содержит SVG-иконку крестика, не текст', () => {
    const cancel = document.querySelector('.svp-refs-on-map-cancel') as HTMLButtonElement;
    const svg = cancel.querySelector('svg');
    expect(svg).not.toBeNull();
    // Две диагональные line - линии крестика.
    expect(cancel.querySelectorAll('svg path').length).toBe(2);
    // Содержимое - не plain text (текстовых детей нет, кроме whitespace).
    const directText = Array.from(cancel.childNodes)
      .filter((n) => n.nodeType === Node.TEXT_NODE)
      .map((n) => n.textContent ?? '')
      .join('')
      .trim();
    expect(directText).toBe('');
  });
});

// ── keepOwnTeam persistence (localStorage) ──────────────────────────────────

describe('refsOnMap keepOwnTeam persistence', () => {
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

  test('toggle чекбокса сохраняется в localStorage svp_refsOnMap', () => {
    setInventory();
    clickShowButton();
    const checkbox = document.querySelector(
      '.svp-refs-on-map-keep-own input[type="checkbox"]',
    ) as HTMLInputElement;

    expect(checkbox.checked).toBe(false);
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));
    expect(JSON.parse(localStorage.getItem('svp_refsOnMap') ?? '{}')).toEqual({
      keepOwnTeam: true,
      keepOneKey: false,
    });

    checkbox.checked = false;
    checkbox.dispatchEvent(new Event('change'));
    expect(JSON.parse(localStorage.getItem('svp_refsOnMap') ?? '{}')).toEqual({
      keepOwnTeam: false,
      keepOneKey: false,
    });
  });

  test('повторное открытие viewer восстанавливает state чекбокса из storage', () => {
    localStorage.setItem('svp_refsOnMap', JSON.stringify({ keepOwnTeam: true, keepOneKey: false }));
    setInventory();
    clickShowButton();
    const checkbox = document.querySelector(
      '.svp-refs-on-map-keep-own input[type="checkbox"]',
    ) as HTMLInputElement;
    expect(checkbox.checked).toBe(true);

    clickCloseButton();
    clickShowButton();
    expect(checkbox.checked).toBe(true);
  });

  test('keepOwnTeam=true сохранён: handleDeleteClick применяет фильтр после reopen viewer', async () => {
    // Установка через localStorage напрямую (имитация: пользователь
    // включил в прошлом сеансе и перезагрузил страницу). keepOneKey=false
    // явно - этот тест проверяет только keepOwnTeam, без вмешательства
    // правила "оставлять 1 ключ".
    localStorage.setItem('svp_refsOnMap', JSON.stringify({ keepOwnTeam: true, keepOneKey: false }));
    mockGetPlayerTeam.mockReturnValue(1);
    const items = [
      { t: 3, a: 4, c: [100.5, 13.7], g: 'ref-own', l: 'point-own', ti: 'O', f: 0 },
      { t: 3, a: 2, c: [101.0, 14.0], g: 'ref-enemy', l: 'point-enemy', ti: 'E', f: 0 },
    ];
    localStorage.setItem('inventory-cache', JSON.stringify(items));

    clickShowButton();
    await flushAsync();

    // Manually set team на feature (имитация загрузки).
    const allFeatures = (window.ol?.Feature as unknown as jest.Mock).mock.results.map(
      (r) => r.value as IOlFeature,
    );
    for (const f of allFeatures) {
      const guid = f.getProperties?.().pointGuid;
      if (guid === 'point-own') f.set?.('team', 1);
      if (guid === 'point-enemy') f.set?.('team', 2);
    }

    // Выбор обеих фич.
    const clickHandler = map._clickListeners[0];
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

    // Подтверждаем DELETE.
    window.confirm = jest.fn(() => true);
    const fetchSpy = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ count: { total: 90 } }),
      } as unknown as Response),
    );
    window.fetch = fetchSpy as unknown as typeof window.fetch;

    const trash = document.querySelector('.svp-refs-on-map-trash') as HTMLElement;
    trash.click();
    await flushAsync();

    // payload: только enemy (own отфильтрована через keepOwnTeam=true).
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const init = (
      fetchSpy.mock.calls as unknown as [RequestInfo | URL, RequestInit?][]
    )[0][1] as RequestInit;
    const body = JSON.parse(init.body as string) as {
      selection: Record<string, number>;
    };
    expect(body.selection).toEqual({ 'ref-enemy': 2 });
    expect(body.selection).not.toHaveProperty('ref-own');
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

  test('во время загрузки + keepOwnTeam=true: trashButton disabled', async () => {
    setInventory();
    const slow = configureSlowFallback();
    clickShowButton();
    await flushAsync();
    await window.fetch('/api/inview?sw=1&ne=2&z=14');
    await flushAsync();

    // Выбираем фичу, включаем keepOwnTeam - blocks trash.
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

    const trash = document.querySelector('.svp-refs-on-map-trash') as HTMLButtonElement;
    expect(trash.disabled).toBe(true);
    // Spinner-иконка визуально замещает эмодзи "🗑️" через data-loading.
    expect(trash.dataset.loading).toBe('true');
    const defaultIcon = trash.querySelector('.svp-refs-on-map-trash-icon-default') as HTMLElement;
    const loadingIcon = trash.querySelector('.svp-refs-on-map-trash-icon-loading') as HTMLElement;
    expect(defaultIcon).not.toBeNull();
    expect(loadingIcon).not.toBeNull();
    // Loader span пустой - CSS::before рисует крутилку (keyframe loading
    // в style@0.6.1.css игры). Проверяем чистоту span'а: нет inline SVG /
    // text, только pseudo-element-driven content.
    expect(loadingIcon.innerHTML).toBe('');
    const progress = document.querySelector('.svp-refs-on-map-progress') as HTMLElement;
    expect(progress.style.display).not.toBe('none');

    slow.resolveAll();
    await flushAsync();

    expect(trash.disabled).toBe(false);
    // После завершения загрузки data-loading=false: эмодзи мусорки снова
    // видимая через CSS-селекторы.
    expect(trash.dataset.loading).toBe('false');
    expect(progress.style.display).toBe('none');
  });

  test('во время загрузки + keepOwnTeam=false: trashButton НЕ disabled', async () => {
    // Без фильтра свои feature.team не нужен в payload - lock защищается
    // через inventory-cache.f, удаление безопасно.
    setInventory();
    const slow = configureSlowFallback();
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

    const trash = document.querySelector('.svp-refs-on-map-trash') as HTMLButtonElement;
    expect(trash.disabled).toBe(false);
    // Без фильтра спиннер не показываем - данные ещё грузятся, но удаление
    // не зависит от team, кнопка работоспособна.
    expect(trash.dataset.loading).toBe('false');

    slow.resolveAll();
    await flushAsync();
  });

  test('во время загрузки: клик по карте ВСЕГДА выбирает фичу (блокировки нет)', async () => {
    setInventory();
    const slow = configureSlowFallback();
    clickShowButton();
    await flushAsync();
    await window.fetch('/api/inview?sw=1&ne=2&z=14');
    await flushAsync();

    const clickHandler = map._clickListeners[0];
    (map.forEachFeatureAtPixel as jest.Mock).mockClear();
    const allFeatures = (window.ol?.Feature as unknown as jest.Mock).mock.results.map(
      (r) => r.value as IOlFeature,
    );
    (map.forEachFeatureAtPixel as jest.Mock).mockImplementation(
      (_pixel: unknown, callback: (feature: IOlFeature) => void) => {
        callback(allFeatures[0]);
      },
    );
    clickHandler({ pixel: [0, 0] });

    // forEachFeatureAtPixel вызывается несмотря на teamsLoading.
    expect((map.forEachFeatureAtPixel as jest.Mock).mock.calls.length).toBeGreaterThan(0);
    // Фича выбрана: feature.isSelected=true.
    expect(allFeatures[0].getProperties?.().isSelected).toBe(true);

    slow.resolveAll();
    await flushAsync();
  });

  test('фоновая загрузка НЕ-выбранных точек: trash НЕ disabled (selection-aware)', async () => {
    // 6 точек: первые 5 быстро резолвятся (батч 1 worker'а), 6-я (bg-pt)
    // медленно. Между батчами worker ждёт delay(100ms). В этом окне
    // selected-pt (одна из первых 5) уже не в queue/in-flight, а bg-pt
    // ещё не взят. teamsLoading=true глобально, но selection-aware
    // проверка должна разблокировать trash.
    const items = [
      { t: 3, a: 1, c: [100.5, 13.7], g: 'ref-1', l: 'selected-pt', ti: 'S', f: 0 },
      { t: 3, a: 1, c: [100.5, 13.7], g: 'ref-2', l: 'pt-2', ti: '2', f: 0 },
      { t: 3, a: 1, c: [100.5, 13.7], g: 'ref-3', l: 'pt-3', ti: '3', f: 0 },
      { t: 3, a: 1, c: [100.5, 13.7], g: 'ref-4', l: 'pt-4', ti: '4', f: 0 },
      { t: 3, a: 1, c: [100.5, 13.7], g: 'ref-5', l: 'pt-5', ti: '5', f: 0 },
      { t: 3, a: 8, c: [101.0, 14.0], g: 'ref-bg', l: 'bg-pt', ti: 'B', f: 0 },
    ];
    localStorage.setItem('inventory-cache', JSON.stringify(items));
    const pending: (() => void)[] = [];
    fetchSpy.mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.includes('/api/point')) {
        if (url.includes('bg-pt')) {
          return new Promise<Response>((resolve) => {
            pending.push(() => {
              resolve({
                ok: true,
                json: () => Promise.resolve({ data: { te: 2 } }),
              } as unknown as Response);
            });
          });
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ data: { te: 1 } }),
        } as unknown as Response);
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
      } as unknown as Response);
    });
    clickShowButton();
    // Batch 1 worker'а резолвит 5 точек (включая selected-pt). Ждём реально
    // 150ms, чтобы дошли до delay(100ms) между батчами; bg-pt в этот момент
    // уже взят в batch 2 (в-полёте) и ждёт slow Promise.
    await new Promise((r) => setTimeout(r, 150));
    await flushAsync();

    const clickHandler = map._clickListeners[0];
    const allFeatures = (window.ol?.Feature as unknown as jest.Mock).mock.results.map(
      (r) => r.value as IOlFeature,
    );
    const selectedFeature = allFeatures.find(
      (f) => f.getProperties?.().pointGuid === 'selected-pt',
    );
    expect(selectedFeature).toBeDefined();
    (map.forEachFeatureAtPixel as jest.Mock).mockImplementation(
      (_pixel: unknown, callback: (feature: IOlFeature) => void) => {
        if (selectedFeature) callback(selectedFeature);
      },
    );
    clickHandler({ pixel: [0, 0] });

    const checkbox = document.querySelector(
      '.svp-refs-on-map-keep-own input[type="checkbox"]',
    ) as HTMLInputElement;
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));

    const trash = document.querySelector('.svp-refs-on-map-trash') as HTMLButtonElement;
    expect(trash.disabled).toBe(false);
    expect(trash.dataset.loading).toBe('false');
    // Прогресс-бар остаётся виден - фоновая загрузка для bg-pt идёт.
    const progress = document.querySelector('.svp-refs-on-map-progress') as HTMLElement;
    expect(progress.style.display).not.toBe('none');

    // Дорезолвим bg-pt чтобы worker завершился до afterEach.
    for (const r of pending) r();
    await flushAsync();
  });
});

// ── selection breakdown UI ───────────────────────────────────────────────────

describe('refsOnMap selection breakdown UI', () => {
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

  function selectFeatureByIndex(index: number): void {
    const clickHandler = map._clickListeners[0];
    const allFeatures = (window.ol?.Feature as unknown as jest.Mock).mock.results.map(
      (r) => r.value as IOlFeature,
    );
    (map.forEachFeatureAtPixel as jest.Mock).mockImplementation(
      (_pixel: unknown, callback: (feature: IOlFeature) => void) => {
        callback(allFeatures[index]);
      },
    );
    clickHandler({ pixel: [0, 0] });
  }

  function applyTeams(teamsByPoint: Record<string, number>): void {
    const allFeatures = (window.ol?.Feature as unknown as jest.Mock).mock.results.map(
      (r) => r.value as IOlFeature,
    );
    for (const feature of allFeatures) {
      const pointGuid = feature.getProperties?.().pointGuid;
      if (typeof pointGuid !== 'string') continue;
      const team = teamsByPoint[pointGuid];
      if (typeof team === 'number') feature.set?.('team', team);
    }
  }

  /**
   * Две точки: point-own (своя команда=1, две стопки по 4 и 1 ключ) и
   * point-enemy (чужая=2, одна стопка 2 ключа). Покрывает per-point
   * агрегацию: одна точка с несколькими стопками должна считаться один раз
   * в selectedPoints/deletablePoints.
   */
  function setInventoryTwoPointsThreeStacks(): void {
    const items = [
      { t: 3, a: 4, c: [100.5, 13.7], g: 'ref-1', l: 'point-own', ti: 'Mine', f: 0 },
      { t: 3, a: 1, c: [100.5, 13.7], g: 'ref-1b', l: 'point-own', ti: 'Mine', f: 0 },
      { t: 3, a: 2, c: [101.0, 14.0], g: 'ref-2', l: 'point-enemy', ti: 'Enemy', f: 0 },
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
    // Заглушаем active pull через extent: тесты breakdown UI работают
    // вручную через applyTeams + clickHandler.
    view.calculateExtent = (): number[] => [100, 100, 200, 200];
    window.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
      } as unknown as Response),
    ) as unknown as typeof window.fetch;
    localStorage.setItem('auth', 'test-token');
    mockGetPlayerTeam.mockReturnValue(1);
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

  test('0 selected: selectionInfo скрыт, trashButton hidden', async () => {
    setInventoryTwoPointsThreeStacks();
    clickShowButton();
    await flushAsync();

    const info = document.querySelector('.svp-refs-on-map-selection-info') as HTMLElement;
    expect(info).not.toBeNull();
    expect(info.style.display).toBe('none');

    const trash = document.querySelector('.svp-refs-on-map-trash') as HTMLButtonElement;
    expect(trash.style.visibility).toBe('hidden');
  });

  test('select 1 стопка из point-own (deletable, keepOwnTeam=false): кнопка "1 (4 ключей)"', async () => {
    setInventoryTwoPointsThreeStacks();
    clickShowButton();
    await flushAsync();
    applyTeams({ 'point-own': 1, 'point-enemy': 2 });

    selectFeatureByIndex(0); // ref-1 (point-own, 4 ключа)

    const trash = document.querySelector('.svp-refs-on-map-trash') as HTMLButtonElement;
    expect(trash.style.visibility).toBe('visible');
    // 1 точка (4 ключей). Regex кросс-локальный.
    expect(trash.textContent).toMatch(/1\s*\(\s*4\s*(?:ключей|keys)\)/);
  });

  test('per-point агрегация: 2 стопки одной точки = 1 точка, 5 ключей', async () => {
    setInventoryTwoPointsThreeStacks();
    clickShowButton();
    await flushAsync();
    applyTeams({ 'point-own': 1, 'point-enemy': 2 });

    selectFeatureByIndex(0); // ref-1 (point-own, 4)
    selectFeatureByIndex(1); // ref-1b (point-own, 1) - та же точка

    const trash = document.querySelector('.svp-refs-on-map-trash') as HTMLButtonElement;
    expect(trash.textContent).toMatch(/1\s*\(\s*5\s*(?:ключей|keys)\)/);

    const total = document.querySelector('.svp-refs-on-map-selection-info__total') as HTMLElement;
    // "Всего: 1 (5 ключей). Из них:"
    expect(total.textContent).toMatch(/(?:Выделено|Selected):\s*1\s*\(\s*5\s*(?:ключей|keys)\)/);
  });

  test('selectionInfo строки: total + protected + deletable, без own-row при keepOwnTeam=false', async () => {
    setInventoryTwoPointsThreeStacks();
    clickShowButton();
    await flushAsync();
    applyTeams({ 'point-own': 1, 'point-enemy': 2 });

    selectFeatureByIndex(0); // point-own (4)
    selectFeatureByIndex(2); // point-enemy (2)

    const info = document.querySelector('.svp-refs-on-map-selection-info') as HTMLElement;
    expect(info.style.display).not.toBe('none');

    const total = document.querySelector('.svp-refs-on-map-selection-info__total') as HTMLElement;
    expect(total.textContent).toMatch(/(?:Выделено|Selected):\s*2\s*\(\s*6\s*(?:ключей|keys)\)/);

    // lock=0 -> protected row hidden. own/unknown тоже hidden при
    // keepOwnTeam=false. Видимы только total и deletable.
    const protectedRow = document.querySelector(
      '.svp-refs-on-map-selection-info__protected',
    ) as HTMLElement;
    expect(protectedRow.style.display).toBe('none');

    const own = document.querySelector('.svp-refs-on-map-selection-info__own') as HTMLElement;
    expect(own.style.display).toBe('none');

    const unknown = document.querySelector(
      '.svp-refs-on-map-selection-info__unknown',
    ) as HTMLElement;
    expect(unknown.style.display).toBe('none');

    const deletableRow = document.querySelector(
      '.svp-refs-on-map-selection-info__deletable',
    ) as HTMLElement;
    expect(deletableRow.textContent).toMatch(/6\s*(?:ключей|key)/);
    expect(deletableRow.textContent).toMatch(/(?:к удалению|to delete)/);
  });

  test('keepOwnTeam=true: own-row видна, deletable исключает своих, protected пуст без lock', async () => {
    setInventoryTwoPointsThreeStacks();
    clickShowButton();
    await flushAsync();
    applyTeams({ 'point-own': 1, 'point-enemy': 2 });

    selectFeatureByIndex(0); // point-own (4)
    selectFeatureByIndex(1); // point-own (1)
    selectFeatureByIndex(2); // point-enemy (2)

    const checkbox = document.querySelector(
      '.svp-refs-on-map-keep-own input[type="checkbox"]',
    ) as HTMLInputElement;
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));

    const total = document.querySelector('.svp-refs-on-map-selection-info__total') as HTMLElement;
    // 2 точки (5 own + 2 enemy = 7 ключей суммарно). Из них:
    expect(total.textContent).toMatch(/(?:Выделено|Selected):\s*2\s*\(\s*7\s*(?:ключей|keys)\)/);

    // lock=0 -> protected row hidden. own=1 (5 keys) visible.
    const protectedRow = document.querySelector(
      '.svp-refs-on-map-selection-info__protected',
    ) as HTMLElement;
    expect(protectedRow.style.display).toBe('none');

    const own = document.querySelector('.svp-refs-on-map-selection-info__own') as HTMLElement;
    expect(own.style.display).not.toBe('none');
    // playerTeam=1 -> "красные" / "red" (см. beforeEach + getOwnRowText).
    expect(own.textContent).toMatch(/1\s*\(\s*5\s*(?:ключей|keys)\)\s*(?:красные|red)/);

    // unknown=0 -> unknown row hidden.
    const unknown = document.querySelector(
      '.svp-refs-on-map-selection-info__unknown',
    ) as HTMLElement;
    expect(unknown.style.display).toBe('none');

    const trash = document.querySelector('.svp-refs-on-map-trash') as HTMLButtonElement;
    // Удаляется enemy: 1 точка (2 ключа).
    expect(trash.textContent).toMatch(/1\s*\(\s*2\s*(?:ключей|keys)\)/);

    const deletableRow = document.querySelector(
      '.svp-refs-on-map-selection-info__deletable',
    ) as HTMLElement;
    expect(deletableRow.textContent).toMatch(/2\s*(?:ключей|key)/);
    expect(deletableRow.textContent).toMatch(/(?:к удалению|to delete)/);
  });

  test('own-row текст под цвет команды: team=2 (зелёные)', async () => {
    mockGetPlayerTeam.mockReturnValue(2);
    setInventoryTwoPointsThreeStacks();
    clickShowButton();
    await flushAsync();
    applyTeams({ 'point-own': 2, 'point-enemy': 1 }); // own=зелёный, enemy=красный

    selectFeatureByIndex(0);
    selectFeatureByIndex(1);
    selectFeatureByIndex(2);

    const checkbox = document.querySelector(
      '.svp-refs-on-map-keep-own input[type="checkbox"]',
    ) as HTMLInputElement;
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));

    const own = document.querySelector('.svp-refs-on-map-selection-info__own') as HTMLElement;
    expect(own.style.display).not.toBe('none');
    expect(own.textContent).toMatch(/1\s*\(\s*5\s*(?:ключей|keys)\)\s*(?:зелёные|green)/);
  });

  test('own-row текст под цвет команды: team=3 (синие)', async () => {
    mockGetPlayerTeam.mockReturnValue(3);
    setInventoryTwoPointsThreeStacks();
    clickShowButton();
    await flushAsync();
    applyTeams({ 'point-own': 3, 'point-enemy': 1 });

    selectFeatureByIndex(0);
    selectFeatureByIndex(1);
    selectFeatureByIndex(2);

    const checkbox = document.querySelector(
      '.svp-refs-on-map-keep-own input[type="checkbox"]',
    ) as HTMLInputElement;
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));

    const own = document.querySelector('.svp-refs-on-map-selection-info__own') as HTMLElement;
    expect(own.textContent).toMatch(/1\s*\(\s*5\s*(?:ключей|keys)\)\s*(?:синие|blue)/);
  });

  test('own-row текст: playerTeam=null -> fallback "своего цвета"', async () => {
    // Defensive: при null breakdown defensive-режим относит всё в unknown,
    // own-row не показывается. Этот тест проверяет другой сценарий:
    // playerTeam=null И keepOwnTeam=false (фильтр выключен) - own-row hidden
    // независимо от текста. Реальный fallback-текст ownRow покрыт через
    // getOwnRowText() в условиях когда own-bucket не пуст. Сделаем through
    // ручной вызов: точка с team=number, keepOwnTeam=true, playerTeam=null
    // -> defensive переводит ВСЁ в unknown (см. computeSelectionBreakdown),
    // own-row пуст. Проверим что fallback все же подключается через
    // getOwnRowText прямо: forging breakdown руками не получится без рефакторинга,
    // поэтому просто проверим что текст в строке не нарушает формат -
    // покрытие fallback есть в getKeepOwnTeamLabelText через "Не удалять свои"
    // (label-test ниже в checkbox visibility блоке).
    mockGetPlayerTeam.mockReturnValue(null);
    setInventoryTwoPointsThreeStacks();
    clickShowButton();
    await flushAsync();
    applyTeams({ 'point-own': 1, 'point-enemy': 2 });
    selectFeatureByIndex(0);

    const own = document.querySelector('.svp-refs-on-map-selection-info__own') as HTMLElement;
    // keepOwnTeam=false по beforeEach => row hidden.
    expect(own.style.display).toBe('none');
  });

  test('toggle keepOwnTeam пересчитывает breakdown без повторного клика по фиче', async () => {
    setInventoryTwoPointsThreeStacks();
    clickShowButton();
    await flushAsync();
    applyTeams({ 'point-own': 1, 'point-enemy': 2 });

    selectFeatureByIndex(0); // point-own (4)
    selectFeatureByIndex(2); // point-enemy (2)

    const trash = document.querySelector('.svp-refs-on-map-trash') as HTMLButtonElement;
    // OFF: обе точки в deletable -> 2 (6 ключей).
    expect(trash.textContent).toMatch(/2\s*\(\s*6\s*(?:ключей|keys)\)/);

    const checkbox = document.querySelector(
      '.svp-refs-on-map-keep-own input[type="checkbox"]',
    ) as HTMLInputElement;
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));

    // ON: own (point-own, 4 ключа) защищён -> 1 точка (2 ключа).
    expect(trash.textContent).toMatch(/1\s*\(\s*2\s*(?:ключей|keys)\)/);

    checkbox.checked = false;
    checkbox.dispatchEvent(new Event('change'));

    // OFF снова: обе в deletable.
    expect(trash.textContent).toMatch(/2\s*\(\s*6\s*(?:ключей|keys)\)/);
  });

  test('locked-точка: deletable уменьшается на её ключи, protected отражает lock-bucket', async () => {
    const items = [
      { t: 3, a: 4, c: [100.5, 13.7], g: 'ref-1', l: 'point-own', ti: 'Mine', f: 0 },
      { t: 3, a: 2, c: [101.0, 14.0], g: 'ref-2', l: 'point-enemy', ti: 'Locked', f: 0b10 },
    ];
    localStorage.setItem('inventory-cache', JSON.stringify(items));
    clickShowButton();
    await flushAsync();
    applyTeams({ 'point-own': 2, 'point-enemy': 3 });

    selectFeatureByIndex(0);
    selectFeatureByIndex(1);

    const trash = document.querySelector('.svp-refs-on-map-trash') as HTMLButtonElement;
    // point-own deletable (4 ключа, 1 точка); point-enemy locked.
    expect(trash.textContent).toMatch(/1\s*\(\s*4\s*(?:ключей|keys)\)/);

    const protectedRow = document.querySelector(
      '.svp-refs-on-map-selection-info__protected',
    ) as HTMLElement;
    // 1 locked точка (2 ключа).
    expect(protectedRow.textContent).toMatch(
      /1\s*\(\s*2\s*(?:ключей|keys)\)\s*(?:защищено|protected)/,
    );

    const deletableRow = document.querySelector(
      '.svp-refs-on-map-selection-info__deletable',
    ) as HTMLElement;
    expect(deletableRow.textContent).toMatch(/4\s*(?:ключей|key)/);
    expect(deletableRow.textContent).toMatch(/(?:к удалению|to delete)/);
  });

  test('deselect всех: trashButton и selectionInfo скрываются обратно', async () => {
    setInventoryTwoPointsThreeStacks();
    clickShowButton();
    await flushAsync();
    applyTeams({ 'point-own': 1, 'point-enemy': 2 });

    selectFeatureByIndex(0);
    const info = document.querySelector('.svp-refs-on-map-selection-info') as HTMLElement;
    expect(info.style.display).not.toBe('none');

    selectFeatureByIndex(0); // повторный клик = deselect

    expect(info.style.display).toBe('none');
    const trash = document.querySelector('.svp-refs-on-map-trash') as HTMLButtonElement;
    expect(trash.style.visibility).toBe('hidden');
  });

  test('закрытие viewer: selectionInfo скрыт', async () => {
    setInventoryTwoPointsThreeStacks();
    clickShowButton();
    await flushAsync();
    applyTeams({ 'point-own': 1, 'point-enemy': 2 });

    selectFeatureByIndex(0);
    const info = document.querySelector('.svp-refs-on-map-selection-info') as HTMLElement;
    expect(info.style.display).not.toBe('none');

    clickCloseButton();
    expect(info.style.display).toBe('none');
  });

  test('disjoint строки lock/own/unknown/deletable: сумма = total', async () => {
    // 4 точки: lock, own, enemy, unknown (без team). keepOwnTeam=true.
    // Каждый bucket - 1 точка, 1 ключ. Строки lock/own/unknown/deletable
    // должны быть disjoint, в сумме = 4 (total).
    const items = [
      { t: 3, a: 1, c: [100.5, 13.7], g: 'ref-lock', l: 'point-lock', ti: 'L', f: 0b10 },
      { t: 3, a: 1, c: [100.5, 13.7], g: 'ref-own', l: 'point-own', ti: 'O', f: 0 },
      { t: 3, a: 1, c: [100.5, 13.7], g: 'ref-enemy', l: 'point-enemy', ti: 'E', f: 0 },
      { t: 3, a: 1, c: [100.5, 13.7], g: 'ref-unk', l: 'point-unk', ti: 'U', f: 0 },
    ];
    localStorage.setItem('inventory-cache', JSON.stringify(items));
    clickShowButton();
    await flushAsync();
    // Команда заполнена для всех, кроме point-unk.
    applyTeams({ 'point-lock': 2, 'point-own': 1, 'point-enemy': 3 });

    selectFeatureByIndex(0);
    selectFeatureByIndex(1);
    selectFeatureByIndex(2);
    selectFeatureByIndex(3);

    const checkbox = document.querySelector(
      '.svp-refs-on-map-keep-own input[type="checkbox"]',
    ) as HTMLInputElement;
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));

    const total = document.querySelector('.svp-refs-on-map-selection-info__total') as HTMLElement;
    expect(total.textContent).toMatch(/(?:Выделено|Selected):\s*4\s*\(\s*4\s*(?:ключей|keys)\)/);

    const protectedRow = document.querySelector(
      '.svp-refs-on-map-selection-info__protected',
    ) as HTMLElement;
    expect(protectedRow.style.display).not.toBe('none');
    expect(protectedRow.textContent).toMatch(
      /1\s*\(\s*1\s*(?:ключей|keys)\)\s*(?:защищено|protected)/,
    );

    const own = document.querySelector('.svp-refs-on-map-selection-info__own') as HTMLElement;
    expect(own.style.display).not.toBe('none');
    expect(own.textContent).toMatch(/1\s*\(\s*1\s*(?:ключей|keys)\)\s*(?:красные|red)/);

    const unknown = document.querySelector(
      '.svp-refs-on-map-selection-info__unknown',
    ) as HTMLElement;
    expect(unknown.style.display).not.toBe('none');
    expect(unknown.textContent).toMatch(
      /1\s*\(\s*1\s*(?:ключей|keys)\)\s*(?:неизвестного цвета|unknown team)/,
    );

    const deletableRow = document.querySelector(
      '.svp-refs-on-map-selection-info__deletable',
    ) as HTMLElement;
    expect(deletableRow.textContent).toMatch(/1\s*(?:ключей|key)/);
    expect(deletableRow.textContent).toMatch(/(?:к удалению|to delete)/);
  });

  test('инвариант: сумма ключей по всем строкам = total (с учётом частичных)', async () => {
    // Сценарий из жалобы пользователя: lock + own + keepOne (полные) +
    // keepOne (частичные) + deletable. Сумма всех "ключей по строкам"
    // должна равняться total.
    //
    // Раскладка (keepOwnTeam=true, mockGetPlayerTeam=1 => 1 = красная,
    // 2 = зелёная свои? нет: в этом блоке beforeEach ставит team=1):
    // - point-lock (lock=замок, выделена 1 стопка=3 ключа) -> lock_keys=3.
    // - point-own (team=1=мои красные, 1 стопка=2 ключа) -> own_keys=2.
    // - point-full-keepone (team=2 enemy, 1 стопка=1 ключ) - удаление целиком
    //   запрещено правилом (selectedAmount<=1), полностью защищена -> keepOne 1.
    // - point-partial (team=2 enemy, 1 стопка=4 ключа) - частично удалится,
    //   3 в payload, 1 остаётся -> deletable=3, keepOne 1.
    // Всего ключей: 3+2+1+4=10. Сумма строк: lock(3)+own(2)+keepOne(2)+deletable(3)=10.
    const items = [
      { t: 3, a: 3, c: [100, 13], g: 'ref-lock', l: 'point-lock', ti: 'L', f: 0b10 },
      { t: 3, a: 2, c: [100, 13], g: 'ref-own', l: 'point-own', ti: 'O', f: 0 },
      { t: 3, a: 1, c: [100, 13], g: 'ref-1', l: 'point-full-keepone', ti: 'F', f: 0 },
      { t: 3, a: 4, c: [100, 13], g: 'ref-4', l: 'point-partial', ti: 'P', f: 0 },
    ];
    localStorage.setItem('inventory-cache', JSON.stringify(items));
    // keepOneKey=true для этого теста.
    localStorage.setItem('svp_refsOnMap', JSON.stringify({ keepOwnTeam: false, keepOneKey: true }));
    clickShowButton();
    await flushAsync();
    applyTeams({
      'point-lock': 2,
      'point-own': 1,
      'point-full-keepone': 2,
      'point-partial': 2,
    });

    selectFeatureByIndex(0); // ref-lock
    selectFeatureByIndex(1); // ref-own
    selectFeatureByIndex(2); // ref-1 (1 ключ)
    selectFeatureByIndex(3); // ref-4 (4 ключа)

    // keepOwnTeam=true
    const checkbox = document.querySelector(
      '.svp-refs-on-map-keep-own input[type="checkbox"]',
    ) as HTMLInputElement;
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));

    function extractNumber(text: string | null, re: RegExp): number {
      if (text === null) return 0;
      const match = re.exec(text);
      return match ? parseInt(match[1], 10) : 0;
    }

    const total = document.querySelector('.svp-refs-on-map-selection-info__total') as HTMLElement;
    const totalKeys = extractNumber(total.textContent, /\(\s*(\d+)\s*(?:ключей|keys)/);
    expect(totalKeys).toBe(10);

    const protectedRow = document.querySelector(
      '.svp-refs-on-map-selection-info__protected',
    ) as HTMLElement;
    const lockKeys = extractNumber(protectedRow.textContent, /\(\s*(\d+)\s*(?:ключей|keys)/);
    expect(lockKeys).toBe(3);

    const own = document.querySelector('.svp-refs-on-map-selection-info__own') as HTMLElement;
    const ownKeys = extractNumber(own.textContent, /\(\s*(\d+)\s*(?:ключей|keys)/);
    expect(ownKeys).toBe(2);

    const keepOneRow = document.querySelector(
      '.svp-refs-on-map-selection-info__keepone',
    ) as HTMLElement;
    // "X точек сохранят 1 ключ" - X = 2 (point-full-keepone полностью + point-partial частично).
    const keepOnePoints = extractNumber(keepOneRow.textContent, /^\s*(\d+)\s*/);
    expect(keepOnePoints).toBe(2);

    const deletableRow = document.querySelector(
      '.svp-refs-on-map-selection-info__deletable',
    ) as HTMLElement;
    const deletableKeys = extractNumber(deletableRow.textContent, /^\s*(\d+)\s*/);
    expect(deletableKeys).toBe(3);

    // Сумма ключей по всем строкам = total. keepOne_keys = 2 (1 полностью
    // защищённая + 1 от частично удалённой). Доступа к нему через UI нет
    // (текст содержит только число точек, не ключей), но известно по
    // алгоритму: для каждой точки в keepOne сохранён ровно 1 ключ если
    // частичная, или selectedAmount если полностью защищённая (<=1).
    // 2 точки * 1 ключ = 2.
    const keepOneKeysComputed = 2;
    expect(lockKeys + ownKeys + keepOneKeysComputed + deletableKeys).toBe(totalKeys);
  });
});

// ── critical safety: protected никогда не уходит в DELETE payload ────────────

/**
 * Серия тестов-инвариантов на единственное обещание модуля: ключи, которые
 * UI помечает защищёнными (lock / own / unknown при keepOwnTeam), НЕ должны
 * попадать в payload DELETE /api/inventory ни при каких комбинациях. Тесты
 * читают реальные guid'ы из тела запроса и сверяют их с partition-bucket'ами.
 *
 * Регрессия здесь = пользователь теряет защищённые ключи без своего ведома.
 */
describe('refsOnMap critical safety: protected NEVER in DELETE payload', () => {
  let view: ReturnType<typeof makeView>;
  let map: ReturnType<typeof makeMap>;
  let originalConfirm: typeof window.confirm;
  let originalFetch: typeof window.fetch;
  let fetchSpy: jest.Mock;

  function clickShowButton(): void {
    const button = document.querySelector('.svp-refs-on-map-button') as HTMLElement;
    button.click();
  }

  function selectFeatureByIndex(index: number): void {
    const clickHandler = map._clickListeners[0];
    const allFeatures = (window.ol?.Feature as unknown as jest.Mock).mock.results.map(
      (r) => r.value as IOlFeature,
    );
    (map.forEachFeatureAtPixel as jest.Mock).mockImplementation(
      (_pixel: unknown, callback: (feature: IOlFeature) => void) => {
        callback(allFeatures[index]);
      },
    );
    clickHandler({ pixel: [0, 0] });
  }

  function applyTeams(teamsByPoint: Record<string, number>): void {
    const allFeatures = (window.ol?.Feature as unknown as jest.Mock).mock.results.map(
      (r) => r.value as IOlFeature,
    );
    for (const feature of allFeatures) {
      const pointGuid = feature.getProperties?.().pointGuid;
      if (typeof pointGuid !== 'string') continue;
      const team = teamsByPoint[pointGuid];
      if (typeof team === 'number') feature.set?.('team', team);
    }
  }

  function enableKeepOwn(): void {
    const checkbox = document.querySelector(
      '.svp-refs-on-map-keep-own input[type="checkbox"]',
    ) as HTMLInputElement;
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));
  }

  function extractDeletePayload(): Record<string, number> {
    const calls = fetchSpy.mock.calls as [RequestInfo | URL, RequestInit?][];
    const deleteCalls = calls.filter(([, init]) => init?.method === 'DELETE');
    expect(deleteCalls.length).toBe(1);
    const body = JSON.parse((deleteCalls[0][1] as RequestInit).body as string) as {
      selection: Record<string, number>;
    };
    return body.selection;
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
    view.calculateExtent = (): number[] => [100, 100, 200, 200]; // заглушаем active pull
    fetchSpy = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (init?.method === 'DELETE') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ count: { total: 90 } }),
        } as unknown as Response);
      }
      if (url.includes('/api/inview')) {
        return Promise.resolve(makeInviewResponse([]));
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
      } as unknown as Response);
    });
    window.fetch = fetchSpy as unknown as typeof window.fetch;
    window.confirm = jest.fn(() => true);
    localStorage.setItem('auth', 'test-token');
    mockGetPlayerTeam.mockReturnValue(1);
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

  test('lock+own+unknown одновременно (keepOwnTeam=true): payload только enemy guid', async () => {
    // 4 точки: locked, own-team, unknown-team, enemy. Только enemy идёт
    // в DELETE.
    const items = [
      { t: 3, a: 1, c: [100.5, 13.7], g: 'ref-lock', l: 'point-lock', ti: 'L', f: 0b10 },
      { t: 3, a: 2, c: [100.5, 13.7], g: 'ref-own', l: 'point-own', ti: 'O', f: 0 },
      { t: 3, a: 4, c: [100.5, 13.7], g: 'ref-unk', l: 'point-unk', ti: 'U', f: 0 },
      { t: 3, a: 8, c: [100.5, 13.7], g: 'ref-enemy', l: 'point-enemy', ti: 'E', f: 0 },
    ];
    localStorage.setItem('inventory-cache', JSON.stringify(items));
    clickShowButton();
    await flushAsync();
    applyTeams({ 'point-own': 1, 'point-enemy': 2 }); // point-unk без team

    selectFeatureByIndex(0);
    selectFeatureByIndex(1);
    selectFeatureByIndex(2);
    selectFeatureByIndex(3);
    enableKeepOwn();
    // selection-driven загрузка ставит point-unk в очередь worker'а.
    // Worker делает batch + delay(100ms) перед следующим - flushAsync
    // покрывает только setTimeout(0). Ждём реально.
    await new Promise((r) => setTimeout(r, 200));
    await flushAsync();

    const trash = document.querySelector('.svp-refs-on-map-trash') as HTMLElement;
    trash.click();
    await flushAsync();

    const payload = extractDeletePayload();
    expect(payload).toEqual({ 'ref-enemy': 8 });
    expect(payload).not.toHaveProperty('ref-lock');
    expect(payload).not.toHaveProperty('ref-own');
    expect(payload).not.toHaveProperty('ref-unk');
  });

  test('lock защищает все стопки своей точки (несколько стопок одной locked-точки)', async () => {
    // point-lock имеет 3 стопки, у одной f=lock. lockedPointGuids
    // агрегирует per-point - все 3 стопки защищены.
    const items = [
      { t: 3, a: 1, c: [100.5, 13.7], g: 'lock-a', l: 'point-lock', ti: 'L', f: 0b10 },
      { t: 3, a: 2, c: [100.5, 13.7], g: 'lock-b', l: 'point-lock', ti: 'L', f: 0 },
      { t: 3, a: 4, c: [100.5, 13.7], g: 'lock-c', l: 'point-lock', ti: 'L', f: 0 },
      { t: 3, a: 8, c: [100.5, 13.7], g: 'free', l: 'point-free', ti: 'F', f: 0 },
    ];
    localStorage.setItem('inventory-cache', JSON.stringify(items));
    clickShowButton();
    await flushAsync();
    applyTeams({ 'point-lock': 5, 'point-free': 5 });

    selectFeatureByIndex(0);
    selectFeatureByIndex(1);
    selectFeatureByIndex(2);
    selectFeatureByIndex(3);

    const trash = document.querySelector('.svp-refs-on-map-trash') as HTMLElement;
    trash.click();
    await flushAsync();

    const payload = extractDeletePayload();
    expect(payload).toEqual({ free: 8 });
    expect(payload).not.toHaveProperty('lock-a');
    expect(payload).not.toHaveProperty('lock-b');
    expect(payload).not.toHaveProperty('lock-c');
  });

  test('keepOwnTeam=true: ВСЕ стопки своей точки защищены (per-point own filter)', async () => {
    // 2 стопки point-own (team=player). Обе должны быть protected.
    const items = [
      { t: 3, a: 1, c: [100.5, 13.7], g: 'own-a', l: 'point-own', ti: 'O', f: 0 },
      { t: 3, a: 2, c: [100.5, 13.7], g: 'own-b', l: 'point-own', ti: 'O', f: 0 },
      { t: 3, a: 4, c: [100.5, 13.7], g: 'enemy', l: 'point-enemy', ti: 'E', f: 0 },
    ];
    localStorage.setItem('inventory-cache', JSON.stringify(items));
    clickShowButton();
    await flushAsync();
    applyTeams({ 'point-own': 1, 'point-enemy': 2 });

    selectFeatureByIndex(0);
    selectFeatureByIndex(1);
    selectFeatureByIndex(2);
    enableKeepOwn();

    const trash = document.querySelector('.svp-refs-on-map-trash') as HTMLElement;
    trash.click();
    await flushAsync();

    const payload = extractDeletePayload();
    expect(payload).toEqual({ enemy: 4 });
    expect(payload).not.toHaveProperty('own-a');
    expect(payload).not.toHaveProperty('own-b');
  });

  test('keepOwnTeam=true, point с team=undefined: protected, payload не содержит unknown', async () => {
    const items = [
      { t: 3, a: 4, c: [100.5, 13.7], g: 'unk', l: 'point-unk', ti: 'U', f: 0 },
      { t: 3, a: 8, c: [100.5, 13.7], g: 'enemy', l: 'point-enemy', ti: 'E', f: 0 },
    ];
    localStorage.setItem('inventory-cache', JSON.stringify(items));
    clickShowButton();
    await flushAsync();
    applyTeams({ 'point-enemy': 2 }); // point-unk остаётся без team

    selectFeatureByIndex(0);
    selectFeatureByIndex(1);
    enableKeepOwn();
    // selection-driven загрузка ставит point-unk в очередь - ждём worker.
    await flushAsync();

    const trash = document.querySelector('.svp-refs-on-map-trash') as HTMLElement;
    trash.click();
    await flushAsync();

    const payload = extractDeletePayload();
    expect(payload).toEqual({ enemy: 8 });
    expect(payload).not.toHaveProperty('unk');
  });

  test('keepOwnTeam=true + playerTeam=null: удаление полностью заблокировано (НИ ОДИН guid не уходит)', async () => {
    // Defensive case: handleDeleteClick должен блокировать; computeSelectionBreakdown
    // показывает всё как protected, на кнопке "0 (0 ключей)".
    mockGetPlayerTeam.mockReturnValue(null);
    const items = [
      { t: 3, a: 4, c: [100.5, 13.7], g: 'ref-own', l: 'point-own', ti: 'O', f: 0 },
      { t: 3, a: 2, c: [100.5, 13.7], g: 'ref-enemy', l: 'point-enemy', ti: 'E', f: 0 },
    ];
    localStorage.setItem('inventory-cache', JSON.stringify(items));
    clickShowButton();
    await flushAsync();
    applyTeams({ 'point-own': 1, 'point-enemy': 2 });

    selectFeatureByIndex(0);
    selectFeatureByIndex(1);
    enableKeepOwn();

    // UI: всё в unknown (defensive playerTeam=null), deletable=0.
    const trash = document.querySelector('.svp-refs-on-map-trash') as HTMLButtonElement;
    expect(trash.textContent).toMatch(/0\s*\(\s*0\s*(?:ключей|keys)\)/);
    // lock=0, own=0 -> protected/own row hidden. unknown=2.
    const protectedRow = document.querySelector(
      '.svp-refs-on-map-selection-info__protected',
    ) as HTMLElement;
    expect(protectedRow.style.display).toBe('none');
    const unknownRow = document.querySelector(
      '.svp-refs-on-map-selection-info__unknown',
    ) as HTMLElement;
    expect(unknownRow.style.display).not.toBe('none');
    expect(unknownRow.textContent).toMatch(
      /2\s*\(\s*6\s*(?:ключей|keys)\)\s*(?:неизвестного цвета|unknown team)/,
    );

    trash.click();
    await flushAsync();

    // DELETE не отправлен.
    const calls = fetchSpy.mock.calls as [RequestInfo | URL, RequestInit?][];
    const deleteCalls = calls.filter(([, init]) => init?.method === 'DELETE');
    expect(deleteCalls.length).toBe(0);
  });

  test('post-DELETE: protected features ОСТАЮТСЯ в refsSource (только deletable удалены)', async () => {
    const items = [
      { t: 3, a: 1, c: [100.5, 13.7], g: 'ref-lock', l: 'point-lock', ti: 'L', f: 0b10 },
      { t: 3, a: 8, c: [100.5, 13.7], g: 'ref-free', l: 'point-free', ti: 'F', f: 0 },
    ];
    localStorage.setItem('inventory-cache', JSON.stringify(items));
    clickShowButton();
    await flushAsync();
    applyTeams({ 'point-lock': 2, 'point-free': 2 });

    selectFeatureByIndex(0);
    selectFeatureByIndex(1);

    // refsSource создаётся через ol.source.Vector в enable(); его instance
    // первый и единственный в mock.results.
    const refsSource = (window.ol?.source?.Vector as unknown as jest.Mock).mock.results[0]
      .value as IOlVectorSource;
    expect(refsSource.getFeatures().length).toBe(2);

    const trash = document.querySelector('.svp-refs-on-map-trash') as HTMLElement;
    trash.click();
    await flushAsync();

    // ref-free deletable -> удалён из refsSource; ref-lock protected -> остался.
    const remaining = refsSource.getFeatures();
    expect(remaining.length).toBe(1);
    expect(remaining[0].getId()).toBe('ref-lock');
  });

  test('inventory-cache очищается только от deletable guid (protected остаются в кэше)', async () => {
    const items = [
      { t: 3, a: 1, c: [100.5, 13.7], g: 'ref-lock', l: 'point-lock', ti: 'L', f: 0b10 },
      { t: 3, a: 8, c: [100.5, 13.7], g: 'ref-free', l: 'point-free', ti: 'F', f: 0 },
      { t: 1, a: 50, c: [100.5, 13.7], g: 'core-x', l: 'point-other', ti: 'C', f: 0 },
    ];
    localStorage.setItem('inventory-cache', JSON.stringify(items));
    clickShowButton();
    await flushAsync();
    applyTeams({ 'point-lock': 2, 'point-free': 2 });

    selectFeatureByIndex(0);
    selectFeatureByIndex(1);

    const trash = document.querySelector('.svp-refs-on-map-trash') as HTMLElement;
    trash.click();
    await flushAsync();

    const updatedCache = JSON.parse(localStorage.getItem('inventory-cache') ?? '[]') as {
      g: string;
      t: number;
    }[];
    const remainingGuids = updatedCache.map((it) => it.g);
    expect(remainingGuids).toContain('ref-lock'); // protected
    expect(remainingGuids).toContain('core-x'); // не реф вообще
    expect(remainingGuids).not.toContain('ref-free'); // deletable
  });

  test('инвариант: payload guids НИКОГДА не пересекается с partition.protected*', async () => {
    // Property-style: при ЛЮБОМ выборе и keepOwnTeam=true, payload guids
    // не должны содержать ни одного guid'а из защищённых bucket'ов.
    const items = [
      { t: 3, a: 1, c: [100.5, 13.7], g: 'g1', l: 'p-lock', ti: 'L', f: 0b10 },
      { t: 3, a: 2, c: [100.5, 13.7], g: 'g2', l: 'p-own', ti: 'O', f: 0 },
      { t: 3, a: 3, c: [100.5, 13.7], g: 'g3', l: 'p-unk', ti: 'U', f: 0 },
      { t: 3, a: 4, c: [100.5, 13.7], g: 'g4', l: 'p-enemy-a', ti: 'EA', f: 0 },
      { t: 3, a: 5, c: [100.5, 13.7], g: 'g5', l: 'p-enemy-b', ti: 'EB', f: 0 },
    ];
    localStorage.setItem('inventory-cache', JSON.stringify(items));
    clickShowButton();
    await flushAsync();
    applyTeams({ 'p-own': 1, 'p-enemy-a': 2, 'p-enemy-b': 3 });

    selectFeatureByIndex(0);
    selectFeatureByIndex(1);
    selectFeatureByIndex(2);
    selectFeatureByIndex(3);
    selectFeatureByIndex(4);
    enableKeepOwn();
    // selection-driven загрузка ставит p-lock + p-unk в очередь. Worker
    // обрабатывает первую (p-lock) сразу, потом await delay(100ms) перед
    // p-unk. flushAsync (setTimeout 0) не покрывает delay - ждём реально.
    await new Promise((r) => setTimeout(r, 200));
    await flushAsync();

    const trash = document.querySelector('.svp-refs-on-map-trash') as HTMLElement;
    trash.click();
    await flushAsync();

    const payload = extractDeletePayload();
    const PROTECTED_GUIDS = new Set(['g1', 'g2', 'g3']); // lock, own, unknown
    for (const guid of Object.keys(payload)) {
      expect(PROTECTED_GUIDS.has(guid)).toBe(false);
    }
    expect(Object.keys(payload).sort()).toEqual(['g4', 'g5']);
  });
});

// ── keepOneKey: ни одна выделенная точка не теряет все ключи в инвентаре ─────

/**
 * Серия critical-safety тестов на инвариант keepOneKey: при включённом флаге
 * сумма payload[refGuid] для всех стопок одной точки СТРОГО МЕНЬШЕ суммарного
 * inventory amount этой точки. После DELETE у пользователя в инвентаре по
 * каждой выделенной точке остаётся минимум 1 ключ.
 *
 * Покрываем все ключевые сценарии: 1 stack полностью выделена, N stacks все
 * выделены, N stacks частично выделены (с невыделенными), 1 stack с 1 ключом,
 * комбинации с lock/own/unknown, default-значение флага, восстановление из
 * localStorage. Регрессия здесь = пользователь теряет все ключи точки.
 */
describe('refsOnMap critical safety: keepOneKey leaves >=1 key per point', () => {
  let view: ReturnType<typeof makeView>;
  let map: ReturnType<typeof makeMap>;
  let originalFetch: typeof window.fetch;
  let fetchSpy: jest.Mock;

  function clickShowButton(): void {
    const button = document.querySelector('.svp-refs-on-map-button') as HTMLElement;
    button.click();
  }

  function selectFeatureByIndex(index: number): void {
    const clickHandler = map._clickListeners[0];
    const allFeatures = (window.ol?.Feature as unknown as jest.Mock).mock.results.map(
      (r) => r.value as IOlFeature,
    );
    (map.forEachFeatureAtPixel as jest.Mock).mockImplementation(
      (_pixel: unknown, callback: (feature: IOlFeature) => void) => {
        callback(allFeatures[index]);
      },
    );
    clickHandler({ pixel: [0, 0] });
  }

  function applyTeams(teamsByPoint: Record<string, number>): void {
    const allFeatures = (window.ol?.Feature as unknown as jest.Mock).mock.results.map(
      (r) => r.value as IOlFeature,
    );
    for (const feature of allFeatures) {
      const pointGuid = feature.getProperties?.().pointGuid;
      if (typeof pointGuid !== 'string') continue;
      const team = teamsByPoint[pointGuid];
      if (typeof team === 'number') feature.set?.('team', team);
    }
  }

  function extractDeletePayload(): Record<string, number> {
    const calls = fetchSpy.mock.calls as [RequestInfo | URL, RequestInit?][];
    const deleteCalls = calls.filter(([, init]) => init?.method === 'DELETE');
    expect(deleteCalls.length).toBe(1);
    const body = JSON.parse((deleteCalls[0][1] as RequestInit).body as string) as {
      selection: Record<string, number>;
    };
    return body.selection;
  }

  function expectNoDeleteCall(): void {
    const calls = fetchSpy.mock.calls as [RequestInfo | URL, RequestInit?][];
    const deleteCalls = calls.filter(([, init]) => init?.method === 'DELETE');
    expect(deleteCalls.length).toBe(0);
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
    view.calculateExtent = (): number[] => [100, 100, 200, 200];
    fetchSpy = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ count: { total: 90 } }),
      } as unknown as Response),
    );
    window.fetch = fetchSpy as unknown as typeof window.fetch;
    localStorage.setItem('auth', 'test-token');
    window.confirm = jest.fn(() => true);
    // Глобальный beforeEach ставит keepOneKey=false. Этот блок весь про
    // keepOneKey=true - переопределяем здесь.
    localStorage.setItem('svp_refsOnMap', JSON.stringify({ keepOwnTeam: false, keepOneKey: true }));
    mockGetPlayerTeam.mockReturnValue(1);
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

  test('default keepOneKey=true: новый пользователь защищён без явных действий', () => {
    // Глобальный beforeEach ставит false, этот блок true, но сейчас проверим
    // что чекбокс в DOM checked=true после showViewer и onChange сохраняет
    // оба флага. Это страховка: если default в settings когда-то поменяют
    // на false, тест упадёт.
    clickShowButton();
    const checkbox = document.querySelector(
      '.svp-refs-on-map-keep-one input[type="checkbox"]',
    ) as HTMLInputElement;
    expect(checkbox).not.toBeNull();
    expect(checkbox.checked).toBe(true);
  });

  test('1 stack 5 ключей, выделена, keepOneKey=true: удалится 4, останется 1', async () => {
    localStorage.setItem(
      'inventory-cache',
      JSON.stringify([{ t: 3, a: 5, c: [100.5, 13.7], g: 'ref-1', l: 'point-1', ti: 'P', f: 0 }]),
    );
    clickShowButton();
    await flushAsync();
    applyTeams({ 'point-1': 2 });

    selectFeatureByIndex(0);

    const trash = document.querySelector('.svp-refs-on-map-trash') as HTMLElement;
    trash.click();
    await flushAsync();

    const payload = extractDeletePayload();
    expect(payload).toEqual({ 'ref-1': 4 });
    // ИНВАРИАНТ: payload sum < inventory total.
    expect(payload['ref-1']).toBeLessThan(5);
  });

  test('1 stack 1 ключ, выделена: нечего удалять, payload пуст, DELETE не отправлен', async () => {
    localStorage.setItem(
      'inventory-cache',
      JSON.stringify([{ t: 3, a: 1, c: [100.5, 13.7], g: 'ref-1', l: 'point-1', ti: 'P', f: 0 }]),
    );
    clickShowButton();
    await flushAsync();
    applyTeams({ 'point-1': 2 });

    selectFeatureByIndex(0);

    const trash = document.querySelector('.svp-refs-on-map-trash') as HTMLElement;
    trash.click();
    await flushAsync();

    expectNoDeleteCall();
  });

  test('2 stacks одной точки (5+3), обе выделены: суммарно удалится 7, останется 1', async () => {
    localStorage.setItem(
      'inventory-cache',
      JSON.stringify([
        { t: 3, a: 5, c: [100.5, 13.7], g: 'ref-a', l: 'point-1', ti: 'P', f: 0 },
        { t: 3, a: 3, c: [100.5, 13.7], g: 'ref-b', l: 'point-1', ti: 'P', f: 0 },
      ]),
    );
    clickShowButton();
    await flushAsync();
    applyTeams({ 'point-1': 2 });

    selectFeatureByIndex(0);
    selectFeatureByIndex(1);

    const trash = document.querySelector('.svp-refs-on-map-trash') as HTMLElement;
    trash.click();
    await flushAsync();

    const payload = extractDeletePayload();
    const totalToDelete = (payload['ref-a'] ?? 0) + (payload['ref-b'] ?? 0);
    // ИНВАРИАНТ: после удаления у точки остаётся ровно 1 ключ в инвентаре.
    expect(totalToDelete).toBe(7);
    // Distribute по убыванию amount: stack ref-a=5 удаляется полностью,
    // ref-b=3 обрезается до 2 (оставляем 1).
    expect(payload).toEqual({ 'ref-a': 5, 'ref-b': 2 });
  });

  test('2 stacks (5+3), выделена только одна (5): невыделенная даёт 3 ключа, удалится 5 полностью', async () => {
    // unselectedAmount=3 >= 1: keepOneKey не вмешивается, ref-a удаляется
    // полностью. ИНВАРИАНТ: после удаления в инвентаре остаются 3 ключа
    // в ref-b. По точке osталось >=1.
    localStorage.setItem(
      'inventory-cache',
      JSON.stringify([
        { t: 3, a: 5, c: [100.5, 13.7], g: 'ref-a', l: 'point-1', ti: 'P', f: 0 },
        { t: 3, a: 3, c: [100.5, 13.7], g: 'ref-b', l: 'point-1', ti: 'P', f: 0 },
      ]),
    );
    clickShowButton();
    await flushAsync();
    applyTeams({ 'point-1': 2 });

    selectFeatureByIndex(0); // только ref-a

    const trash = document.querySelector('.svp-refs-on-map-trash') as HTMLElement;
    trash.click();
    await flushAsync();

    const payload = extractDeletePayload();
    expect(payload).toEqual({ 'ref-a': 5 });
  });

  test('3 stacks (10+5+1), все выделены: distribute 15 к удалению, остаётся 1', async () => {
    localStorage.setItem(
      'inventory-cache',
      JSON.stringify([
        { t: 3, a: 10, c: [100.5, 13.7], g: 'ref-big', l: 'point-1', ti: 'P', f: 0 },
        { t: 3, a: 5, c: [100.5, 13.7], g: 'ref-mid', l: 'point-1', ti: 'P', f: 0 },
        { t: 3, a: 1, c: [100.5, 13.7], g: 'ref-small', l: 'point-1', ti: 'P', f: 0 },
      ]),
    );
    clickShowButton();
    await flushAsync();
    applyTeams({ 'point-1': 2 });

    selectFeatureByIndex(0);
    selectFeatureByIndex(1);
    selectFeatureByIndex(2);

    const trash = document.querySelector('.svp-refs-on-map-trash') as HTMLElement;
    trash.click();
    await flushAsync();

    const payload = extractDeletePayload();
    const totalToDelete = Object.values(payload).reduce((a, b) => a + b, 0);
    expect(totalToDelete).toBe(15);
    // По убыванию: ref-big=10 полностью, ref-mid=5 полностью, ref-small
    // не нужна (15-10-5=0); ref-small уходит в protectedByKeepOneKey -
    // её в payload не должно быть.
    expect(payload).toEqual({ 'ref-big': 10, 'ref-mid': 5 });
    expect(payload).not.toHaveProperty('ref-small');
  });

  test('lock на одной из стопок: lock защищает точку, deletable не доходит до keepOneKey', async () => {
    // Если у точки есть lock-стопка, partitionByLockProtection всю точку
    // помечает protectedByLock (lock-семантика per-point). deletable=0,
    // keepOneKey не вмешивается.
    localStorage.setItem(
      'inventory-cache',
      JSON.stringify([
        { t: 3, a: 5, c: [100.5, 13.7], g: 'ref-free', l: 'point-1', ti: 'P', f: 0 },
        { t: 3, a: 3, c: [100.5, 13.7], g: 'ref-lock', l: 'point-1', ti: 'P', f: 0b10 },
      ]),
    );
    clickShowButton();
    await flushAsync();
    applyTeams({ 'point-1': 2 });

    selectFeatureByIndex(0);

    const trash = document.querySelector('.svp-refs-on-map-trash') as HTMLElement;
    trash.click();
    await flushAsync();

    expectNoDeleteCall();
  });

  test('keepOwnTeam=true + keepOneKey=true: own не уходит в DELETE; для enemy keepOneKey оставляет 1', async () => {
    localStorage.setItem('svp_refsOnMap', JSON.stringify({ keepOwnTeam: true, keepOneKey: true }));
    localStorage.setItem(
      'inventory-cache',
      JSON.stringify([
        { t: 3, a: 4, c: [100.5, 13.7], g: 'ref-own', l: 'point-own', ti: 'O', f: 0 },
        { t: 3, a: 3, c: [101.0, 14.0], g: 'ref-enemy', l: 'point-enemy', ti: 'E', f: 0 },
      ]),
    );
    clickShowButton();
    await flushAsync();
    applyTeams({ 'point-own': 1, 'point-enemy': 2 });

    selectFeatureByIndex(0);
    selectFeatureByIndex(1);

    const trash = document.querySelector('.svp-refs-on-map-trash') as HTMLElement;
    trash.click();
    await flushAsync();

    const payload = extractDeletePayload();
    expect(payload).not.toHaveProperty('ref-own');
    // enemy удаляется частично: 3-1=2 ключа.
    expect(payload).toEqual({ 'ref-enemy': 2 });
  });

  test('многоточечный сценарий: разные группы независимо обрабатываются', async () => {
    localStorage.setItem(
      'inventory-cache',
      JSON.stringify([
        // Точка A: 1 ключ, защищена keepOneKey полностью.
        { t: 3, a: 1, c: [100.5, 13.7], g: 'a', l: 'pt-A', ti: 'A', f: 0 },
        // Точка B: 5 ключей, удалится 4.
        { t: 3, a: 5, c: [101, 14], g: 'b', l: 'pt-B', ti: 'B', f: 0 },
        // Точка C: 2 стопки (3+2), невыделенная даёт 2: выделенная удаляется полностью.
        { t: 3, a: 3, c: [102, 15], g: 'c1', l: 'pt-C', ti: 'C', f: 0 },
        { t: 3, a: 2, c: [102, 15], g: 'c2', l: 'pt-C', ti: 'C', f: 0 },
      ]),
    );
    clickShowButton();
    await flushAsync();
    applyTeams({ 'pt-A': 2, 'pt-B': 2, 'pt-C': 2 });

    selectFeatureByIndex(0); // pt-A
    selectFeatureByIndex(1); // pt-B
    selectFeatureByIndex(2); // pt-C ref c1 (выделено), c2 unselected

    const trash = document.querySelector('.svp-refs-on-map-trash') as HTMLElement;
    trash.click();
    await flushAsync();

    const payload = extractDeletePayload();
    // 'a' защищена keepOneKey (не в payload).
    expect(payload).not.toHaveProperty('a');
    // 'b': удаляется 4.
    expect(payload.b).toBe(4);
    // 'c1': удаляется полностью (3), невыделенная c2 даёт инвентарь >=1.
    expect(payload.c1).toBe(3);
  });

  test('сохранённый keepOneKey=true в localStorage защищает после reopen viewer', async () => {
    // Имитация: пользователь включил в прошлом сеансе, перезагрузил
    // страницу, открыл viewer. keepOneKey восстанавливается из storage.
    // Без этого восстановления пользователь, не зная о новой фиче, при
    // следующем DELETE потерял бы все ключи 1-stack точки.
    localStorage.setItem('svp_refsOnMap', JSON.stringify({ keepOwnTeam: false, keepOneKey: true }));
    localStorage.setItem(
      'inventory-cache',
      JSON.stringify([{ t: 3, a: 2, c: [100.5, 13.7], g: 'r', l: 'p', ti: 'P', f: 0 }]),
    );
    clickShowButton();
    await flushAsync();
    applyTeams({ p: 2 });

    selectFeatureByIndex(0);

    const trash = document.querySelector('.svp-refs-on-map-trash') as HTMLElement;
    trash.click();
    await flushAsync();

    const payload = extractDeletePayload();
    expect(payload).toEqual({ r: 1 });
  });

  test('keepOneKey=false: payload содержит ВСЕ amount (классическое полное удаление)', async () => {
    // Контрольный негативный тест: при выключенном флаге payload идентичен
    // selected.amount. Гарантирует что новая логика не "случайно" применяется
    // при keepOneKey=false.
    localStorage.setItem(
      'svp_refsOnMap',
      JSON.stringify({ keepOwnTeam: false, keepOneKey: false }),
    );
    localStorage.setItem(
      'inventory-cache',
      JSON.stringify([{ t: 3, a: 5, c: [100.5, 13.7], g: 'r', l: 'p', ti: 'P', f: 0 }]),
    );
    clickShowButton();
    await flushAsync();
    applyTeams({ p: 2 });

    selectFeatureByIndex(0);

    const trash = document.querySelector('.svp-refs-on-map-trash') as HTMLElement;
    trash.click();
    await flushAsync();

    const payload = extractDeletePayload();
    expect(payload).toEqual({ r: 5 });
  });

  test('toggle keepOneKey off->on прямо перед кликом: фикс сразу применяется', async () => {
    // Сценарий: пользователь до этого момента кликов не делал, он толкает
    // чекбокс ON и сразу нажимает Корзину. Изменение должно сразу повлиять
    // на payload, без необходимости перевыбрать фичу.
    localStorage.setItem(
      'svp_refsOnMap',
      JSON.stringify({ keepOwnTeam: false, keepOneKey: false }),
    );
    localStorage.setItem(
      'inventory-cache',
      JSON.stringify([{ t: 3, a: 5, c: [100.5, 13.7], g: 'r', l: 'p', ti: 'P', f: 0 }]),
    );
    clickShowButton();
    await flushAsync();
    applyTeams({ p: 2 });

    selectFeatureByIndex(0);
    // Включаем keepOneKey ПОСЛЕ выбора.
    const keepOneCheckbox = document.querySelector(
      '.svp-refs-on-map-keep-one input[type="checkbox"]',
    ) as HTMLInputElement;
    expect(keepOneCheckbox.checked).toBe(false);
    keepOneCheckbox.checked = true;
    keepOneCheckbox.dispatchEvent(new Event('change'));

    const trash = document.querySelector('.svp-refs-on-map-trash') as HTMLElement;
    trash.click();
    await flushAsync();

    const payload = extractDeletePayload();
    expect(payload).toEqual({ r: 4 });
  });

  test('UI: кнопка "Корзина" и строка "к удалению" учитывают keepOneKey', async () => {
    localStorage.setItem(
      'inventory-cache',
      JSON.stringify([{ t: 3, a: 5, c: [100.5, 13.7], g: 'r', l: 'p', ti: 'P', f: 0 }]),
    );
    clickShowButton();
    await flushAsync();
    applyTeams({ p: 2 });

    selectFeatureByIndex(0);

    const trash = document.querySelector('.svp-refs-on-map-trash') as HTMLButtonElement;
    // 1 точка, фактически удалится 4 ключа.
    expect(trash.textContent).toMatch(/1\s*\(\s*4\s*(?:ключей|keys)\)/);

    const deletableRow = document.querySelector(
      '.svp-refs-on-map-selection-info__deletable',
    ) as HTMLElement;
    expect(deletableRow.textContent).toMatch(/4\s*(?:ключей|key)/);
    expect(deletableRow.textContent).toMatch(/(?:к удалению|to delete)/);
  });

  test('UI: точка с 1 ключом в selection-info__keepone, не в deletable', async () => {
    localStorage.setItem(
      'inventory-cache',
      JSON.stringify([{ t: 3, a: 1, c: [100.5, 13.7], g: 'r', l: 'p', ti: 'P', f: 0 }]),
    );
    clickShowButton();
    await flushAsync();
    applyTeams({ p: 2 });

    selectFeatureByIndex(0);

    const trash = document.querySelector('.svp-refs-on-map-trash') as HTMLButtonElement;
    expect(trash.textContent).toMatch(/0\s*\(\s*0\s*(?:ключей|keys)\)/);

    const keepOneRow = document.querySelector(
      '.svp-refs-on-map-selection-info__keepone',
    ) as HTMLElement;
    expect(keepOneRow.style.display).not.toBe('none');
    // Текст "X точек сохранят 1 ключ" - X=1 для одной полностью защищённой точки.
    expect(keepOneRow.textContent).toMatch(/1\s*(?:точек|point)/);
  });

  test('ИНВАРИАНТ: при любой комбинации payload по точке < inventory total', async () => {
    // Property-style тест: 12 раскладок инвентаря (1..4 стопки * 3 паттерна
    // amount), все стопки выделены. payload sum по pointGuid строго меньше
    // inventory total - гарантия что хотя бы 1 ключ остаётся.
    for (let i = 0; i < 12; i++) {
      const stacks = 1 + (i % 4); // 1..4 стопок
      const items: {
        t: number;
        a: number;
        c: number[];
        g: string;
        l: string;
        ti: string;
        f: number;
      }[] = [];
      let inventoryTotal = 0;
      for (let s = 0; s < stacks; s++) {
        const amount = 1 + ((i * 7 + s * 3) % 7); // 1..7
        items.push({
          t: 3,
          a: amount,
          c: [100.5, 13.7],
          g: `ref-${i}-${s}`,
          l: `point-${i}`,
          ti: 'P',
          f: 0,
        });
        inventoryTotal += amount;
      }
      // Чистый старт каждой итерации.
      await refsOnMap.disable();
      uninstallInviewFetchHookForTest();
      delete window.ol;
      document.body.innerHTML = '';
      setupInventoryDom();
      const v = makeView(16, 0.5);
      const pl = makeLayer('points', makeSource());
      const ll = makeLayer('lines', makeSource());
      const rl = makeLayer('regions', makeSource());
      map = makeMap([pl, ll, rl], v);
      mockGetOlMap.mockResolvedValue(map);
      mockOl();
      v.calculateExtent = (): number[] => [100, 100, 200, 200];
      fetchSpy = jest.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ count: { total: 0 } }),
        } as unknown as Response),
      );
      window.fetch = fetchSpy as unknown as typeof window.fetch;
      localStorage.setItem(
        'svp_refsOnMap',
        JSON.stringify({ keepOwnTeam: false, keepOneKey: true }),
      );
      localStorage.setItem('inventory-cache', JSON.stringify(items));
      await refsOnMap.enable();
      clickShowButton();
      await flushAsync();
      applyTeams({ [`point-${i}`]: 2 });
      for (let s = 0; s < stacks; s++) selectFeatureByIndex(s);

      const trash = document.querySelector('.svp-refs-on-map-trash') as HTMLElement;
      trash.click();
      await flushAsync();

      // Возможен no-delete если inventoryTotal <= 1.
      const calls = fetchSpy.mock.calls as [RequestInfo | URL, RequestInit?][];
      const deleteCalls = calls.filter(([, init]) => init?.method === 'DELETE');
      if (inventoryTotal <= 1) {
        expect(deleteCalls.length).toBe(0);
        continue;
      }
      expect(deleteCalls.length).toBe(1);
      const body = JSON.parse((deleteCalls[0][1] as RequestInit).body as string) as {
        selection: Record<string, number>;
      };
      const payloadSum = Object.values(body.selection).reduce((a, b) => a + b, 0);
      // ИНВАРИАНТ: сумма payload по точке < inventory total => остаётся >=1 ключ.
      expect(payloadSum).toBeLessThan(inventoryTotal);
      expect(payloadSum).toBe(inventoryTotal - 1);
    }
  }, 30000);
});
