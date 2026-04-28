import {
  findFeaturesInRange,
  findNearestByDistance,
  findNextByPriority,
  hasFreeSlots,
  isDiscoverable,
  getGeodeticDistance,
  improvedNextPointSwipe,
  installHammerInterceptor,
  tryNavigateInRange,
  uninstallHammerInterceptorForTest,
} from './improvedNextPointSwipe';
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
        getCoordinates(): number[][] {
          return this.coords;
        }
      } as unknown as new (coords: number[][]) => unknown,
    },
    sphere: {
      getLength: (geometry: unknown) => {
        const geom = geometry as { getCoordinates(): number[][] };
        const coords = geom.getCoordinates();
        return mockLineStringLength(coords[0], coords[1]);
      },
    },
  } as unknown as typeof window.ol;
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

// ── getGeodeticDistance ──────────────────────────────────────────────────────

describe('getGeodeticDistance', () => {
  test('returns distance between two points', () => {
    expect(getGeodeticDistance([0, 0], [3, 4])).toBeCloseTo(5);
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
  test('returns true when cores undefined', () => {
    expect(hasFreeSlots(makeFeature('p1', [0, 0]))).toBe(true);
  });
  test('returns true when cores < 6', () => {
    expect(hasFreeSlots(makeFeature('p1', [0, 0], { cores: 3 }))).toBe(true);
  });
  test('returns false when cores = 6', () => {
    expect(hasFreeSlots(makeFeature('p1', [0, 0], { cores: 6 }))).toBe(false);
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
  test('returns false when cooldown active', () => {
    localStorage.setItem('cooldowns', JSON.stringify({ p1: { t: Date.now() + 60000, c: 2 } }));
    expect(isDiscoverable(makeFeature('p1', [0, 0]))).toBe(false);
  });
  test('returns true when cooldown expired and attempts remain', () => {
    localStorage.setItem('cooldowns', JSON.stringify({ p1: { t: Date.now() - 1000, c: 2 } }));
    expect(isDiscoverable(makeFeature('p1', [0, 0]))).toBe(true);
  });
  test('returns false when no attempts remaining', () => {
    localStorage.setItem('cooldowns', JSON.stringify({ p1: { t: Date.now() - 1000, c: 0 } }));
    expect(isDiscoverable(makeFeature('p1', [0, 0]))).toBe(false);
  });
});

// ── findNextByPriority ───────────────────────────────────────────────────────

describe('findNextByPriority', () => {
  beforeEach(() => {
    localStorage.removeItem('cooldowns');
  });
  test('prioritizes free-slot point over closer full one', () => {
    const full = makeFeature('full', [2, 0], { cores: 6 });
    const free = makeFeature('free', [8, 0], { cores: 3 });
    expect(findNextByPriority([0, 0], [full, free])?.getId()).toBe('free');
  });
  test('falls back to discoverable when no free-slot', () => {
    localStorage.setItem('cooldowns', JSON.stringify({ blocked: { t: Date.now() + 60000, c: 2 } }));
    const blocked = makeFeature('blocked', [2, 0], { cores: 6 });
    const discoverable = makeFeature('discoverable', [8, 0], { cores: 6 });
    expect(findNextByPriority([0, 0], [blocked, discoverable])?.getId()).toBe('discoverable');
  });
  test('falls back to nearest when nothing prioritized', () => {
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
  });
  test('returns null for empty input', () => {
    expect(findNextByPriority([0, 0], [])).toBeNull();
  });
});

// ── module metadata ──────────────────────────────────────────────────────────

describe('improvedNextPointSwipe metadata', () => {
  test('has correct id', () => {
    expect(improvedNextPointSwipe.id).toBe('improvedNextPointSwipe');
  });
  test('has feature category', () => {
    expect(improvedNextPointSwipe.category).toBe('feature');
  });
  test('is enabled by default', () => {
    expect(improvedNextPointSwipe.defaultEnabled).toBe(true);
  });
  test('has localized name and description', () => {
    expect(improvedNextPointSwipe.name.ru).toBeTruthy();
    expect(improvedNextPointSwipe.name.en).toBeTruthy();
    expect(improvedNextPointSwipe.description.ru).toBeTruthy();
    expect(improvedNextPointSwipe.description.en).toBeTruthy();
  });
});

// ── enable / disable + Hammer перехват ──────────────────────────────────────

jest.mock('../../core/olMap', () => ({
  getOlMap: jest.fn(),
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- jest.requireActual returns any
  findLayerByName: jest.requireActual('../../core/olMap').findLayerByName,
}));

import { getOlMap } from '../../core/olMap';
const mockGetOlMap = getOlMap as jest.MockedFunction<typeof getOlMap>;

interface IFakeHammerStatic {
  Manager: {
    prototype: { emit: (this: { element: Element }, name: string, data?: unknown) => void };
  };
}

function setupHammerGlobalMock(): {
  fakeHammer: IFakeHammerStatic;
  originalEmit: jest.Mock;
} {
  const originalEmit = jest.fn();
  const fakeHammer: IFakeHammerStatic = {
    Manager: {
      prototype: {
        emit: originalEmit,
      },
    },
  };
  (window as unknown as { Hammer?: IFakeHammerStatic }).Hammer = fakeHammer;
  return { fakeHammer, originalEmit };
}

describe('improvedNextPointSwipe enable/disable', () => {
  let pointsSrc: IOlVectorSource;
  let playerSrc: IOlVectorSource;
  let view: IOlView;
  let olMap: IOlMap & { dispatchEvent: jest.Mock; getPixelFromCoordinate: jest.Mock };

  beforeEach(() => {
    // p1=[10,10] (~14m), p2=[20,20] (~28m), p3=[200,200] - вне 45m.
    pointsSrc = makeSource([
      makeFeature('p1', [10, 10]),
      makeFeature('p2', [20, 20]),
      makeFeature('p3', [200, 200]),
    ]);
    playerSrc = makeSource([makeFeature('player', [0, 0])]);
    view = makeView();
    olMap = makeMapWithDispatch(
      [makeLayer('points', pointsSrc), makeLayer('player', playerSrc)],
      view,
    );
    mockGetOlMap.mockResolvedValue(olMap);

    const popup = document.createElement('div');
    popup.className = 'info popup';
    popup.dataset.guid = 'p1';
    document.body.appendChild(popup);
  });

  afterEach(async () => {
    await improvedNextPointSwipe.disable();
    document.querySelector('.info.popup')?.remove();
    delete (window as unknown as { Hammer?: unknown }).Hammer;
    uninstallHammerInterceptorForTest();
  });

  test('does not inject any button into popup on enable', async () => {
    await improvedNextPointSwipe.enable();
    // Старый кнопочный селектор - не должен присутствовать.
    expect(document.querySelector('.svp-next-point-button')).toBeNull();
    // Никаких новых кнопок модуль также не добавляет.
    const popup = document.querySelector('.info.popup');
    expect(popup?.querySelectorAll('button').length).toBe(0);
  });

  test('init ставит patch на Hammer.Manager.prototype.emit', () => {
    setupHammerGlobalMock();
    installHammerInterceptor();
    const patched = (window as unknown as { Hammer: IFakeHammerStatic }).Hammer.Manager.prototype
      .emit;
    // patch заменил функцию - имя patched (как в реализации), не наш jest.fn().
    expect(patched.name).toBe('patched');
  });

  test('после enable swipeleft на .info триггерит navigate (showInfo вызван)', async () => {
    setupHammerGlobalMock();
    installHammerInterceptor();
    const showInfoMock = jest.fn();
    window.showInfo = showInfoMock;
    await improvedNextPointSwipe.enable();

    // Симулируем emit('swipeleft') от нативного Hammer-instance с element = .info.
    const popup = document.querySelector('.info.popup') as HTMLElement;
    const fakeManager = { element: popup };
    (window as unknown as { Hammer: IFakeHammerStatic }).Hammer.Manager.prototype.emit.call(
      fakeManager as unknown as { element: Element },
      'swipeleft',
    );

    // p1 - текущая, ближайшая в радиусе 45m - p2 (20,20).
    expect(showInfoMock).toHaveBeenCalledWith('p2');
    delete window.showInfo;
  });

  test('после disable swipeleft на .info снова идёт через originalEmit (наш не вмешивается)', async () => {
    const { originalEmit } = setupHammerGlobalMock();
    installHammerInterceptor();
    await improvedNextPointSwipe.enable();
    await improvedNextPointSwipe.disable();

    const popup = document.querySelector('.info.popup') as HTMLElement;
    const fakeManager = { element: popup };
    (window as unknown as { Hammer: IFakeHammerStatic }).Hammer.Manager.prototype.emit.call(
      fakeManager as unknown as { element: Element },
      'swipeleft',
      { foo: 'bar' },
    );
    expect(originalEmit).toHaveBeenCalledWith('swipeleft', { foo: 'bar' });
  });

  test('emit не на .info игнорируется patch-ом - originalEmit вызван', async () => {
    const { originalEmit } = setupHammerGlobalMock();
    installHammerInterceptor();
    await improvedNextPointSwipe.enable();

    const otherElement = document.createElement('div');
    otherElement.className = 'something-else';
    const fakeManager = { element: otherElement };
    (window as unknown as { Hammer: IFakeHammerStatic }).Hammer.Manager.prototype.emit.call(
      fakeManager as unknown as { element: Element },
      'swipeleft',
    );
    expect(originalEmit).toHaveBeenCalledWith('swipeleft', undefined);
  });

  test('не-swipe events на .info проходят насквозь', async () => {
    const { originalEmit } = setupHammerGlobalMock();
    installHammerInterceptor();
    await improvedNextPointSwipe.enable();

    const popup = document.querySelector('.info.popup') as HTMLElement;
    const fakeManager = { element: popup };
    (window as unknown as { Hammer: IFakeHammerStatic }).Hammer.Manager.prototype.emit.call(
      fakeManager as unknown as { element: Element },
      'swipeup',
    );
    expect(originalEmit).toHaveBeenCalledWith('swipeup', undefined);
  });

  test('tryNavigateInRange после enable выбирает ближайшую непосещённую', async () => {
    window.showInfo = jest.fn();
    await improvedNextPointSwipe.enable();
    expect(tryNavigateInRange()).toBe(true);
    // p2 - ближайшая непосещённая в радиусе.
    expect(window.showInfo).toHaveBeenCalledWith('p2');
    delete window.showInfo;
  });
});
