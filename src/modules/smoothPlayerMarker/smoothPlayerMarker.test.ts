import { smoothPlayerMarker } from './smoothPlayerMarker';
import type { IOlLayer, IOlMap, IOlPointGeometry, IOlView } from '../../core/olMap';

jest.mock('../../core/olMap', () => {
  const actual = jest.requireActual<typeof import('../../core/olMap')>('../../core/olMap');
  return { ...actual, getOlMap: jest.fn() };
});

import { getOlMap } from '../../core/olMap';

const mockGetOlMap = getOlMap as jest.MockedFunction<typeof getOlMap>;

const FIX_INTERVAL_MS = 1000;

interface IStyleMock {
  getGeometry: jest.Mock;
  setGeometry: jest.Mock;
}

interface ICircleMock {
  getCenter: jest.Mock;
  setCenter: jest.Mock;
  setRadius: jest.Mock;
}

interface IWorld {
  map: IOlMap;
  view: IOlView & { setCenter: jest.Mock; getCenter: jest.Mock; getInteracting: jest.Mock };
  originalSetCenter: jest.Mock;
  icon: IStyleMock & { getImage: jest.Mock };
  circles: ICircleMock[];
  changed: jest.Mock;
  setCoordinatesCalls: number[][];
  featureCoordinates: number[];
  point: IOlPointGeometry | null;
}

let world: IWorld;
let currentTime: number;
let frameCallbacks: FrameRequestCallback[];

function makeCircle(): ICircleMock {
  let center = [0, 0];
  return {
    getCenter: jest.fn(() => center),
    setCenter: jest.fn((next: number[]) => {
      center = next;
    }),
    setRadius: jest.fn(),
  };
}

function makeWorld(): IWorld {
  let iconGeometry: unknown = undefined;
  const icon = {
    getGeometry: jest.fn(() => iconGeometry),
    setGeometry: jest.fn((next: unknown) => {
      iconGeometry = next;
    }),
    getImage: jest.fn(),
  };
  const circles = [makeCircle(), makeCircle(), makeCircle()];
  const setCoordinatesCalls: number[][] = [];
  const changed = jest.fn();

  const built: IWorld = {
    map: null as unknown as IOlMap,
    view: null as unknown as IWorld['view'],
    originalSetCenter: jest.fn(),
    icon,
    circles,
    changed,
    setCoordinatesCalls,
    featureCoordinates: [0, 0],
    point: null,
  };

  const feature = {
    getGeometry: () => ({
      getCoordinates: () => built.featureCoordinates,
      setCoordinates: (next: number[]) => {
        setCoordinatesCalls.push(next);
      },
    }),
    getId: () => 'player',
    setStyle: jest.fn(),
    getStyle: () => [
      icon,
      { getGeometry: () => circles[0] },
      { getGeometry: () => circles[1] },
      { getGeometry: () => circles[2] },
    ],
    changed,
  };

  const playerLayer = {
    get: (key: string) => (key === 'name' ? 'player' : undefined),
    getSource: () => ({
      getFeatures: () => [feature],
      addFeature: jest.fn(),
      clear: jest.fn(),
      on: jest.fn(),
      un: jest.fn(),
    }),
  } as unknown as IOlLayer;

  const view = {
    padding: [0, 0, 0, 0],
    getCenter: jest.fn(() => [0, 0]),
    setCenter: built.originalSetCenter,
    calculateExtent: jest.fn(),
    changed: jest.fn(),
    getRotation: jest.fn(() => 0),
    setRotation: jest.fn(),
    getResolution: jest.fn(() => 1),
    getInteracting: jest.fn(() => false),
  } as unknown as IWorld['view'];

  built.view = view;
  built.map = {
    getView: () => view,
    getSize: () => [400, 800],
    getLayers: () => ({ getArray: () => [playerLayer] }),
    getInteractions: () => ({ getArray: () => [] }),
    addLayer: jest.fn(),
    removeLayer: jest.fn(),
    updateSize: jest.fn(),
  } as unknown as IOlMap;

  return built;
}

function makePoint(coordinate: number[]): IOlPointGeometry {
  let current = coordinate.slice();
  return {
    getCoordinates: () => current,
    setCoordinates: (next: number[]) => {
      current = next.slice();
    },
  };
}

