import { improvedNextPointSwipe, navigateToNextPointForTest } from './improvedNextPointSwipe';
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

// Минимальный Hammer-мок для теста emit-override.
type HammerEmitFn = (this: unknown, name: string, data: unknown) => void;
let nativeHandlerCalls: { name: string; data: unknown }[] = [];

function setupHammerMock(): void {
  nativeHandlerCalls = [];
  (window as unknown as { Hammer: { Manager: { prototype: { emit: HammerEmitFn } } } }).Hammer = {
    Manager: {
      prototype: {
        emit(name: string, data: unknown): void {
          nativeHandlerCalls.push({ name, data });
        },
      },
    },
  };
}

function resetHammerMock(): void {
  delete (window as unknown as { Hammer?: unknown }).Hammer;
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

describe('improvedNextPointSwipe metadata', () => {
  test('has correct id', () => {
    expect(improvedNextPointSwipe.id).toBe('improvedNextPointSwipe');
  });

  test('is feature category', () => {
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

// ── Поведение ────────────────────────────────────────────────────────────────

describe('improvedNextPointSwipe behaviour', () => {
  let pointsSrc: IOlVectorSource;
  let playerSrc: IOlVectorSource;
  let popup: HTMLElement;
  let showInfoMock: jest.Mock;

  beforeEach(() => {
    setupHammerMock();
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
          <div class="splide" id="cores"></div>
        </div>
      </div>
    `;
    popup = document.querySelector('.info.popup') as HTMLElement;
  });

  afterEach(async () => {
    await improvedNextPointSwipe.disable();
    resetHammerMock();
    delete window.showInfo;
    document.body.innerHTML = '';
  });

  function getOverriddenEmit(): HammerEmitFn {
    return (window as unknown as { Hammer: { Manager: { prototype: { emit: HammerEmitFn } } } })
      .Hammer.Manager.prototype.emit;
  }

  test('navigateToNextPointForTest зовёт showInfo с приоритетной точкой', async () => {
    await improvedNextPointSwipe.enable();
    navigateToNextPointForTest();
    expect(showInfoMock).toHaveBeenCalledWith('p2');
  });

  test('Hammer-emit на swipeleft target=.info вызывает navigation', async () => {
    await improvedNextPointSwipe.enable();
    const emit = getOverriddenEmit();
    emit.call({}, 'swipeleft', { target: popup });
    expect(showInfoMock).toHaveBeenCalledWith('p2');
    // Нативный handler не вызвался
    expect(nativeHandlerCalls).toHaveLength(0);
  });

  test('Hammer-emit на swiperight тоже вызывает navigation', async () => {
    await improvedNextPointSwipe.enable();
    const emit = getOverriddenEmit();
    emit.call({}, 'swiperight', { target: popup });
    expect(showInfoMock).toHaveBeenCalledWith('p2');
    expect(nativeHandlerCalls).toHaveLength(0);
  });

  test('Hammer-emit на target внутри .splide пропускается к нативу', async () => {
    await improvedNextPointSwipe.enable();
    const emit = getOverriddenEmit();
    const slide = popup.querySelector('.splide') as HTMLElement;
    emit.call({}, 'swipeleft', { target: slide });
    expect(showInfoMock).not.toHaveBeenCalled();
    expect(nativeHandlerCalls).toHaveLength(1);
  });

  test('другие event names прокидываются нативному handler-у', async () => {
    await improvedNextPointSwipe.enable();
    const emit = getOverriddenEmit();
    emit.call({}, 'tap', { target: popup });
    emit.call({}, 'panstart', { target: popup });
    expect(showInfoMock).not.toHaveBeenCalled();
    expect(nativeHandlerCalls.map((c) => c.name)).toEqual(['tap', 'panstart']);
  });

  test('второй свайп открывает другую точку (visited tracking)', async () => {
    await improvedNextPointSwipe.enable();
    const emit = getOverriddenEmit();
    emit.call({}, 'swipeleft', { target: popup });
    expect(showInfoMock).toHaveBeenLastCalledWith('p2');

    popup.dataset.guid = 'p2';
    emit.call({}, 'swipeleft', { target: popup });
    // p1 и p2 visited, в radius (45) только они - цикл, p1 уже current... wait
    // Наш cycle clear-ит и оставляет p2 (current). После сброса p1 возвращается.
    expect(showInfoMock).toHaveBeenLastCalledWith('p1');
  });

  test('пропускает navigation если nextPointSwipeAnimation активен', async () => {
    mockIsModuleActive.mockImplementation((id: string) => id === 'nextPointSwipeAnimation');
    await improvedNextPointSwipe.enable();
    const emit = getOverriddenEmit();
    emit.call({}, 'swipeleft', { target: popup });
    // showInfo не вызван - предполагается что animation сделает в своём finalize
    expect(showInfoMock).not.toHaveBeenCalled();
    // Но нативный handler тоже не вызвался - мы подавляем нативный,
    // animation сам делает all dirty work.
    expect(nativeHandlerCalls).toHaveLength(0);
    mockIsModuleActive.mockImplementation(() => false);
  });

  test('disable восстанавливает оригинальный emit', async () => {
    const proto = (
      window as unknown as { Hammer: { Manager: { prototype: { emit: HammerEmitFn } } } }
    ).Hammer.Manager.prototype;
    const originalEmit = proto.emit;
    await improvedNextPointSwipe.enable();
    expect(proto.emit).not.toBe(originalEmit);
    await improvedNextPointSwipe.disable();
    expect(proto.emit).toBe(originalEmit);
  });

  test('двойной enable не дублирует override (идемпотентен)', async () => {
    const proto = (
      window as unknown as { Hammer: { Manager: { prototype: { emit: HammerEmitFn } } } }
    ).Hammer.Manager.prototype;
    const originalEmit = proto.emit;
    await improvedNextPointSwipe.enable();
    const overridden = proto.emit;
    await improvedNextPointSwipe.enable();
    expect(proto.emit).toBe(overridden);
    await improvedNextPointSwipe.disable();
    expect(proto.emit).toBe(originalEmit);
  });

  test('navigation no-op без showInfo', async () => {
    delete window.showInfo;
    await improvedNextPointSwipe.enable();
    expect(() => {
      const emit = getOverriddenEmit();
      emit.call({}, 'swipeleft', { target: popup });
    }).not.toThrow();
  });

  test('navigation no-op если попап скрыт', async () => {
    popup.classList.add('hidden');
    await improvedNextPointSwipe.enable();
    const emit = getOverriddenEmit();
    emit.call({}, 'swipeleft', { target: popup });
    expect(showInfoMock).not.toHaveBeenCalled();
  });

  test('navigation no-op если points layer не найден', async () => {
    mockGetOlMap.mockResolvedValue(makeMap([makeLayer('other', null)]));
    await improvedNextPointSwipe.enable();
    const emit = getOverriddenEmit();
    emit.call({}, 'swipeleft', { target: popup });
    expect(showInfoMock).not.toHaveBeenCalled();
    // Без points layer enable выходит до installHammerOverride - нативный
    // Hammer-handler не подавлен, и emit прокидывается на нативный mock
    // (в исходных тестах это поведение не проверялось, добавлено как
    // регрессионная защита: если кто-то перенесёт installHammerOverride
    // выше pointsLayer-check, нативный handler перестанет работать на
    // несуществующем layer).
    expect(nativeHandlerCalls).toHaveLength(1);
  });

  test('race-disable во время await getOlMap не ставит override', async () => {
    let resolveOlMap: (m: IOlMap) => void = () => {};
    mockGetOlMap.mockReturnValue(
      new Promise<IOlMap>((resolve) => {
        resolveOlMap = resolve;
      }),
    );
    const enablePromise = improvedNextPointSwipe.enable();
    await improvedNextPointSwipe.disable();
    resolveOlMap(makeMap([makeLayer('points', pointsSrc), makeLayer('player', playerSrc)]));
    await enablePromise;
    // Override не установлен - emit прокидывается нативу.
    const emit = getOverriddenEmit();
    emit.call({}, 'swipeleft', { target: popup });
    expect(showInfoMock).not.toHaveBeenCalled();
    expect(nativeHandlerCalls).toHaveLength(1);
  });
});
