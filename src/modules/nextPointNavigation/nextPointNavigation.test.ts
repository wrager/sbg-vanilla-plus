import {
  findFeaturesInRange,
  findNearestInRange,
  getGeodeticDistance,
  nextPointNavigation,
} from './nextPointNavigation';
import type { IOlFeature, IOlLayer, IOlMap, IOlVectorSource, IOlView } from '../../core/olMap';

// ── OL mocks ────────────────────────────────────────────────────────────────

function mockLineStringLength(coordsA: number[], coordsB: number[]): number {
  const dx = coordsA[0] - coordsB[0];
  const dy = coordsA[1] - coordsB[1];
  return Math.sqrt(dx * dx + dy * dy);
}

function makeView(zoom = 17): IOlView {
  let currentZoom = zoom;
  return {
    padding: [0, 0, 0, 0],
    getCenter: () => [0, 0],
    setCenter: jest.fn(),
    calculateExtent: () => [0, 0, 0, 0],
    changed: () => {},
    getRotation: () => 0,
    setRotation: () => {},
    getZoom: () => currentZoom,
    setZoom: jest.fn((z: number) => {
      currentZoom = z;
    }),
  };
}

beforeAll(() => {
  window.ol = {
    Map: { prototype: { getView: makeView } },
    geom: {
      LineString: class {
        private coords: number[][];
        constructor(coords: number[][]) {
          this.coords = coords;
        }
        getCoordinates() {
          return this.coords;
        }
      },
    },
    sphere: {
      getLength: (geometry: { getCoordinates(): number[][] }) => {
        const coords = geometry.getCoordinates();
        return mockLineStringLength(coords[0], coords[1]);
      },
    },
  };
});

afterAll(() => {
  window.ol = undefined;
});

// ── helpers ──────────────────────────────────────────────────────────────────

function makeFeature(id: string, coords: number[]): IOlFeature {
  return {
    getGeometry: () => ({ getCoordinates: () => coords }),
    getId: () => id,
    setId: jest.fn(),
    setStyle: jest.fn(),
  };
}