/** Событие playermove: игра диспатчит его после записи координат в фичу. */
async function emitFix(coordinate: number[], atTime: number): Promise<void> {
  currentTime = atTime;
  world.featureCoordinates = coordinate;
  document.querySelector('.info.popup')?.dispatchEvent(new Event('playermove'));
  // Синхронный хвост movePlayer: игра центрует карту, если включено следование.
  await Promise.resolve();
}

function emitFixWithFollow(coordinate: number[], atTime: number): void {
  currentTime = atTime;
  world.featureCoordinates = coordinate;
  document.querySelector('.info.popup')?.dispatchEvent(new Event('playermove'));
  world.view.setCenter(coordinate);
}

function runFrame(atTime: number): void {
  currentTime = atTime;
  const callbacks = frameCallbacks;
  frameCallbacks = [];
  for (const callback of callbacks) callback(atTime);
}

function lastRenderedCoordinate(): number[] | null {
  const calls = world.circles[0].setCenter.mock.calls as number[][][];
  return calls.length ? calls[calls.length - 1][0] : null;
}

beforeEach(() => {
  document.body.innerHTML = '<div class="info popup"></div><div class="navi-floater"></div>';
  world = makeWorld();
  currentTime = 0;
  frameCallbacks = [];

  mockGetOlMap.mockResolvedValue(world.map);
  jest.spyOn(performance, 'now').mockImplementation(() => currentTime);
  jest.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    frameCallbacks.push(callback);
    return frameCallbacks.length;
  });
  jest.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {
    frameCallbacks = [];
  });
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});

  window.ol = {
    geom: {
      Point: jest.fn().mockImplementation((coords: number[]) => {
        world.point = makePoint(coords);
        return world.point;
      }),
      LineString: jest.fn().mockImplementation((coords: number[][]) => ({ coords })),
    },
    sphere: {
      getLength: (geometry: unknown) => {
        const { coords } = geometry as { coords: number[][] };
        return Math.hypot(coords[1][0] - coords[0][0], coords[1][1] - coords[0][1]);
      },
    },
  } as unknown as typeof window.ol;
});

afterEach(async () => {
  await smoothPlayerMarker.disable();
  jest.restoreAllMocks();
  delete window.ol;
  document.body.innerHTML = '';
});

describe('smoothPlayerMarker metadata', () => {
  test('идентификатор и категория', () => {
    expect(smoothPlayerMarker.id).toBe('smoothPlayerMarker');
    expect(smoothPlayerMarker.category).toBe('map');
  });

  test('включён по умолчанию', () => {
    expect(smoothPlayerMarker.defaultEnabled).toBe(true);
  });

  test('название и описание локализованы', () => {
    expect(smoothPlayerMarker.name.ru).toBeTruthy();
    expect(smoothPlayerMarker.name.en).toBeTruthy();
    expect(smoothPlayerMarker.description.ru).toBeTruthy();
    expect(smoothPlayerMarker.description.en).toBeTruthy();
  });
});

