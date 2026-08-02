import {
  applyRenderedPosition,
  createInterpolatedPoint,
  resolvePlayerMarkerStyles,
  restoreNativeRendering,
} from './playerMarkerStyles';
import type { IOlFeature, IOlPointGeometry } from '../../core/olMap';

interface IMockCircle {
  getCenter: jest.Mock<number[], []>;
  setCenter: jest.Mock<void, [number[]]>;
}

interface IMockFeature extends IOlFeature {
  setCoordinatesCalls: number[][];
  changed: jest.Mock<void, []>;
  icon: { getGeometry: jest.Mock<unknown, []>; setGeometry: jest.Mock<void, [unknown]> };
  circles: IMockCircle[];
}

function makeCircle(center: number[] = [0, 0]): IMockCircle {
  let current = center;
  return {
    getCenter: jest.fn(() => current),
    setCenter: jest.fn((next: number[]) => {
      current = next;
    }),
  };
}

function makeIcon(): IMockFeature['icon'] {
  let geometry: unknown = undefined;
  return {
    getGeometry: jest.fn(() => geometry),
    setGeometry: jest.fn((next: unknown) => {
      geometry = next;
    }),
  };
}

function makeFeature(coordinates: number[] = [10, 20]): IMockFeature {
  const icon = makeIcon();
  const circles = [makeCircle(), makeCircle(), makeCircle()];
  const setCoordinatesCalls: number[][] = [];
  const styles = [
    icon,
    { getGeometry: () => circles[0] },
    { getGeometry: () => circles[1] },
    { getGeometry: () => circles[2] },
  ];
  const feature = {
    getGeometry: () => ({
      getCoordinates: () => coordinates,
      setCoordinates: (next: number[]) => {
        setCoordinatesCalls.push(next);
      },
    }),
    getId: () => undefined,
    setStyle: jest.fn(),
    getStyle: () => styles,
    changed: jest.fn(),
    setCoordinatesCalls,
    icon,
    circles,
  };
  return feature as unknown as IMockFeature;
}

function makePoint(coordinate: number[]): IOlPointGeometry {
  let current = coordinate;
  return {
    getCoordinates: () => current,
    setCoordinates: (next: number[]) => {
      current = next;
    },
  };
}

describe('resolvePlayerMarkerStyles', () => {
  test('разбирает штатную структуру стилей игрока', () => {
    const feature = makeFeature();

    const styles = resolvePlayerMarkerStyles(feature);

    expect(styles).not.toBeNull();
    expect(styles?.icon).toBe(feature.icon);
    expect(styles?.circles).toHaveLength(3);
  });

  test.each([
    ['null', null],
    ['не массив', {}],
    ['слишком короткий массив', [{}, {}]],
  ])('отдаёт null, если getStyle вернул %s', (_name, style) => {
    const feature = makeFeature();
    (feature as unknown as { getStyle: () => unknown }).getStyle = () => style;

    expect(resolvePlayerMarkerStyles(feature)).toBeNull();
  });

  test('отдаёт null, если у фичи нет getStyle', () => {
    const feature = makeFeature();
    delete (feature as unknown as { getStyle?: () => unknown }).getStyle;

    expect(resolvePlayerMarkerStyles(feature)).toBeNull();
  });

  test('отдаёт null, если у иконки нет setGeometry', () => {
    const feature = makeFeature();
    const styles = feature.getStyle?.() as unknown[];
    styles[0] = { getGeometry: () => undefined };

    expect(resolvePlayerMarkerStyles(feature)).toBeNull();
  });

  test('отдаёт null, если геометрия круга не умеет двигать центр', () => {
    const feature = makeFeature();
    const styles = feature.getStyle?.() as unknown[];
    styles[2] = { getGeometry: () => ({ getCenter: () => [0, 0] }) };

    expect(resolvePlayerMarkerStyles(feature)).toBeNull();
  });
});

