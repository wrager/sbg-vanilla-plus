import { findNearestUnvisited, nextPointNavigation } from './nextPointNavigation';
import type { IOlFeature, IOlLayer, IOlMap, IOlVectorSource, IOlView } from '../../core/olMap';

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
    on(type: string, cb: () => void) {
      const arr = listeners.get(type) ?? [];
      arr.push(cb);
      listeners.set(type, arr);
    },
    un(type: string, cb: () => void) {
      const arr = listeners.get(type) ?? [];
      listeners.set(
        type,
        arr.filter((l) => l !== cb),
      );
    },
  };
}

function makeView(): IOlView {
  return {
    padding: [0, 0, 0, 0],
    getCenter: () => [0, 0],
    setCenter: jest.fn(),
    calculateExtent: () => [0, 0, 0, 0],
    changed: () => {},
    getRotation: () => 0,
    setRotation: () => {},
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

// ── findNearestUnvisited ─────────────────────────────────────────────────────

describe('findNearestUnvisited', () => {
  test('returns nearest feature by distance', () => {
    const features = [
      makeFeature('far', [100, 100]),
      makeFeature('near', [1, 1]),
      makeFeature('mid', [50, 50]),
    ];
    const result = findNearestUnvisited([0, 0], features, new Set());
    expect(result?.getId()).toBe('near');
  });

  test('skips features in visited set', () => {
    const features = [makeFeature('near', [1, 1]), makeFeature('far', [10, 10])];
    const visited = new Set<string | number>(['near']);
    const result = findNearestUnvisited([0, 0], features, visited);
    expect(result?.getId()).toBe('far');
  });

  test('returns null when all features are visited', () => {
    const features = [makeFeature('a', [1, 1]), makeFeature('b', [2, 2])];
    const visited = new Set<string | number>(['a', 'b']);
    const result = findNearestUnvisited([0, 0], features, visited);
    expect(result).toBeNull();
  });

  test('returns null when features array is empty', () => {
    const result = findNearestUnvisited([0, 0], [], new Set());
    expect(result).toBeNull();
  });

  test('skips features with undefined id', () => {
    const noId: IOlFeature = {
      getGeometry: () => ({ getCoordinates: () => [1, 1] }),
      getId: () => undefined,
      setId: jest.fn(),
      setStyle: jest.fn(),
    };
    const withId = makeFeature('valid', [10, 10]);
    const result = findNearestUnvisited([0, 0], [noId, withId], new Set());
    expect(result?.getId()).toBe('valid');
  });

  test('handles single feature correctly', () => {
    const features = [makeFeature('only', [5, 5])];
    const result = findNearestUnvisited([0, 0], features, new Set());
    expect(result?.getId()).toBe('only');
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
}));

import { getOlMap } from '../../core/olMap';

const mockGetOlMap = getOlMap as jest.MockedFunction<typeof getOlMap>;

describe('nextPointNavigation enable/disable', () => {
  let pointsSrc: IOlVectorSource;
  let view: IOlView;
  let olMap: IOlMap & { dispatchEvent: jest.Mock; getPixelFromCoordinate: jest.Mock };

  beforeEach(() => {
    pointsSrc = makeSource([makeFeature('p1', [10, 10]), makeFeature('p2', [20, 20])]);
    view = makeView();
    const pointsLayer = makeLayer('points', pointsSrc);
    olMap = makeMapWithDispatch([pointsLayer], view);
    mockGetOlMap.mockResolvedValue(olMap);

    // Create popup element in DOM
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
    const button = document.querySelector('.svp-next-point-button');
    expect(button).toBeNull();
  });

  test('dispatches fake click on navigation', async () => {
    await nextPointNavigation.enable();

    const popup = document.querySelector('.info.popup') as HTMLElement;
    popup.dataset.guid = 'p1';

    const button = document.querySelector('.svp-next-point-button') as HTMLElement;
    button.click();

    expect(olMap.dispatchEvent).toHaveBeenCalledWith({
      type: 'click',
      pixel: [100, 200],
      originalEvent: {},
    });
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
    const button = document.querySelector('.svp-next-point-button');
    expect(button).toBeNull();
  });

  test('double disable does not throw', async () => {
    await nextPointNavigation.enable();
    await nextPointNavigation.disable();
    expect(() => nextPointNavigation.disable()).not.toThrow();
  });

  test('always searches from the original point in a chain', async () => {
    pointsSrc = makeSource([
      makeFeature('p1', [10, 10]),
      makeFeature('p2', [20, 20]),
      makeFeature('p3', [15, 15]),
    ]);
    olMap = makeMapWithDispatch([makeLayer('points', pointsSrc)], view);
    mockGetOlMap.mockResolvedValue(olMap);
    await nextPointNavigation.enable();

    const popup = document.querySelector('.info.popup') as HTMLElement;
    popup.dataset.guid = 'p1';

    const button = document.querySelector('.svp-next-point-button') as HTMLElement;

    // Первый клик: от p1 ближайшая — p3 ([15,15], dist²=50)
    button.click();
    expect(olMap.getPixelFromCoordinate).toHaveBeenLastCalledWith([15, 15]);

    // Симулируем что попап открылся на p3
    popup.dataset.guid = 'p3';

    // Второй клик: ищем снова от p1 (не от p3!) — p2 ([20,20], dist²=200)
    olMap.dispatchEvent.mockClear();
    button.click();
    expect(olMap.getPixelFromCoordinate).toHaveBeenLastCalledWith([20, 20]);
  });
});