describe('smoothPlayerMarker установка и снятие', () => {
  test('enable подписывается на playermove и оборачивает setCenter', async () => {
    await smoothPlayerMarker.enable();

    expect(world.view.setCenter).not.toBe(world.originalSetCenter);

    await emitFix([0, 0], 0);
    expect(world.changed).toHaveBeenCalled();
  });

  test('init ничего не устанавливает', () => {
    void smoothPlayerMarker.init();

    expect(world.view.setCenter).toBe(world.originalSetCenter);
  });

  test('disable возвращает исходный setCenter по ссылке', async () => {
    await smoothPlayerMarker.enable();

    await smoothPlayerMarker.disable();

    expect(world.view.setCenter).toBe(world.originalSetCenter);
  });

  test('переживает три цикла включения и выключения', async () => {
    for (let cycle = 0; cycle < 3; cycle++) {
      await smoothPlayerMarker.enable();
      await emitFix([cycle, 0], cycle * FIX_INTERVAL_MS);
      await smoothPlayerMarker.disable();
    }

    expect(world.view.setCenter).toBe(world.originalSetCenter);

    world.changed.mockClear();
    await emitFix([9, 9], 9000);

    expect(world.changed).not.toHaveBeenCalled();
    expect(frameCallbacks).toHaveLength(0);
  });

  test('выключение до захвата карты отменяет установку', async () => {
    let resolveMap: (map: IOlMap) => void = () => {};
    mockGetOlMap.mockReturnValue(
      new Promise<IOlMap>((resolve) => {
        resolveMap = resolve;
      }),
    );

    const enabling = smoothPlayerMarker.enable();
    await smoothPlayerMarker.disable();
    resolveMap(world.map);
    await enabling;

    expect(world.view.setCenter).toBe(world.originalSetCenter);
    world.changed.mockClear();
    await emitFix([1, 1], 0);
    expect(world.changed).not.toHaveBeenCalled();
  });

  test('без слоя игрока модуль не включается', async () => {
    const emptyMap = {
      ...world.map,
      getLayers: () => ({ getArray: () => [] }),
      getView: () => world.view,
    } as unknown as IOlMap;
    mockGetOlMap.mockResolvedValue(emptyMap);

    await smoothPlayerMarker.enable();

    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(world.view.setCenter).toBe(world.originalSetCenter);
    expect(() => smoothPlayerMarker.disable()).not.toThrow();
  });

  test('без попапа точки слушатель вешается на плашку навигации', async () => {
    document.body.innerHTML = '<div class="navi-floater"></div>';

    await smoothPlayerMarker.enable();
    world.featureCoordinates = [5, 5];
    document.querySelector('.navi-floater')?.dispatchEvent(new Event('playermove'));

    expect(world.changed).toHaveBeenCalled();
  });

  test('без приёмника события модуль не включается', async () => {
    document.body.innerHTML = '';

    await smoothPlayerMarker.enable();

    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(world.view.setCenter).toBe(world.originalSetCenter);
  });
});