function makeSource(features: IOlFeature[] = []): IOlVectorSource {
  const listeners = new Map<string, (() => void)[]>();
  return {
    getFeatures: () => features,
    addFeature: jest.fn(),
    clear: jest.fn(),
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

function makeLayer(name: string, source: IOlVectorSource | null): IOlLayer {
  return {
    get: (key: string) => (key === 'name' ? name : undefined),
    getSource: () => source,
  };
}

function makeMapWithDispatch(
  layers: IOlLayer[],
  view: IOlView,
): IOlMap & { dispatchEvent: jest.Mock; getPixelFromCoordinate: jest.Mock } {
  return {
    getView: () => view,
    getSize: () => [800, 600],
    getLayers: () => ({ getArray: () => layers }),
    getInteractions: () => ({ getArray: () => [] }),
    addLayer: jest.fn(),
    removeLayer: jest.fn(),
    updateSize: jest.fn(),
    dispatchEvent: jest.fn(),
    getPixelFromCoordinate: jest.fn().mockReturnValue([100, 200]),
  };
}

// ── getGeodeticDistance ──────────────────────────────────────────────────────

describe('getGeodeticDistance', () => {
  test('returns distance between two points', () => {
    const distance = getGeodeticDistance([0, 0], [3, 4]);
    expect(distance).toBeCloseTo(5);
  });

  test('returns 0 for same point', () => {
    expect(getGeodeticDistance([10, 20], [10, 20])).toBe(0);
  });

  test('returns Infinity when ol is not available', () => {
    const originalOl = window.ol;
    window.ol = undefined;
    expect(getGeodeticDistance([0, 0], [1, 1])).toBe(Infinity);
    window.ol = originalOl;
  });
});

// ── findFeaturesInRange ─────────────────────────────────────────────────────

describe('findFeaturesInRange', () => {
  test('returns features within radius', () => {
    const features = [
      makeFeature('near', [1, 1]),
      makeFeature('far', [100, 100]),
      makeFeature('mid', [3, 4]),
    ];
    const result = findFeaturesInRange([0, 0], features, 10);
    const ids = result.map((feature) => feature.getId());
    expect(ids).toContain('near');
    expect(ids).toContain('mid');
    expect(ids).not.toContain('far');
  });

  test('returns empty array when no features in range', () => {
    const features = [makeFeature('far', [100, 100])];
    expect(findFeaturesInRange([0, 0], features, 5)).toHaveLength(0);
  });

  test('skips features without id', () => {
    const noId: IOlFeature = {
      getGeometry: () => ({ getCoordinates: () => [1, 1] }),
      getId: () => undefined,
      setId: jest.fn(),
      setStyle: jest.fn(),
    };
    expect(findFeaturesInRange([0, 0], [noId], 10)).toHaveLength(0);
  });
});

// ── findNearestInRange ──────────────────────────────────────────────────────

describe('findNearestInRange', () => {
  test('returns nearest unvisited feature within radius', () => {
    const features = [
      makeFeature('far', [8, 0]),
      makeFeature('near', [2, 0]),
      makeFeature('mid', [5, 0]),
    ];
    const result = findNearestInRange([0, 0], features, 10, new Set());
    expect(result?.getId()).toBe('near');
  });

  test('skips visited features', () => {
    const features = [makeFeature('near', [2, 0]), makeFeature('far', [8, 0])];
    const visited = new Set<string | number>(['near']);
    const result = findNearestInRange([0, 0], features, 10, visited);
    expect(result?.getId()).toBe('far');
  });

  test('returns null when all in-range features are visited', () => {
    const features = [makeFeature('a', [1, 0]), makeFeature('b', [2, 0])];
    const visited = new Set<string | number>(['a', 'b']);
    expect(findNearestInRange([0, 0], features, 10, visited)).toBeNull();
  });

  test('ignores features outside radius', () => {
    const features = [makeFeature('near', [2, 0]), makeFeature('out', [50, 0])];
    const visited = new Set<string | number>(['near']);
    expect(findNearestInRange([0, 0], features, 10, visited)).toBeNull();
  });

  test('returns null for empty features', () => {
    expect(findNearestInRange([0, 0], [], 10, new Set())).toBeNull();
  });
});

// ── module metadata ──────────────────────────────────────────────────────────

describe('nextPointNavigation metadata', () => {
  test('has correct id', () => {
    expect(nextPointNavigation.id).toBe('nextPointNavigation');
  });

  test('has feature category', () => {
    expect(nextPointNavigation.category).toBe('feature');
  });

  test('is enabled by default', () => {
    expect(nextPointNavigation.defaultEnabled).toBe(true);
  });

  test('has localized name and description', () => {
    expect(nextPointNavigation.name.ru).toBeTruthy();
    expect(nextPointNavigation.name.en).toBeTruthy();
    expect(nextPointNavigation.description.ru).toBeTruthy();
    expect(nextPointNavigation.description.en).toBeTruthy();
  });
});

// ── enable / disable ─────────────────────────────────────────────────────────

jest.mock('../../core/olMap', () => ({
  getOlMap: jest.fn(),
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- jest.requireActual returns any
  findLayerByName: jest.requireActual('../../core/olMap').findLayerByName,
}));

import { getOlMap } from '../../core/olMap';

const mockGetOlMap = getOlMap as jest.MockedFunction<typeof getOlMap>;

describe('nextPointNavigation enable/disable', () => {
  let pointsSrc: IOlVectorSource;
  let playerSrc: IOlVectorSource;
  let view: IOlView;
  let olMap: IOlMap & { dispatchEvent: jest.Mock; getPixelFromCoordinate: jest.Mock };

  beforeEach(() => {
    // p1=[10,10] (dist≈14), p2=[20,20] (dist≈28), p3=[200,200]
    // Игрок в [0,0], INTERACTION_RANGE=45
    // p1 и p2 в ренже, p3 вне ренжа
    pointsSrc = makeSource([
      makeFeature('p1', [10, 10]),
      makeFeature('p2', [20, 20]),
      makeFeature('p3', [200, 200]),
    ]);
    playerSrc = makeSource([makeFeature('player', [0, 0])]);
    view = makeView();
    const pointsLayer = makeLayer('points', pointsSrc);
    const playerLayer = makeLayer('player', playerSrc);
    olMap = makeMapWithDispatch([pointsLayer, playerLayer], view);
    mockGetOlMap.mockResolvedValue(olMap);

    const popup = document.createElement('div');
    popup.className = 'info popup';
    const buttonsContainer = document.createElement('div');
    buttonsContainer.className = 'i-buttons';
    popup.appendChild(buttonsContainer);
    document.body.appendChild(popup);
  });

  afterEach(async () => {
    await nextPointNavigation.disable();
    document.querySelector('.info.popup')?.remove();
  });

  test('injects button into visible popup on enable', async () => {
    await nextPointNavigation.enable();
    const button = document.querySelector('.svp-next-point-button');
    expect(button).not.toBeNull();
    expect(button?.textContent).toBe('→');
  });

  test('removes button on disable', async () => {
    await nextPointNavigation.enable();
    await nextPointNavigation.disable();
    expect(document.querySelector('.svp-next-point-button')).toBeNull();
  });

  test('navigates to nearest in-range point', async () => {
    await nextPointNavigation.enable();

    const popup = document.querySelector('.info.popup') as HTMLElement;
    popup.dataset.guid = 'p1';
    await new Promise((resolve) => setTimeout(resolve, 0));

    const button = document.querySelector('.svp-next-point-button') as HTMLElement;
    button.click();

    // От игрока [0,0] ближайшая непосещённая в ренже = p2
    expect(olMap.getPixelFromCoordinate).toHaveBeenCalledWith([20, 20]);
  });

  test('skips out-of-range points', async () => {
    // Только p1 в ренже, p3 далеко
    pointsSrc = makeSource([makeFeature('p1', [10, 10]), makeFeature('p3', [200, 200])]);
    olMap = makeMapWithDispatch(
      [makeLayer('points', pointsSrc), makeLayer('player', playerSrc)],
      view,
    );
    mockGetOlMap.mockResolvedValue(olMap);
    await nextPointNavigation.enable();

    const popup = document.querySelector('.info.popup') as HTMLElement;
    popup.dataset.guid = 'p1';
    await new Promise((resolve) => setTimeout(resolve, 0));

    const button = document.querySelector('.svp-next-point-button') as HTMLElement;
    olMap.dispatchEvent.mockClear();
    button.click();

    // p1 единственная в ренже — цикл не найдёт другую точку
    expect(olMap.dispatchEvent).not.toHaveBeenCalled();
  });

  test('cycles when all in-range visited', async () => {
    pointsSrc = makeSource([makeFeature('p1', [10, 10]), makeFeature('p2', [20, 20])]);
    olMap = makeMapWithDispatch(
      [makeLayer('points', pointsSrc), makeLayer('player', playerSrc)],
      view,
    );
    mockGetOlMap.mockResolvedValue(olMap);
    await nextPointNavigation.enable();

    const popup = document.querySelector('.info.popup') as HTMLElement;
    popup.dataset.guid = 'p1';
    await new Promise((resolve) => setTimeout(resolve, 0));

    const button = document.querySelector('.svp-next-point-button') as HTMLElement;

    // Первый клик: p1 visited → p2
    button.click();
    expect(olMap.getPixelFromCoordinate).toHaveBeenLastCalledWith([20, 20]);

    // Симулируем открытие p2
    popup.dataset.guid = 'p2';
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Второй клик: все visited → цикл → p1
    olMap.getPixelFromCoordinate.mockClear();
    button.click();
    expect(olMap.getPixelFromCoordinate).toHaveBeenLastCalledWith([10, 10]);
  });

  test('does not move the map on navigation', async () => {
    await nextPointNavigation.enable();

    const popup = document.querySelector('.info.popup') as HTMLElement;
    popup.dataset.guid = 'p1';

    const button = document.querySelector('.svp-next-point-button') as HTMLElement;
    button.click();

    expect(view.setCenter).not.toHaveBeenCalled();
  });

  test('does nothing when popup has no guid', async () => {
    await nextPointNavigation.enable();

    const button = document.querySelector('.svp-next-point-button') as HTMLElement;
    button.click();

    expect(olMap.dispatchEvent).not.toHaveBeenCalled();
  });

  test('does nothing when points layer not found', async () => {
    const otherLayer = makeLayer('other', makeSource());
    mockGetOlMap.mockResolvedValue(makeMapWithDispatch([otherLayer], view));
    await nextPointNavigation.enable();
    expect(document.querySelector('.svp-next-point-button')).toBeNull();
  });

  test('double disable does not throw', async () => {
    await nextPointNavigation.enable();
    await nextPointNavigation.disable();
    expect(() => nextPointNavigation.disable()).not.toThrow();
  });

  test('resets chain when popup guid changes without navigation', async () => {
    await nextPointNavigation.enable();

    const popup = document.querySelector('.info.popup') as HTMLElement;
    popup.dataset.guid = 'p1';

    const button = document.querySelector('.svp-next-point-button') as HTMLElement;

    button.click();
    expect(olMap.dispatchEvent).toHaveBeenCalledTimes(1);

    // Симулируем открытие p2 (ожидаемая точка)
    popup.dataset.guid = 'p2';
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Ручное открытие другой точки (p1 снова)
    popup.dataset.guid = 'p1';
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Цепочка сбросилась — p2 снова доступна
    olMap.dispatchEvent.mockClear();
    olMap.getPixelFromCoordinate.mockClear();
    button.click();
    expect(olMap.getPixelFromCoordinate).toHaveBeenCalledWith([20, 20]);
  });

  test('retries navigation when fake click reopens same point', async () => {
    pointsSrc = makeSource([
      makeFeature('p1', [10, 10]),
      makeFeature('p2', [20, 20]),
      makeFeature('p3', [30, 30]),
    ]);
    olMap = makeMapWithDispatch(
      [makeLayer('points', pointsSrc), makeLayer('player', playerSrc)],
      view,
    );
    mockGetOlMap.mockResolvedValue(olMap);
    await nextPointNavigation.enable();

    const popup = document.querySelector('.info.popup') as HTMLElement;
    popup.dataset.guid = 'p1';
    await new Promise((resolve) => setTimeout(resolve, 0));

    const button = document.querySelector('.svp-next-point-button') as HTMLElement;

    button.click();
    expect(olMap.getPixelFromCoordinate).toHaveBeenLastCalledWith([20, 20]);

    // Фейковый клик переоткрыл ту же точку
    const temp = document.createElement('span');
    popup.appendChild(temp);
    await new Promise((resolve) => setTimeout(resolve, 0));
    temp.remove();

    // Retry — p2 не в visited → снова p2
    expect(olMap.getPixelFromCoordinate).toHaveBeenLastCalledWith([20, 20]);
  });

  test('accepts different point when fake click misses target', async () => {
    pointsSrc = makeSource([
      makeFeature('p1', [10, 10]),
      makeFeature('p2', [20, 20]),
      makeFeature('p3', [30, 30]),
    ]);
    olMap = makeMapWithDispatch(
      [makeLayer('points', pointsSrc), makeLayer('player', playerSrc)],
      view,
    );
    mockGetOlMap.mockResolvedValue(olMap);
    await nextPointNavigation.enable();

    const popup = document.querySelector('.info.popup') as HTMLElement;
    popup.dataset.guid = 'p1';

    const button = document.querySelector('.svp-next-point-button') as HTMLElement;

    button.click();
    expect(olMap.getPixelFromCoordinate).toHaveBeenLastCalledWith([20, 20]);

    // Фейковый клик попал в p3 вместо p2
    popup.dataset.guid = 'p3';
    await new Promise((resolve) => setTimeout(resolve, 0));

    // p3 принята, p2 доступна (не была в visited)
    olMap.getPixelFromCoordinate.mockClear();
    button.click();
    expect(olMap.getPixelFromCoordinate).toHaveBeenCalledWith([20, 20]);
  });

  test('disables button when no in-range points', async () => {
    playerSrc = makeSource([makeFeature('player', [1000, 1000])]);
    pointsSrc = makeSource([makeFeature('p1', [10, 10])]);
    olMap = makeMapWithDispatch(
      [makeLayer('points', pointsSrc), makeLayer('player', playerSrc)],
      view,
    );
    mockGetOlMap.mockResolvedValue(olMap);
    await nextPointNavigation.enable();

    const popup = document.querySelector('.info.popup') as HTMLElement;
    popup.dataset.guid = 'p1';
    await new Promise((resolve) => setTimeout(resolve, 0));

    const button = document.querySelector('.svp-next-point-button') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  test('disables button when only the current point is in range', async () => {
    // p1 в ренже (dist≈14), p2 вне ренжа (dist≈283)
    pointsSrc = makeSource([makeFeature('p1', [10, 10]), makeFeature('p2', [200, 200])]);
    playerSrc = makeSource([makeFeature('player', [0, 0])]);
    olMap = makeMapWithDispatch(
      [makeLayer('points', pointsSrc), makeLayer('player', playerSrc)],
      view,
    );
    mockGetOlMap.mockResolvedValue(olMap);
    await nextPointNavigation.enable();

    const popup = document.querySelector('.info.popup') as HTMLElement;
    popup.dataset.guid = 'p1';
    await new Promise((resolve) => setTimeout(resolve, 0));

    const button = document.querySelector('.svp-next-point-button') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  test('enables button when another point is also in range', async () => {
    // p1 (dist≈14) и p2 (dist≈28) оба в ренже
    pointsSrc = makeSource([makeFeature('p1', [10, 10]), makeFeature('p2', [20, 20])]);
    playerSrc = makeSource([makeFeature('player', [0, 0])]);
    olMap = makeMapWithDispatch(
      [makeLayer('points', pointsSrc), makeLayer('player', playerSrc)],
      view,
    );
    mockGetOlMap.mockResolvedValue(olMap);
    await nextPointNavigation.enable();

    const popup = document.querySelector('.info.popup') as HTMLElement;
    popup.dataset.guid = 'p1';
    await new Promise((resolve) => setTimeout(resolve, 0));

    const button = document.querySelector('.svp-next-point-button') as HTMLButtonElement;
    expect(button.disabled).toBe(false);
  });

  test('enables button when current point is out of range but others are in range', async () => {
    // p1 вне ренжа, p2 в ренже (dist≈14)
    pointsSrc = makeSource([makeFeature('p1', [200, 200]), makeFeature('p2', [10, 10])]);
    playerSrc = makeSource([makeFeature('player', [0, 0])]);
    olMap = makeMapWithDispatch(
      [makeLayer('points', pointsSrc), makeLayer('player', playerSrc)],
      view,
    );
    mockGetOlMap.mockResolvedValue(olMap);
    await nextPointNavigation.enable();

    const popup = document.querySelector('.info.popup') as HTMLElement;
    popup.dataset.guid = 'p1';
    await new Promise((resolve) => setTimeout(resolve, 0));

    const button = document.querySelector('.svp-next-point-button') as HTMLButtonElement;
    expect(button.disabled).toBe(false);
  });

  test('updates button state when pointsSource emits change', async () => {
    // Начинаем с одной точкой в ренже (текущая) — кнопка disabled
    const features = [makeFeature('p1', [10, 10])];
    const listeners = new Map<string, (() => void)[]>();
    const dynamicSource: IOlVectorSource = {
      getFeatures: () => features,
      addFeature: jest.fn(),
      clear: jest.fn(),
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

    playerSrc = makeSource([makeFeature('player', [0, 0])]);
    olMap = makeMapWithDispatch(
      [makeLayer('points', dynamicSource), makeLayer('player', playerSrc)],
      view,
    );
    mockGetOlMap.mockResolvedValue(olMap);
    await nextPointNavigation.enable();

    const popup = document.querySelector('.info.popup') as HTMLElement;
    popup.dataset.guid = 'p1';
    await new Promise((resolve) => setTimeout(resolve, 0));

    const button = document.querySelector('.svp-next-point-button') as HTMLButtonElement;
    expect(button.disabled).toBe(true);

    // Добавляем вторую точку и эмитим change
    features.push(makeFeature('p2', [20, 20]));
    for (const callback of listeners.get('change') ?? []) {
      callback();
    }

    expect(button.disabled).toBe(false);
  });

  test('cleans up source change listener on disable', async () => {
    const listeners = new Map<string, (() => void)[]>();
    const trackingSource: IOlVectorSource = {
      getFeatures: () => [makeFeature('p1', [10, 10])],
      addFeature: jest.fn(),
      clear: jest.fn(),
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

    playerSrc = makeSource([makeFeature('player', [0, 0])]);
    olMap = makeMapWithDispatch(
      [makeLayer('points', trackingSource), makeLayer('player', playerSrc)],
      view,
    );
    mockGetOlMap.mockResolvedValue(olMap);
    await nextPointNavigation.enable();

    const changeListenersAfterEnable = listeners.get('change')?.length ?? 0;
    expect(changeListenersAfterEnable).toBeGreaterThan(0);

    await nextPointNavigation.disable();

    const changeListenersAfterDisable = listeners.get('change')?.length ?? 0;
    expect(changeListenersAfterDisable).toBe(0);
  });
});

// ── autozoom ────────────────────────────────────────────────────────────────

describe('autozoom', () => {
  let playerSrc: IOlVectorSource;
  let view: IOlView;
  let olMap: IOlMap & { dispatchEvent: jest.Mock; getPixelFromCoordinate: jest.Mock };

  beforeEach(() => {
    jest.useFakeTimers();
    playerSrc = makeSource([makeFeature('player', [0, 0])]);
    view = makeView(14);
  });

  afterEach(async () => {
    jest.useRealTimers();
    await nextPointNavigation.disable();
    document.querySelector('.info.popup')?.remove();
  });

  test('triggers autozoom when no in-range points and zoom is low', async () => {
    const pointsSrc = makeSource([makeFeature('p1', [200, 200])]);
    olMap = makeMapWithDispatch(
      [makeLayer('points', pointsSrc), makeLayer('player', playerSrc)],
      view,
    );
    mockGetOlMap.mockResolvedValue(olMap);

    const popup = document.createElement('div');
    popup.className = 'info popup';
    const buttonsContainer = document.createElement('div');
    buttonsContainer.className = 'i-buttons';
    popup.appendChild(buttonsContainer);
    document.body.appendChild(popup);

    await nextPointNavigation.enable();

    popup.dataset.guid = 'p1';
    await jest.advanceTimersByTimeAsync(0);

    expect(view.setCenter).toHaveBeenCalledWith([0, 0]);
    expect(view.setZoom).toHaveBeenCalledWith(17);

    await jest.advanceTimersByTimeAsync(3000);
    expect(view.setCenter).toHaveBeenCalledTimes(2);
  });

  test('does not autozoom when zoom is high enough', async () => {
    view = makeView(17);
    const pointsSrc = makeSource([makeFeature('p1', [200, 200])]);
    olMap = makeMapWithDispatch(
      [makeLayer('points', pointsSrc), makeLayer('player', playerSrc)],
      view,
    );
    mockGetOlMap.mockResolvedValue(olMap);

    const popup = document.createElement('div');
    popup.className = 'info popup';
    const buttonsContainer = document.createElement('div');
    buttonsContainer.className = 'i-buttons';
    popup.appendChild(buttonsContainer);
    document.body.appendChild(popup);

    await nextPointNavigation.enable();

    popup.dataset.guid = 'p1';
    await jest.advanceTimersByTimeAsync(0);

    expect(view.setZoom).not.toHaveBeenCalled();
  });
});
