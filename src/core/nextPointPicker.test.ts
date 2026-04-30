import {
  findFeaturesInRange,
  findNearestByDistance,
  findNextByPriority,
  hasFreeSlots,
  isDiscoverable,
  getGeodeticDistance,
  pickNextInRange,
} from './nextPointPicker';
import type { IOlFeature } from './olMap';

// ── OL mock ─────────────────────────────────────────────────────────────────

function mockLineStringLength(coordsA: number[], coordsB: number[]): number {
  const dx = coordsA[0] - coordsB[0];
  const dy = coordsA[1] - coordsB[1];
  return Math.sqrt(dx * dx + dy * dy);
}

beforeAll(() => {
  window.ol = {
    Map: { prototype: { getView: () => ({}) as never } },
    geom: {
      LineString: class {
        private coords: number[][];
        constructor(coords: number[][]) {
          this.coords = coords;
        }
        getCoordinates(): number[][] {
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

// ── Helpers ──────────────────────────────────────────────────────────────────

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
    const ids = findFeaturesInRange([0, 0], features, 10).map((f) => f.getId());
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

// ── findNearestByDistance ────────────────────────────────────────────────────

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
    expect(hasFreeSlots(makeFeature('p', [0, 0]))).toBe(true);
  });

  test('returns true when cores < 6', () => {
    expect(hasFreeSlots(makeFeature('p', [0, 0], { cores: 3 }))).toBe(true);
  });

  test('returns false when cores = 6', () => {
    expect(hasFreeSlots(makeFeature('p', [0, 0], { cores: 6 }))).toBe(false);
  });

  test('returns true when cores = 0', () => {
    expect(hasFreeSlots(makeFeature('p', [0, 0], { cores: 0 }))).toBe(true);
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
  test('prioritizes free-slot point over closer full point', () => {
    const full = makeFeature('full', [2, 0], { cores: 6 });
    const free = makeFeature('free', [8, 0], { cores: 3 });
    expect(findNextByPriority([0, 0], [full, free])?.getId()).toBe('free');
  });

  test('prioritizes discoverable when no free-slot points', () => {
    localStorage.setItem('cooldowns', JSON.stringify({ blocked: { t: Date.now() + 60000, c: 2 } }));
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
});

// ── pickNextInRange ──────────────────────────────────────────────────────────

describe('pickNextInRange', () => {
  test('возвращает ближайшую непосещённую в радиусе', () => {
    const features = [
      makeFeature('p1', [10, 10]),
      makeFeature('p2', [20, 20]),
      makeFeature('p3', [200, 200]),
    ];
    const visited = new Set<string | number>();
    const result = pickNextInRange({
      playerCoords: [0, 0],
      features,
      currentGuid: 'p1',
      visited,
      radiusMeters: 45,
    });
    expect(result?.getId()).toBe('p2');
  });

  test('добавляет currentGuid в visited', () => {
    const visited = new Set<string | number>();
    pickNextInRange({
      playerCoords: [0, 0],
      features: [makeFeature('p1', [10, 10]), makeFeature('p2', [20, 20])],
      currentGuid: 'p1',
      visited,
      radiusMeters: 45,
    });
    expect(visited.has('p1')).toBe(true);
  });

  test('пропускает уже посещённые', () => {
    const visited = new Set<string | number>(['p2']);
    const result = pickNextInRange({
      playerCoords: [0, 0],
      features: [
        makeFeature('p1', [10, 10]),
        makeFeature('p2', [20, 20]),
        makeFeature('p3', [30, 30]),
      ],
      currentGuid: 'p1',
      visited,
      radiusMeters: 45,
    });
    expect(result?.getId()).toBe('p3');
  });

  test('исключает точки вне радиуса', () => {
    const result = pickNextInRange({
      playerCoords: [0, 0],
      features: [makeFeature('p1', [10, 10]), makeFeature('p3', [200, 200])],
      currentGuid: 'p1',
      visited: new Set(),
      radiusMeters: 45,
    });
    // p1 текущая (добавится в visited), p3 вне радиуса
    expect(result).toBeNull();
  });

  test('зацикливает: после посещения всех в радиусе сбрасывает visited', () => {
    const visited = new Set<string | number>(['p2']);
    const result = pickNextInRange({
      playerCoords: [0, 0],
      features: [makeFeature('p1', [10, 10]), makeFeature('p2', [20, 20])],
      currentGuid: 'p1',
      visited,
      radiusMeters: 45,
    });
    // p1 + p2 visited. После добавления p1 кандидатов нет, цикл сбрасывает
    // visited (оставляя p1) и возвращает p2.
    expect(result?.getId()).toBe('p2');
    expect(visited.has('p1')).toBe(true);
    expect(visited.has('p2')).toBe(false);
  });

  test('возвращает null если все features вне радиуса', () => {
    const result = pickNextInRange({
      playerCoords: [0, 0],
      features: [makeFeature('p1', [200, 200]), makeFeature('p2', [300, 300])],
      currentGuid: 'p1',
      visited: new Set(),
      radiusMeters: 45,
    });
    expect(result).toBeNull();
  });
});