describe('smoothPlayerMarker рендер', () => {
  test('игровая позиция никогда не переписывается', async () => {
    await smoothPlayerMarker.enable();

    await emitFix([0, 0], 0);
    await emitFix([10, 0], FIX_INTERVAL_MS);
    for (let frame = 1; frame <= 5; frame++) runFrame(FIX_INTERVAL_MS + frame * 100);
    await emitFix([20, 0], 2 * FIX_INTERVAL_MS);
    for (let frame = 1; frame <= 5; frame++) runFrame(2 * FIX_INTERVAL_MS + frame * 100);

    expect(world.setCoordinatesCalls).toEqual([]);
    expect(world.featureCoordinates).toEqual([20, 0]);
  });

  test('первый фикс применяется мгновенно и без кадров', async () => {
    await smoothPlayerMarker.enable();

    await emitFix([3, 4], 0);

    expect(world.icon.setGeometry).toHaveBeenCalledTimes(1);
    expect(world.point?.getCoordinates()).toEqual([3, 4]);
    for (const circle of world.circles) {
      expect(circle.setCenter).toHaveBeenLastCalledWith([3, 4]);
    }
    expect(world.changed).toHaveBeenCalledTimes(1);
    expect(frameCallbacks).toHaveLength(0);
  });

  test('второй фикс едет к цели по кадрам', async () => {
    await smoothPlayerMarker.enable();
    await emitFix([0, 0], 0);

    await emitFix([10, 0], FIX_INTERVAL_MS);
    expect(frameCallbacks).toHaveLength(1);

    runFrame(FIX_INTERVAL_MS + 500);

    expect(lastRenderedCoordinate()).toEqual([5, 0]);
    expect(world.point?.getCoordinates()).toEqual([5, 0]);
  });

  test('последний кадр ставит точную цель и останавливает цикл', async () => {
    await smoothPlayerMarker.enable();
    await emitFix([0, 0], 0);
    await emitFix([10, 0], FIX_INTERVAL_MS);

    runFrame(FIX_INTERVAL_MS + 500);
    runFrame(2 * FIX_INTERVAL_MS);

    expect(lastRenderedCoordinate()).toEqual([10, 0]);
    expect(frameCallbacks).toHaveLength(0);
  });

  test('геометрия стиля устанавливается один раз за анимацию', async () => {
    await smoothPlayerMarker.enable();
    await emitFix([0, 0], 0);
    await emitFix([10, 0], FIX_INTERVAL_MS);

    runFrame(FIX_INTERVAL_MS + 300);
    runFrame(FIX_INTERVAL_MS + 600);
    runFrame(2 * FIX_INTERVAL_MS);

    expect(world.icon.setGeometry).toHaveBeenCalledTimes(1);
  });

  test('перерисовка той же координаты не меняет ход анимации', async () => {
    await smoothPlayerMarker.enable();
    await emitFix([0, 0], 0);
    await emitFix([10, 0], FIX_INTERVAL_MS);
    runFrame(FIX_INTERVAL_MS + 500);

    await emitFix([10, 0], FIX_INTERVAL_MS + 500);
    runFrame(FIX_INTERVAL_MS + 750);

    expect(lastRenderedCoordinate()).toEqual([7.5, 0]);
  });

  test('телепорт применяется мгновенно и не планирует кадры', async () => {
    await smoothPlayerMarker.enable();
    await emitFix([0, 0], 0);

    await emitFix([500, 0], FIX_INTERVAL_MS);

    expect(lastRenderedCoordinate()).toEqual([500, 0]);
    expect(frameCallbacks).toHaveLength(0);
  });

  test('кадр после долгой паузы ставит цель и не планирует следующий', async () => {
    await smoothPlayerMarker.enable();
    await emitFix([0, 0], 0);
    await emitFix([10, 0], FIX_INTERVAL_MS);

    runFrame(FIX_INTERVAL_MS + 5000);

    expect(lastRenderedCoordinate()).toEqual([10, 0]);
    expect(frameCallbacks).toHaveLength(0);
  });

  test('несколько фиксов внутри одного кадра ведут к последней цели', async () => {
    await smoothPlayerMarker.enable();
    await emitFix([0, 0], 0);
    await emitFix([10, 0], FIX_INTERVAL_MS);
    await emitFix([20, 0], FIX_INTERVAL_MS + 10);
    await emitFix([30, 0], FIX_INTERVAL_MS + 20);

    runFrame(FIX_INTERVAL_MS + 220);

    expect(lastRenderedCoordinate()).toEqual([30, 0]);
    expect(frameCallbacks).toHaveLength(0);
  });

  test('субпиксельный сдвиг не вызывает перерисовку, а последний кадр вызывает', async () => {
    world.view.getResolution = jest.fn(() => 1000);
    await smoothPlayerMarker.enable();
    await emitFix([0, 0], 0);
    await emitFix([10, 0], FIX_INTERVAL_MS);
    world.changed.mockClear();

    runFrame(FIX_INTERVAL_MS + 100);
    expect(world.changed).not.toHaveBeenCalled();
    expect(frameCallbacks).toHaveLength(1);

    runFrame(2 * FIX_INTERVAL_MS);
    expect(world.changed).toHaveBeenCalledTimes(1);
    expect(lastRenderedCoordinate()).toEqual([10, 0]);
  });

  test('без разрешения карты пропуск кадров отключён', async () => {
    world.view.getResolution = undefined as unknown as IOlView['getResolution'];
    await smoothPlayerMarker.enable();
    await emitFix([0, 0], 0);
    await emitFix([10, 0], FIX_INTERVAL_MS);
    world.changed.mockClear();

    runFrame(FIX_INTERVAL_MS + 1);

    expect(world.changed).toHaveBeenCalledTimes(1);
  });

  test('иконка и радиусы кругов остаются игровыми', async () => {
    await smoothPlayerMarker.enable();
    await emitFix([0, 0], 0);
    await emitFix([10, 0], FIX_INTERVAL_MS);
    runFrame(FIX_INTERVAL_MS + 500);

    expect(world.icon.getImage).not.toHaveBeenCalled();
    for (const circle of world.circles) {
      expect(circle.setRadius).not.toHaveBeenCalled();
    }
  });
});

