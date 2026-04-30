import {
  nextPointSwipeAnimation,
  decideForTest,
  finalizeForTest,
  canStartForTest,
} from './nextPointSwipeAnimation';
import type { IOlFeature, IOlLayer, IOlMap, IOlVectorSource, IOlView } from '../../core/olMap';

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
      getLength: (geometry: { getCoordinates(): number[][] }) =>
        mockLineStringLength(geometry.getCoordinates()[0], geometry.getCoordinates()[1]),
    },
  };
});

afterAll(() => {
  window.ol = undefined;
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeFeature(id: string, coords: number[]): IOlFeature {
  return {
    getGeometry: () => ({ getCoordinates: () => coords }),
    getId: () => id,
    setId: jest.fn(),
    setStyle: jest.fn(),
    get: () => undefined,
  };
}

function makeSource(features: IOlFeature[]): IOlVectorSource {
  return {
    getFeatures: () => features,
    addFeature: jest.fn(),
    clear: jest.fn(),
    on: jest.fn(),
    un: jest.fn(),
  };
}

function makeLayer(name: string, source: IOlVectorSource | null): IOlLayer {
  return {
    get: (key: string) => (key === 'name' ? name : undefined),
    getSource: () => source,
  };
}

function makeMap(layers: IOlLayer[]): IOlMap {
  return {
    getView: () => ({}) as IOlView,
    getSize: () => [800, 600],
    getLayers: () => ({ getArray: () => layers }),
    getInteractions: () => ({ getArray: () => [] }),
    addLayer: jest.fn(),
    removeLayer: jest.fn(),
    updateSize: jest.fn(),
  };
}

// ── Mocks ───────────────────────────────────────────────────────────────────

jest.mock('../../core/olMap', () => ({
  getOlMap: jest.fn(),
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- jest.requireActual returns any
  findLayerByName: jest.requireActual('../../core/olMap').findLayerByName,
}));

jest.mock('../../core/moduleRegistry', () => {
  const actual = jest.requireActual<typeof import('../../core/moduleRegistry')>(
    '../../core/moduleRegistry',
  );
  return {
    ...actual,
    isModuleActive: jest.fn(() => false),
  };
});

import { getOlMap } from '../../core/olMap';
import { isModuleActive } from '../../core/moduleRegistry';
const mockGetOlMap = getOlMap as jest.MockedFunction<typeof getOlMap>;
const mockIsModuleActive = isModuleActive as jest.MockedFunction<typeof isModuleActive>;

// ── Метаданные ──────────────────────────────────────────────────────────────

describe('nextPointSwipeAnimation metadata', () => {
  test('has correct id', () => {
    expect(nextPointSwipeAnimation.id).toBe('nextPointSwipeAnimation');
  });

  test('is ui category', () => {
    expect(nextPointSwipeAnimation.category).toBe('ui');
  });

  test('is enabled by default', () => {
    expect(nextPointSwipeAnimation.defaultEnabled).toBe(true);
  });

  test('has localized name and description', () => {
    expect(nextPointSwipeAnimation.name.ru).toBeTruthy();
    expect(nextPointSwipeAnimation.name.en).toBeTruthy();
    expect(nextPointSwipeAnimation.description.ru).toBeTruthy();
    expect(nextPointSwipeAnimation.description.en).toBeTruthy();
  });
});

// ── canStart фильтр ──────────────────────────────────────────────────────────

describe('canStartHorizontalSwipe', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div class="info popup">
        <div class="i-stat">
          <button id="repair">Repair</button>
          <div class="splide" id="cores">
            <button class="splide__slide-btn">Core1</button>
          </div>
        </div>
      </div>
    `;
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('пропускает touch на самом .info', () => {
    expect(canStartForTest(document.querySelector('.info'))).toBe(true);
  });

  test('пропускает touch на других элементах попапа', () => {
    expect(canStartForTest(document.querySelector('#repair'))).toBe(true);
  });

  test('исключает touch внутри .splide', () => {
    expect(canStartForTest(document.querySelector('.splide'))).toBe(false);
    expect(canStartForTest(document.querySelector('.splide__slide-btn'))).toBe(false);
  });

  test('пропускает не-Element targets', () => {
    expect(canStartForTest(null)).toBe(true);
  });
});

// ── enable/disable + decide/finalize ────────────────────────────────────────

describe('nextPointSwipeAnimation behaviour', () => {
  let pointsSrc: IOlVectorSource;
  let playerSrc: IOlVectorSource;
  let popup: HTMLElement;
  let showInfoMock: jest.Mock;

  beforeEach(() => {
    showInfoMock = jest.fn();
    window.showInfo = showInfoMock;
    pointsSrc = makeSource([
      makeFeature('p1', [10, 10]),
      makeFeature('p2', [20, 20]),
      makeFeature('p3', [200, 200]),
    ]);
    playerSrc = makeSource([makeFeature('player', [0, 0])]);
    const olMap = makeMap([makeLayer('points', pointsSrc), makeLayer('player', playerSrc)]);
    mockGetOlMap.mockResolvedValue(olMap);
    document.body.innerHTML = `
      <div class="info popup" data-guid="p1">
        <div class="i-stat">
          <button id="repair">Repair</button>
        </div>
      </div>
    `;
    popup = document.querySelector('.info.popup') as HTMLElement;
  });

  afterEach(async () => {
    await nextPointSwipeAnimation.disable();
    delete window.showInfo;
    document.body.innerHTML = '';
  });

  test('decide возвращает dismiss и сохраняет guid когда есть следующая точка', async () => {
    await nextPointSwipeAnimation.enable();
    const outcome = decideForTest();
    expect(outcome).toBe('dismiss');
    finalizeForTest();
    expect(showInfoMock).toHaveBeenCalledWith('p2');
  });

  test('decide возвращает return когда нет точек кроме текущей и native подавлен', async () => {
    mockIsModuleActive.mockImplementation((id: string) => id === 'betterNextPointSwipe');
    pointsSrc = makeSource([makeFeature('p1', [10, 10])]); // только текущая
    mockGetOlMap.mockResolvedValue(
      makeMap([makeLayer('points', pointsSrc), makeLayer('player', playerSrc)]),
    );
    await nextPointSwipeAnimation.enable();
    const outcome = decideForTest();
    expect(outcome).toBe('return');
    finalizeForTest();
    expect(showInfoMock).not.toHaveBeenCalled();
    mockIsModuleActive.mockImplementation(() => false);
  });

  test('decide возвращает return когда priority пуст и betterNext active (native подавлен)', async () => {
    // Игрок далеко от всех точек: pickNextInRange null.
    playerSrc = makeSource([makeFeature('player', [10000, 10000])]);
    mockGetOlMap.mockResolvedValue(
      makeMap([makeLayer('points', pointsSrc), makeLayer('player', playerSrc)]),
    );
    mockIsModuleActive.mockImplementation((id: string) => id === 'betterNextPointSwipe');
    await nextPointSwipeAnimation.enable();
    expect(decideForTest()).toBe('return');
    mockIsModuleActive.mockImplementation(() => false);
  });

  test('decide возвращает dismiss без pending guid когда priority пуст но native может переключить', async () => {
    // Игрок далеко от всех точек: pickNextInRange null.
    // betterNext не активен - native handler может сработать. Visible features = 3 (>1).
    playerSrc = makeSource([makeFeature('player', [10000, 10000])]);
    mockGetOlMap.mockResolvedValue(
      makeMap([makeLayer('points', pointsSrc), makeLayer('player', playerSrc)]),
    );
    mockIsModuleActive.mockImplementation(() => false);
    await nextPointSwipeAnimation.enable();
    expect(decideForTest()).toBe('dismiss');
    // Pending guid не сохранён - native сделает свой showInfo.
    finalizeForTest();
    expect(showInfoMock).not.toHaveBeenCalled();
  });

  test('decide возвращает return когда видимая точка только одна и betterNext выключен', async () => {
    // Только одна visible feature: ни native, ни мы переключить не можем.
    pointsSrc = makeSource([makeFeature('p1', [10, 10])]);
    playerSrc = makeSource([makeFeature('player', [10000, 10000])]);
    mockGetOlMap.mockResolvedValue(
      makeMap([makeLayer('points', pointsSrc), makeLayer('player', playerSrc)]),
    );
    mockIsModuleActive.mockImplementation(() => false);
    await nextPointSwipeAnimation.enable();
    expect(decideForTest()).toBe('return');
  });

  test('decide возвращает return при скрытом попапе', async () => {
    popup.classList.add('hidden');
    await nextPointSwipeAnimation.enable();
    expect(decideForTest()).toBe('return');
  });

  test('decide возвращает return без data-guid', async () => {
    delete popup.dataset.guid;
    await nextPointSwipeAnimation.enable();
    expect(decideForTest()).toBe('return');
  });

  test('второй свайп выбирает другую точку (visited tracking)', async () => {
    await nextPointSwipeAnimation.enable();
    decideForTest();
    finalizeForTest();
    expect(showInfoMock).toHaveBeenLastCalledWith('p2');

    popup.dataset.guid = 'p2';
    decideForTest();
    finalizeForTest();
    // p1 + p2 visited, в radius (45) только они - цикл сбрасывает visited,
    // оставляя p2, и возвращает p1.
    expect(showInfoMock).toHaveBeenLastCalledWith('p1');
  });

  test('finalize no-op без showInfo', async () => {
    delete window.showInfo;
    await nextPointSwipeAnimation.enable();
    decideForTest();
    expect(() => {
      finalizeForTest();
    }).not.toThrow();
  });

  test('disable очищает state - decide после disable возвращает return', async () => {
    await nextPointSwipeAnimation.enable();
    await nextPointSwipeAnimation.disable();
    expect(decideForTest()).toBe('return');
  });

  test('race-disable во время await getOlMap не регистрирует direction', async () => {
    let resolveOlMap: (m: IOlMap) => void = () => {};
    mockGetOlMap.mockReturnValue(
      new Promise<IOlMap>((resolve) => {
        resolveOlMap = resolve;
      }),
    );
    const enablePromise = nextPointSwipeAnimation.enable();
    await nextPointSwipeAnimation.disable();
    resolveOlMap(makeMap([makeLayer('points', pointsSrc), makeLayer('player', playerSrc)]));
    await enablePromise;
    // map/pointsSource не проставлены - decide return.
    expect(decideForTest()).toBe('return');
  });

  test('cycle enable -> disable -> enable не выбрасывает', async () => {
    await nextPointSwipeAnimation.enable();
    await nextPointSwipeAnimation.disable();
    await expect(nextPointSwipeAnimation.enable()).resolves.toBeUndefined();
  });
});
