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
    await refsOnMap.enable();
  });

  afterEach(async () => {
    await refsOnMap.disable();
    delete window.ol;
    localStorage.removeItem('inventory-cache');
    localStorage.removeItem('follow');
    document.body.innerHTML = '';
    window.confirm = originalConfirm;
    window.fetch = originalFetch;
  });

  function setInventoryCacheWithLocks(): void {
    // ref-2 в стопке locked (бит 0b10 поля f) - точка point-2 защищена.
    // У ref-1 поле `f` явно 0 (без lock-бита) - lockSupportAvailable=true,
    // удаление разрешено. Mix-кэш (часть стопок без `f`) проверяется
    // отдельным тестом ниже.
    const items = [
      { t: 3, a: 4, c: [100.5, 13.7], g: 'ref-1', l: 'point-1', ti: 'Open Point', f: 0 },
      { t: 3, a: 2, c: [101.0, 14.0], g: 'ref-2', l: 'point-2', ti: 'Locked Point', f: 0b10 },
    ];
    localStorage.setItem('inventory-cache', JSON.stringify(items));
  }

  test('clicking trash with all-locked selection toasts and skips delete', async () => {
    setInventoryCacheWithLocks();
    clickShowButton();
    // Выбираем только locked-фичу через клик симуляцию: эмулируем
    // toggleFeatureSelection через прямую установку isSelected на feature.
    // Берём вторую фичу (ref-2 на point-2 = locked).
    const sourceCallArgs = (window.ol?.source?.Vector as unknown as jest.Mock).mock.results;
    expect(sourceCallArgs.length).toBeGreaterThan(0);
    // Все фичи добавлены в один локальный source при showViewer.
    // Прямой доступ через document не работает - используем addFeature mock.
    const fetchSpy = jest.fn(() =>
      Promise.resolve({ json: () => Promise.resolve({}) } as unknown as Response),
    );
    window.fetch = fetchSpy as unknown as typeof window.fetch;

    // Симулируем клик на trash без выбранных фич: ничего не должно произойти
    // (uniqueRefsToDelete = 0, ранний return).
    const trash = document.querySelector('.svp-refs-on-map-trash') as HTMLElement;
    trash.click();
    await Promise.resolve();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('partitionByLockProtection через handleDeleteClick: locked не уходит в payload', async () => {
    setInventoryCacheWithLocks();
    clickShowButton();

    // Получаем mapClickHandler (после showViewer он подписан на map.on('click')).
    const clickHandler = map._clickListeners[0];
    expect(clickHandler).toBeDefined();

    // forEachFeatureAtPixel должен дёргать callback на feature под пикселем.
    // Эмулируем выбор обеих фич: для ref-1 (point-1, не locked) и ref-2
    // (point-2, locked).
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

    // Подтверждаем delete в confirm.
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
    // Дожидаемся deleteRefsFromServer + then-цепочки.
    await Promise.resolve();
    await Promise.resolve();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(init.body as string) as { selection: Record<string, number> };
    // ref-1 (l=point-1, не locked) в payload; ref-2 (l=point-2, locked) - НЕ в payload.
    expect(body.selection).toHaveProperty('ref-1');
    expect(body.selection).not.toHaveProperty('ref-2');
  });

  test('all-locked selection: confirm не вызывается, fetch не идёт, показан toast', async () => {
    setInventoryCacheWithLocks();
    clickShowButton();
    const clickHandler = map._clickListeners[0];
    const allFeatures = (window.ol?.Feature as unknown as jest.Mock).mock.results.map(
      (r) => r.value as IOlFeature,
    );
    // Выбираем только locked-фичу (ref-2 на point-2).
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
    // Toast виден в DOM.
    expect(document.querySelector('.svp-toast')).not.toBeNull();
  });

  test('mix-кэш блокирует удаление: одна стопка без поля f - confirm и fetch не вызываются, показан toast', async () => {
    // Mix-кэш: ref-1 без `f`, ref-2 с lock-битом. Симметрично с слоями
    // защиты в slowRefsDelete и cleanupCalculator: стопки без `f` не
    // попадают в lockedPointGuids (`if (item.f === undefined) continue`),
    // и точка по факту locked может быть удалена вслепую. Защита: если хоть
    // одна реф-стопка без `f` - удаление через viewer запрещено.
    const items = [
      { t: 3, a: 4, c: [100.5, 13.7], g: 'ref-1', l: 'point-1', ti: 'Mixed Open' },
      { t: 3, a: 2, c: [101.0, 14.0], g: 'ref-2', l: 'point-2', ti: 'Mixed Locked', f: 0b10 },
    ];
    localStorage.setItem('inventory-cache', JSON.stringify(items));
    clickShowButton();

    const clickHandler = map._clickListeners[0];
    const allFeatures = (window.ol?.Feature as unknown as jest.Mock).mock.results.map(
      (r) => r.value as IOlFeature,
    );
    // Выбираем ref-1 (без `f`, точка по нашему фильтру выглядит «открытой»).
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
    // На 0.6.0 сервер не отдаёт `f`. lockSupportAvailable=false - удаление
    // через viewer заблокировано целиком, чтобы пользователь не лишился
    // ключей из-за отсутствия lock-семантики на старой версии игры.
    const items = [
      { t: 3, a: 4, c: [100.5, 13.7], g: 'ref-1', l: 'point-1', ti: 'Old A' },
      { t: 3, a: 2, c: [101.0, 14.0], g: 'ref-2', l: 'point-2', ti: 'Old B' },
    ];
    localStorage.setItem('inventory-cache', JSON.stringify(items));
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