describe('smoothPlayerMarker следование за игроком', () => {
  test('игровое центрирование перенаправляется на интерполированную точку', async () => {
    await smoothPlayerMarker.enable();
    await emitFix([0, 0], 0);
    await emitFix([10, 0], FIX_INTERVAL_MS);
    world.originalSetCenter.mockClear();

    // Игра центрует карту синхронно после dispatch, уже во время анимации.
    currentTime = FIX_INTERVAL_MS + 200;
    world.featureCoordinates = [20, 0];
    document.querySelector('.info.popup')?.dispatchEvent(new Event('playermove'));
    world.view.setCenter([20, 0]);

    expect(world.originalSetCenter).toHaveBeenCalledTimes(1);
    const calls = world.originalSetCenter.mock.calls as number[][][];
    expect(calls[0][0]).not.toEqual([20, 0]);
  });

  test('после перехвата центрирования кадры ведут центр сами', async () => {
    await smoothPlayerMarker.enable();
    await emitFix([0, 0], 0);
    emitFixWithFollow([10, 0], FIX_INTERVAL_MS);
    await Promise.resolve();
    world.originalSetCenter.mockClear();

    runFrame(FIX_INTERVAL_MS + 500);

    expect(world.originalSetCenter).toHaveBeenCalledWith([5, 0]);
  });

  test('чужая координата центрирования проходит насквозь', async () => {
    await smoothPlayerMarker.enable();
    await emitFix([0, 0], 0);
    await emitFix([10, 0], FIX_INTERVAL_MS);
    world.originalSetCenter.mockClear();

    world.view.setCenter([999, 999]);

    expect(world.originalSetCenter).toHaveBeenCalledWith([999, 999]);
  });

  test('центрирование вне окна фикса проходит насквозь', async () => {
    await smoothPlayerMarker.enable();
    await emitFix([0, 0], 0);
    await emitFix([10, 0], FIX_INTERVAL_MS);
    world.originalSetCenter.mockClear();

    world.view.setCenter([10, 0]);

    expect(world.originalSetCenter).toHaveBeenCalledWith([10, 0]);
  });

  test('на первом фиксе карту центрует сама игра', async () => {
    await smoothPlayerMarker.enable();
    world.originalSetCenter.mockClear();

    emitFixWithFollow([7, 7], 0);
    await Promise.resolve();

    expect(world.originalSetCenter).toHaveBeenCalledWith([7, 7]);
  });

  test('без игрового центрирования кадры не трогают центр', async () => {
    await smoothPlayerMarker.enable();
    await emitFix([0, 0], 0);
    await emitFix([10, 0], FIX_INTERVAL_MS);
    world.originalSetCenter.mockClear();

    runFrame(FIX_INTERVAL_MS + 500);

    expect(world.originalSetCenter).not.toHaveBeenCalled();
  });

  test('следование сбрасывается, если на новом фиксе игра не центровала', async () => {
    await smoothPlayerMarker.enable();
    await emitFix([0, 0], 0);
    emitFixWithFollow([10, 0], FIX_INTERVAL_MS);
    await Promise.resolve();

    await emitFix([20, 0], 2 * FIX_INTERVAL_MS);
    world.originalSetCenter.mockClear();
    runFrame(2 * FIX_INTERVAL_MS + 500);

    expect(world.originalSetCenter).not.toHaveBeenCalled();
  });

  test('жест пользователя отпускает центр до следующего фикса', async () => {
    await smoothPlayerMarker.enable();
    await emitFix([0, 0], 0);
    emitFixWithFollow([10, 0], FIX_INTERVAL_MS);
    await Promise.resolve();
    world.originalSetCenter.mockClear();

    world.view.getInteracting = jest.fn(() => true);
    runFrame(FIX_INTERVAL_MS + 300);
    world.view.getInteracting = jest.fn(() => false);
    runFrame(FIX_INTERVAL_MS + 600);

    expect(world.originalSetCenter).not.toHaveBeenCalled();
  });

  test('угнанная далеко карта доворачивается мгновенно', async () => {
    await smoothPlayerMarker.enable();
    await emitFix([0, 0], 0);
    await emitFix([10, 0], FIX_INTERVAL_MS);
    world.view.getCenter = jest.fn(() => [5000, 0]);
    world.originalSetCenter.mockClear();

    currentTime = FIX_INTERVAL_MS + 200;
    world.featureCoordinates = [20, 0];
    document.querySelector('.info.popup')?.dispatchEvent(new Event('playermove'));
    world.view.setCenter([20, 0]);

    expect(world.originalSetCenter).toHaveBeenCalledWith([20, 0]);
  });

  test('неизвестный центр карты не мешает центрированию', async () => {
    await smoothPlayerMarker.enable();
    await emitFix([0, 0], 0);
    await emitFix([10, 0], FIX_INTERVAL_MS);
    world.view.getCenter = jest.fn(() => undefined);
    world.originalSetCenter.mockClear();

    currentTime = FIX_INTERVAL_MS + 200;
    world.featureCoordinates = [20, 0];
    document.querySelector('.info.popup')?.dispatchEvent(new Event('playermove'));

    expect(() => {
      world.view.setCenter([20, 0]);
    }).not.toThrow();
    expect(world.originalSetCenter).toHaveBeenCalledTimes(1);
  });
});