describe('createInterpolatedPoint', () => {
  afterEach(() => {
    delete window.ol;
  });

  test('отдаёт null без ol, не бросая исключение', () => {
    delete window.ol;

    expect(createInterpolatedPoint([1, 2])).toBeNull();
  });

  test('создаёт точку через ol.geom.Point', () => {
    const Point = jest.fn().mockImplementation((coords: number[]) => makePoint(coords));
    window.ol = { geom: { Point } } as unknown as typeof window.ol;

    const point = createInterpolatedPoint([1, 2]);

    expect(Point).toHaveBeenCalledWith([1, 2]);
    expect(point?.getCoordinates()).toEqual([1, 2]);
  });
});

describe('applyRenderedPosition', () => {
  test('двигает иконку и все три круга и просит перерисовку', () => {
    const feature = makeFeature();
    const styles = resolvePlayerMarkerStyles(feature);
    if (!styles) throw new Error('стили обязаны разобраться');
    const point = makePoint([0, 0]);

    applyRenderedPosition(feature, styles, point, [5, 7]);

    expect(point.getCoordinates()).toEqual([5, 7]);
    expect(feature.icon.setGeometry).toHaveBeenCalledTimes(1);
    expect(feature.icon.setGeometry).toHaveBeenCalledWith(point);
    for (const circle of feature.circles) {
      expect(circle.setCenter).toHaveBeenCalledWith([5, 7]);
    }
    expect(feature.changed).toHaveBeenCalledTimes(1);
  });

  test('повторный кадр не переустанавливает геометрию стиля', () => {
    const feature = makeFeature();
    const styles = resolvePlayerMarkerStyles(feature);
    if (!styles) throw new Error('стили обязаны разобраться');
    const point = makePoint([0, 0]);

    applyRenderedPosition(feature, styles, point, [5, 7]);
    applyRenderedPosition(feature, styles, point, [6, 8]);

    expect(feature.icon.setGeometry).toHaveBeenCalledTimes(1);
    expect(point.getCoordinates()).toEqual([6, 8]);
    for (const circle of feature.circles) {
      expect(circle.setCenter).toHaveBeenLastCalledWith([6, 8]);
    }
    expect(feature.changed).toHaveBeenCalledTimes(2);
  });
});

describe('restoreNativeRendering', () => {
  test('возвращает иконке геометрию фичи, а круги - на реальный фикс', () => {
    const feature = makeFeature([11, 22]);
    const styles = resolvePlayerMarkerStyles(feature);
    if (!styles) throw new Error('стили обязаны разобраться');
    applyRenderedPosition(feature, styles, makePoint([0, 0]), [5, 7]);

    restoreNativeRendering(feature, styles);

    expect(feature.icon.setGeometry).toHaveBeenLastCalledWith(undefined);
    for (const circle of feature.circles) {
      expect(circle.setCenter).toHaveBeenLastCalledWith([11, 22]);
    }
    expect(feature.changed).toHaveBeenCalledTimes(2);
  });

  test('возвращает нативный рендер и до первого кадра сглаживания', () => {
    const feature = makeFeature([11, 22]);
    const styles = resolvePlayerMarkerStyles(feature);
    if (!styles) throw new Error('стили обязаны разобраться');

    restoreNativeRendering(feature, styles);

    expect(feature.icon.setGeometry).toHaveBeenCalledWith(undefined);
    for (const circle of feature.circles) {
      expect(circle.setCenter).toHaveBeenCalledWith([11, 22]);
    }
  });
});

describe('инвариант игровой позиции', () => {
  test('ни одна операция не пишет координаты в геометрию фичи', () => {
    const feature = makeFeature();
    const styles = resolvePlayerMarkerStyles(feature);
    if (!styles) throw new Error('стили обязаны разобраться');
    const point = makePoint([0, 0]);

    applyRenderedPosition(feature, styles, point, [5, 7]);
    applyRenderedPosition(feature, styles, point, [6, 8]);
    restoreNativeRendering(feature, styles);

    expect(feature.setCoordinatesCalls).toEqual([]);
  });
});
