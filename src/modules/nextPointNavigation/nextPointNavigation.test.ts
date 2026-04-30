import {
  findFeaturesInRange,
  findNearestInRange,
  findNearestByDistance,
  findNextByPriority,
  hasFreeSlots,
  isDiscoverable,
  getGeodeticDistance,
  pickNextInRange,
  nextPointNavigation,
} from './nextPointNavigation';
import type { IOlFeature, IOlLayer, IOlMap, IOlVectorSource, IOlView } from '../../core/olMap';
import {
  DIRECTION_THRESHOLD,
  DISMISS_THRESHOLD,
  dispatchTouchEndForTest,
  dispatchTouchMoveForTest,
  dispatchTouchStartForTest,
  getStateForTest,
  resetForTest,
  setPopupForTest,
} from '../../core/popupSwipe';

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

function makeFeature(
  id: string,
  coords: number[],
  properties?: Record<string, unknown>,
): IOlFeature {
  return {
    getGeometry: () => ({ getCoordinates: () => coords }),
    getId: () => id,
    setId: jest.fn(),
    setStyle: jest.fn(),
    get: (key: string) => properties?.[key],
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

function setupPopupDom(guid?: string): HTMLElement {
  const popup = document.createElement('div');
  popup.className = 'info popup';
  if (guid !== undefined) popup.dataset.guid = guid;
  document.body.appendChild(popup);
  return popup;
}

/**
 * Эмулирует горизонтальный свайп через core/popupSwipe и завершает анимацию
 * dispatchEvent('transitionend'). Свайп влево (dx < 0) активирует direction='left',
 * свайп вправо (dx > 0) — 'right'. В нашем модуле оба registered к одному handler.
 */
function performHorizontalSwipe(
  popup: HTMLElement,
  direction: 'left' | 'right',
  options: { target?: HTMLElement } = {},
): void {
  const target = options.target ?? popup;
  const sign = direction === 'left' ? -1 : 1;
  const startX = 200;
  const endX = startX + sign * (DISMISS_THRESHOLD + 20);
  setPopupForTest(popup);
  dispatchTouchStartForTest({ clientX: startX, clientY: 300, target }, 0);
  dispatchTouchMoveForTest(
    { clientX: startX + sign * (DIRECTION_THRESHOLD + 1), clientY: 300, target },
    50,
  );
  dispatchTouchMoveForTest({ clientX: endX, clientY: 300, target }, 250);
  dispatchTouchEndForTest(300);
}

function flushSwipeAnimation(popup: HTMLElement): void {
  const evt = new Event('transitionend', { bubbles: false });
  Object.defineProperty(evt, 'target', { value: popup });
  popup.dispatchEvent(evt);
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

// ── findNearestByDistance ─────────────────────────────────────────────────────

describe('findNearestByDistance', () => {
  test('returns nearest feature by projected distance', () => {
    const features = [makeFeature('far', [8, 0]), makeFeature('near', [2, 0])];
    expect(findNearestByDistance([0, 0], features)?.getId()).toBe('near');
  });

  test('returns null for empty array', () => {
    expect(findNearestByDistance([0, 0], [])).toBeNull();
  });
});

// ── hasFreeSlots ─────────────────────────────────────────────────────────────

describe('hasFreeSlots', () => {
  test('returns true when cores is undefined', () => {
    expect(hasFreeSlots(makeFeature('p1', [0, 0]))).toBe(true);
  });

  test('returns true when cores < 6', () => {
    expect(hasFreeSlots(makeFeature('p1', [0, 0], { cores: 3 }))).toBe(true);
  });

  test('returns false when cores = 6', () => {
    expect(hasFreeSlots(makeFeature('p1', [0, 0], { cores: 6 }))).toBe(false);
  });

  test('returns true when cores = 0', () => {
    expect(hasFreeSlots(makeFeature('p1', [0, 0], { cores: 0 }))).toBe(true);
  });
});

// ── isDiscoverable ───────────────────────────────────────────────────────────

describe('isDiscoverable', () => {
  beforeEach(() => {
    localStorage.removeItem('cooldowns');
  });

  test('returns true when no cooldown entry', () => {
    expect(isDiscoverable(makeFeature('p1', [0, 0]))).toBe(true);
  });

  test('returns true when cooldown expired and attempts remain', () => {
    localStorage.setItem('cooldowns', JSON.stringify({ p1: { t: Date.now() - 1000, c: 2 } }));
    expect(isDiscoverable(makeFeature('p1', [0, 0]))).toBe(true);
  });

  test('returns false when cooldown is active', () => {
    localStorage.setItem('cooldowns', JSON.stringify({ p1: { t: Date.now() + 60000, c: 2 } }));
    expect(isDiscoverable(makeFeature('p1', [0, 0]))).toBe(false);
  });

  test('returns false when no attempts remaining', () => {
    localStorage.setItem('cooldowns', JSON.stringify({ p1: { t: Date.now() - 1000, c: 0 } }));
    expect(isDiscoverable(makeFeature('p1', [0, 0]))).toBe(false);
  });

  test('returns false for feature without id', () => {
    const noId: IOlFeature = {
      getGeometry: () => ({ getCoordinates: () => [0, 0] }),
      getId: () => undefined,
      setId: jest.fn(),
      setStyle: jest.fn(),
    };
    expect(isDiscoverable(noId)).toBe(false);
  });
});

// ── findNextByPriority ───────────────────────────────────────────────────────

describe('findNextByPriority', () => {
  test('prioritizes point with free slots over closer full point', () => {
    const full = makeFeature('full', [2, 0], { cores: 6 });
    const free = makeFeature('free', [8, 0], { cores: 3 });
    expect(findNextByPriority([0, 0], [full, free])?.getId()).toBe('free');
  });

  test('prioritizes discoverable when no free-slot points', () => {
    localStorage.setItem(
      'cooldowns',
      JSON.stringify({
        blocked: { t: Date.now() + 60000, c: 2 },
      }),
    );
    const blocked = makeFeature('blocked', [2, 0], { cores: 6 });
    const discoverable = makeFeature('discoverable', [8, 0], { cores: 6 });
    expect(findNextByPriority([0, 0], [blocked, discoverable])?.getId()).toBe('discoverable');
    localStorage.removeItem('cooldowns');
  });

  test('falls back to nearest when no prioritized points', () => {
    localStorage.setItem(
      'cooldowns',
      JSON.stringify({
        a: { t: Date.now() + 60000, c: 2 },
        b: { t: Date.now() + 60000, c: 2 },
      }),
    );
    const farther = makeFeature('a', [8, 0], { cores: 6 });
    const closer = makeFeature('b', [2, 0], { cores: 6 });
    expect(findNextByPriority([0, 0], [farther, closer])?.getId()).toBe('b');
    localStorage.removeItem('cooldowns');
  });

  test('returns null for empty candidates', () => {
    expect(findNextByPriority([0, 0], [])).toBeNull();
  });

  test('picks nearest among free-slot points', () => {
    const far = makeFeature('far', [8, 0], { cores: 3 });
    const near = makeFeature('near', [2, 0], { cores: 1 });
    expect(findNextByPriority([0, 0], [far, near])?.getId()).toBe('near');
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

// ── enable / disable / swipe integration ────────────────────────────────────

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
  let popup: HTMLElement;

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

    popup = setupPopupDom();
  });

  afterEach(async () => {
    await nextPointNavigation.disable();
    resetForTest();
    setPopupForTest(null);
    document.querySelector('.info.popup')?.remove();
    delete window.showInfo;
  });

  test('horizontal swipe navigates to nearest in-range point via showInfo', async () => {
    const mockShowInfo = jest.fn();
    window.showInfo = mockShowInfo;
    await nextPointNavigation.enable();

    popup.dataset.guid = 'p1';
    await new Promise((resolve) => setTimeout(resolve, 0));

    performHorizontalSwipe(popup, 'left');
    flushSwipeAnimation(popup);

    expect(mockShowInfo).toHaveBeenCalledWith('p2');
  });

  test('right swipe also goes to next (priority navigation, not native prev)', async () => {
    const mockShowInfo = jest.fn();
    window.showInfo = mockShowInfo;
    await nextPointNavigation.enable();

    popup.dataset.guid = 'p1';
    await new Promise((resolve) => setTimeout(resolve, 0));

    performHorizontalSwipe(popup, 'right');
    flushSwipeAnimation(popup);

    // Both directions go through pickNextInRange — same priority logic.
    expect(mockShowInfo).toHaveBeenCalledWith('p2');
  });

  test('falls back to fake click when showInfo not available', async () => {
    delete window.showInfo;
    await nextPointNavigation.enable();

    popup.dataset.guid = 'p1';
    await new Promise((resolve) => setTimeout(resolve, 0));

    performHorizontalSwipe(popup, 'left');
    flushSwipeAnimation(popup);

    expect(olMap.getPixelFromCoordinate).toHaveBeenCalledWith([20, 20]);
  });

  test('does not hide popup before calling showInfo (no flicker)', async () => {
    // Регрессия: openPointPopup не должен скрывать попап перед showInfo.
    // Мерцание возникало в течение await apiQuery внутри showInfo.
    // Нативный свайп игры (refs/game/script.js:751) попап не скрывает.
    const mockShowInfo = jest.fn();
    window.showInfo = mockShowInfo;
    await nextPointNavigation.enable();

    popup.dataset.guid = 'p1';
    await new Promise((resolve) => setTimeout(resolve, 0));

    performHorizontalSwipe(popup, 'left');
    flushSwipeAnimation(popup);

    expect(popup.classList.contains('hidden')).toBe(false);
    expect(mockShowInfo).toHaveBeenCalledWith('p2');
  });

  test('swipe inside cores splide carousel does not navigate', async () => {
    const mockShowInfo = jest.fn();
    window.showInfo = mockShowInfo;
    await nextPointNavigation.enable();

    popup.dataset.guid = 'p1';
    const splide = document.createElement('div');
    splide.className = 'splide';
    const slide = document.createElement('div');
    slide.className = 'splide__slide';
    splide.appendChild(slide);
    popup.appendChild(splide);
    await new Promise((resolve) => setTimeout(resolve, 0));

    // canStart возвращает false для target внутри .splide -> direction-handler
    // не активируется -> state остаётся idle, finalize не вызывается.
    setPopupForTest(popup);
    dispatchTouchStartForTest({ clientX: 200, clientY: 300, target: slide }, 0);
    expect(getStateForTest().state).toBe('idle');
  });

  test('skips out-of-range points (only current in range -> no navigation)', async () => {
    pointsSrc = makeSource([makeFeature('p1', [10, 10]), makeFeature('p3', [200, 200])]);
    olMap = makeMapWithDispatch(
      [makeLayer('points', pointsSrc), makeLayer('player', playerSrc)],
      view,
    );
    mockGetOlMap.mockResolvedValue(olMap);
    const mockShowInfo = jest.fn();
    window.showInfo = mockShowInfo;
    await nextPointNavigation.enable();

    popup.dataset.guid = 'p1';
    await new Promise((resolve) => setTimeout(resolve, 0));

    performHorizontalSwipe(popup, 'left');
    flushSwipeAnimation(popup);

    // p1 - единственная в радиусе. decide вернёт 'return' -> finalize не зовётся.
    expect(mockShowInfo).not.toHaveBeenCalled();
  });

  test('cycles when all in-range visited', async () => {
    pointsSrc = makeSource([makeFeature('p1', [10, 10]), makeFeature('p2', [20, 20])]);
    olMap = makeMapWithDispatch(
      [makeLayer('points', pointsSrc), makeLayer('player', playerSrc)],
      view,
    );
    mockGetOlMap.mockResolvedValue(olMap);
    const mockShowInfo = jest.fn();
    window.showInfo = mockShowInfo;
    await nextPointNavigation.enable();

    popup.dataset.guid = 'p1';
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Первый свайп: p1 visited -> p2
    performHorizontalSwipe(popup, 'left');
    flushSwipeAnimation(popup);
    expect(mockShowInfo).toHaveBeenLastCalledWith('p2');

    // Симулируем открытие p2 показом нового data-guid
    popup.dataset.guid = 'p2';
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Второй свайп: все visited -> цикл -> p1
    performHorizontalSwipe(popup, 'left');
    flushSwipeAnimation(popup);
    expect(mockShowInfo).toHaveBeenLastCalledWith('p1');
  });

  test('does nothing when popup has no guid', async () => {
    const mockShowInfo = jest.fn();
    window.showInfo = mockShowInfo;
    await nextPointNavigation.enable();

    performHorizontalSwipe(popup, 'left');
    flushSwipeAnimation(popup);

    expect(mockShowInfo).not.toHaveBeenCalled();
  });

  test('does nothing when points layer not found', async () => {
    const otherLayer = makeLayer('other', makeSource());
    mockGetOlMap.mockResolvedValue(makeMapWithDispatch([otherLayer], view));
    await nextPointNavigation.enable();
    // Регистрация направлений не должна произойти - модуль выходит из enable
    // до registerDirection. Свайп не приведёт к навигации.
    setPopupForTest(popup);
    dispatchTouchStartForTest({ clientX: 200, clientY: 300, target: popup }, 0);
    expect(getStateForTest().state).toBe('idle');
  });

  test('double disable does not throw', async () => {
    await nextPointNavigation.enable();
    await nextPointNavigation.disable();
    expect(() => nextPointNavigation.disable()).not.toThrow();
  });

  test('resets chain when popup guid changes without navigation', async () => {
    pointsSrc = makeSource([makeFeature('p1', [10, 10]), makeFeature('p2', [20, 20])]);
    olMap = makeMapWithDispatch(
      [makeLayer('points', pointsSrc), makeLayer('player', playerSrc)],
      view,
    );
    mockGetOlMap.mockResolvedValue(olMap);
    const mockShowInfo = jest.fn();
    window.showInfo = mockShowInfo;
    await nextPointNavigation.enable();

    popup.dataset.guid = 'p1';
    await new Promise((resolve) => setTimeout(resolve, 0));

    performHorizontalSwipe(popup, 'left');
    flushSwipeAnimation(popup);
    expect(mockShowInfo).toHaveBeenLastCalledWith('p2');

    // Симулируем открытие p2 (ожидаемая точка)
    popup.dataset.guid = 'p2';
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Ручное открытие другой точки (p1 снова)
    popup.dataset.guid = 'p1';
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Цепочка сбросилась — p2 снова доступна
    mockShowInfo.mockClear();
    performHorizontalSwipe(popup, 'left');
    flushSwipeAnimation(popup);
    expect(mockShowInfo).toHaveBeenCalledWith('p2');
  });

  test('retries navigation when fake click reopens same point', async () => {
    // Только в fallback-режиме (без showInfo). Fake click мог промахнуться -
    // popup data-guid остался прежним -> popupObserver запускает retry.
    delete window.showInfo;
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

    popup.dataset.guid = 'p1';
    await new Promise((resolve) => setTimeout(resolve, 0));

    performHorizontalSwipe(popup, 'left');
    flushSwipeAnimation(popup);
    expect(olMap.getPixelFromCoordinate).toHaveBeenLastCalledWith([20, 20]);

    // Фейковый клик переоткрыл ту же точку - триггерим mutation
    const temp = document.createElement('span');
    popup.appendChild(temp);
    await new Promise((resolve) => setTimeout(resolve, 0));
    temp.remove();

    // Retry — p2 не в visited → снова p2
    expect(olMap.getPixelFromCoordinate).toHaveBeenLastCalledWith([20, 20]);
  });

  test('accepts different point when fake click misses target', async () => {
    delete window.showInfo;
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

    popup.dataset.guid = 'p1';

    performHorizontalSwipe(popup, 'left');
    flushSwipeAnimation(popup);
    expect(olMap.getPixelFromCoordinate).toHaveBeenLastCalledWith([20, 20]);

    // Фейковый клик попал в p3 вместо p2
    popup.dataset.guid = 'p3';
    await new Promise((resolve) => setTimeout(resolve, 0));

    // p3 принята, p2 доступна (не была в visited)
    olMap.getPixelFromCoordinate.mockClear();
    performHorizontalSwipe(popup, 'left');
    flushSwipeAnimation(popup);
    expect(olMap.getPixelFromCoordinate).toHaveBeenCalledWith([20, 20]);
  });

  test('does not move map on swipe (only opens popup)', async () => {
    const mockShowInfo = jest.fn();
    window.showInfo = mockShowInfo;
    await nextPointNavigation.enable();

    popup.dataset.guid = 'p1';
    await new Promise((resolve) => setTimeout(resolve, 0));

    (view.setCenter as jest.Mock).mockClear();
    performHorizontalSwipe(popup, 'left');
    flushSwipeAnimation(popup);

    expect(view.setCenter).not.toHaveBeenCalled();
  });

  test('left and right are registered as separate directions', async () => {
    const mockShowInfo = jest.fn();
    window.showInfo = mockShowInfo;
    await nextPointNavigation.enable();

    popup.dataset.guid = 'p1';
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Свайп влево активирует direction='left'
    setPopupForTest(popup);
    dispatchTouchStartForTest({ clientX: 200, clientY: 300, target: popup }, 0);
    dispatchTouchMoveForTest(
      { clientX: 200 - DIRECTION_THRESHOLD - 1, clientY: 300, target: popup },
      50,
    );
    expect(getStateForTest().activeDirection).toBe('left');
    dispatchTouchEndForTest(100);

    resetForTest();
    setPopupForTest(popup);

    // Re-enable так как resetForTest снёс зарегистрированные direction'ы
    await nextPointNavigation.disable();
    await nextPointNavigation.enable();
    setPopupForTest(popup);

    dispatchTouchStartForTest({ clientX: 200, clientY: 300, target: popup }, 0);
    dispatchTouchMoveForTest(
      { clientX: 200 + DIRECTION_THRESHOLD + 1, clientY: 300, target: popup },
      50,
    );
    expect(getStateForTest().activeDirection).toBe('right');
  });

  test('disable unregisters left and right directions', async () => {
    await nextPointNavigation.enable();

    popup.dataset.guid = 'p1';
    await new Promise((resolve) => setTimeout(resolve, 0));

    await nextPointNavigation.disable();

    // После disable горизонтальный жест не активирует handler -> direction
    // не назначается, state остаётся idle.
    setPopupForTest(popup);
    dispatchTouchStartForTest({ clientX: 200, clientY: 300, target: popup }, 0);
    dispatchTouchMoveForTest(
      { clientX: 200 - DIRECTION_THRESHOLD - 1, clientY: 300, target: popup },
      50,
    );
    expect(getStateForTest().state).toBe('idle');
  });

  test('uses 120ms transition-duration on dismiss', async () => {
    const mockShowInfo = jest.fn();
    window.showInfo = mockShowInfo;
    await nextPointNavigation.enable();

    popup.dataset.guid = 'p1';
    await new Promise((resolve) => setTimeout(resolve, 0));

    const setSpy = jest.spyOn(popup.style, 'setProperty');
    performHorizontalSwipe(popup, 'left');

    expect(setSpy).toHaveBeenCalledWith('transition-duration', '120ms');
  });

  test('race-disable during enable does not register direction', async () => {
    // Эмулируем долгий getOlMap.
    let resolveOlMap: (value: typeof olMap) => void = () => {};
    mockGetOlMap.mockReturnValue(
      new Promise((resolve) => {
        resolveOlMap = resolve;
      }),
    );

    const enablePromise = nextPointNavigation.enable();
    // Disable до резолва.
    await nextPointNavigation.disable();
    // Резолвим getOlMap.
    resolveOlMap(olMap);
    await enablePromise;

    // Direction не зарегистрирован - горизонтальный жест в idle.
    setPopupForTest(popup);
    dispatchTouchStartForTest({ clientX: 200, clientY: 300, target: popup }, 0);
    dispatchTouchMoveForTest(
      { clientX: 200 - DIRECTION_THRESHOLD - 1, clientY: 300, target: popup },
      50,
    );
    expect(getStateForTest().state).toBe('idle');
  });
});

// ── pickNextInRange (через enable) ──────────────────────────────────────────

describe('pickNextInRange (export shape)', () => {
  test('is exported as a function', () => {
    expect(typeof pickNextInRange).toBe('function');
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
    resetForTest();
    setPopupForTest(null);
    document.querySelector('.info.popup')?.remove();
  });

  test('triggers autozoom when no in-range points and zoom is low', async () => {
    const pointsSrc = makeSource([makeFeature('p1', [200, 200])]);
    olMap = makeMapWithDispatch(
      [makeLayer('points', pointsSrc), makeLayer('player', playerSrc)],
      view,
    );
    mockGetOlMap.mockResolvedValue(olMap);

    const popup = setupPopupDom();

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

    const popup = setupPopupDom();

    await nextPointNavigation.enable();

    popup.dataset.guid = 'p1';
    await jest.advanceTimersByTimeAsync(0);

    expect(view.setZoom).not.toHaveBeenCalled();
  });
});