describe('smoothPlayerMarker ошибки', () => {
  test('чужая структура стилей логируется один раз и не меняет рендер', async () => {
    await smoothPlayerMarker.enable();
    const feature = world.map
      .getLayers()
      .getArray()[0]
      .getSource()
      ?.getFeatures()[0] as unknown as { getStyle: () => unknown };
    feature.getStyle = () => [{}];

    for (let fix = 0; fix < 5; fix++) await emitFix([fix, 0], fix * FIX_INTERVAL_MS);

    expect(console.error).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('[SVP smoothPlayerMarker]'),
      expect.anything(),
    );
    expect(world.icon.setGeometry).not.toHaveBeenCalled();
  });

  test('падение на кадре откатывает рендер к нативному', async () => {
    await smoothPlayerMarker.enable();
    await emitFix([0, 0], 0);
    await emitFix([10, 0], FIX_INTERVAL_MS);
    world.circles[1].setCenter.mockImplementationOnce(() => {
      throw new Error('circle failed');
    });

    expect(() => {
      runFrame(FIX_INTERVAL_MS + 500);
    }).not.toThrow();

    expect(console.error).toHaveBeenCalledTimes(1);
    expect(frameCallbacks).toHaveLength(0);
    expect(world.icon.setGeometry).toHaveBeenLastCalledWith(undefined);
  });

  test('падение в обработчике не выходит в игру', async () => {
    await smoothPlayerMarker.enable();
    const feature = world.map
      .getLayers()
      .getArray()[0]
      .getSource()
      ?.getFeatures()[0] as unknown as { getGeometry: () => never };
    feature.getGeometry = () => {
      throw new Error('geometry failed');
    };

    expect(() =>
      document.querySelector('.info.popup')?.dispatchEvent(new Event('playermove')),
    ).not.toThrow();
    expect(console.error).toHaveBeenCalledTimes(1);
  });

  test('падение внутри обёртки не оставляет игру без центрирования', async () => {
    await smoothPlayerMarker.enable();
    await emitFix([0, 0], 0);
    await emitFix([10, 0], FIX_INTERVAL_MS);
    world.view.getCenter = jest.fn(() => {
      throw new Error('center failed');
    });
    world.originalSetCenter.mockClear();

    currentTime = FIX_INTERVAL_MS + 200;
    world.featureCoordinates = [20, 0];
    document.querySelector('.info.popup')?.dispatchEvent(new Event('playermove'));
    world.view.setCenter([20, 0]);

    expect(console.error).toHaveBeenCalledTimes(1);
    expect(world.originalSetCenter).toHaveBeenCalledWith([20, 0]);
  });

  test('disable не бросает, если перерисовка падает', async () => {
    await smoothPlayerMarker.enable();
    await emitFix([0, 0], 0);
    world.changed.mockImplementation(() => {
      throw new Error('changed failed');
    });

    expect(() => smoothPlayerMarker.disable()).not.toThrow();
    expect(world.view.setCenter).toBe(world.originalSetCenter);
  });

  test('повторное включение снова разрешает лог ошибки', async () => {
    await smoothPlayerMarker.enable();
    const source = world.map.getLayers().getArray()[0].getSource();
    const feature = source?.getFeatures()[0] as unknown as { getStyle: () => unknown };
    const originalGetStyle = feature.getStyle;
    feature.getStyle = () => [{}];
    await emitFix([0, 0], 0);
    expect(console.error).toHaveBeenCalledTimes(1);

    await smoothPlayerMarker.disable();
    await smoothPlayerMarker.enable();
    await emitFix([1, 0], FIX_INTERVAL_MS);

    expect(console.error).toHaveBeenCalledTimes(2);
    feature.getStyle = originalGetStyle;
  });
});
