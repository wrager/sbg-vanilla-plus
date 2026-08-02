import { createMarkerInterpolation } from './markerInterpolation';
import type { IMarkerInterpolation } from './markerInterpolation';

/** Евклидово расстояние: в тестах одна проецированная единица = один метр. */
function euclideanMeters(from: number[], to: number[]): number {
  return Math.hypot(to[0] - from[0], to[1] - from[1]);
}

function create(
  distanceMeters: (from: number[], to: number[]) => number = euclideanMeters,
): IMarkerInterpolation {
  return createMarkerInterpolation({
    distanceMeters,
    minDurationMs: 200,
    maxDurationMs: 2000,
    teleportDistanceMeters: 100,
    sameTargetEpsilon: 0.01,
  });
}

describe('markerInterpolation', () => {
  test('без фиксов ничего не отдаёт', () => {
    const interpolation = create();

    expect(interpolation.sample(0)).toBeNull();
    expect(interpolation.getTarget()).toBeNull();
    expect(interpolation.isAnimating(0)).toBe(false);
  });

  test('первый фикс применяется мгновенно', () => {
    const interpolation = create();

    expect(interpolation.pushFix([10, 10], 0)).toEqual({ kind: 'first', durationMs: 0 });
    expect(interpolation.sample(0)).toEqual([10, 10]);
    expect(interpolation.sample(999)).toEqual([10, 10]);
    expect(interpolation.isAnimating(999)).toBe(false);
  });

  test('второй фикс анимируется по измеренному интервалу', () => {
    const interpolation = create();
    interpolation.pushFix([0, 0], 0);

    expect(interpolation.pushFix([20, 0], 1000)).toEqual({ kind: 'animated', durationMs: 1000 });
  });

  test('интерполяция линейна и не перелетает цель', () => {
    const interpolation = create();
    interpolation.pushFix([0, 0], 0);
    interpolation.pushFix([20, 0], 1000);

    expect(interpolation.sample(1000)).toEqual([0, 0]);
    expect(interpolation.sample(1500)).toEqual([10, 0]);
    expect(interpolation.sample(2000)).toEqual([20, 0]);
    expect(interpolation.sample(6000)).toEqual([20, 0]);
  });

  test('время до начала анимации не откатывает маркер назад', () => {
    const interpolation = create();
    interpolation.pushFix([0, 0], 0);
    interpolation.pushFix([20, 0], 1000);

    expect(interpolation.sample(999)).toEqual([0, 0]);
  });

  test('слишком короткий интервал поднимается до нижнего клампа', () => {
    const interpolation = create();
    interpolation.pushFix([0, 0], 0);

    expect(interpolation.pushFix([10, 0], 50).durationMs).toBe(200);
  });

  test('слишком длинный интервал режется верхним клампом', () => {
    const interpolation = create();
    interpolation.pushFix([0, 0], 0);

    expect(interpolation.pushFix([10, 0], 10000).durationMs).toBe(2000);
  });

  test('интервал внутри клампа берётся как есть', () => {
    const interpolation = create();
    interpolation.pushFix([0, 0], 0);

    expect(interpolation.pushFix([10, 0], 1000).durationMs).toBe(1000);
  });

  test('скачок больше порога применяется мгновенно', () => {
    const interpolation = create();
    interpolation.pushFix([0, 0], 0);

    expect(interpolation.pushFix([500, 0], 1000)).toEqual({ kind: 'teleport', durationMs: 0 });
    expect(interpolation.sample(1000)).toEqual([500, 0]);
  });

  test('телепорт считается от текущей отрисованной точки, а не от прошлой цели', () => {
    // В t=1500 отрисовано [45, 0] - середина отрезка [0,0] -> [90,0].
    // [180, 0]: от отрисованной 135 м (телепорт), от прошлой цели 90 м (нет).
    expect(euclideanMeters([45, 0], [180, 0])).toBeGreaterThan(100);
    expect(euclideanMeters([90, 0], [180, 0])).toBeLessThan(100);

    const far = create();
    far.pushFix([0, 0], 0);
    far.pushFix([90, 0], 1000);

    expect(far.pushFix([180, 0], 1500).kind).toBe('teleport');

    // Обратный случай: [-50, 0] от отрисованной 95 м (анимация), от прошлой
    // цели 140 м (был бы телепорт).
    expect(euclideanMeters([45, 0], [-50, 0])).toBeLessThan(100);
    expect(euclideanMeters([90, 0], [-50, 0])).toBeGreaterThan(100);

    const near = create();
    near.pushFix([0, 0], 0);
    near.pushFix([90, 0], 1000);

    expect(near.pushFix([-50, 0], 1500).kind).toBe('animated');
  });

  test('та же координата распознаётся как перерисовка', () => {
    const interpolation = create();
    interpolation.pushFix([0, 0], 0);
    interpolation.pushFix([20, 0], 1000);

    const result = interpolation.pushFix([20.005, 0], 1500);

    expect(result.kind).toBe('redraw');
    expect(interpolation.getTarget()).toEqual([20, 0]);
    expect(interpolation.sample(1500)).toEqual([10, 0]);
    expect(interpolation.sample(2000)).toEqual([20, 0]);
  });

  test('перерисовка не сбивает измеренный такт', () => {
    const interpolation = create();
    interpolation.pushFix([0, 0], 0);
    interpolation.pushFix([10, 0], 1000);
    interpolation.pushFix([10, 0], 1500);

    expect(interpolation.pushFix([20, 0], 2000).durationMs).toBe(1000);
  });

  test('новый фикс во время анимации стартует от текущей отрисованной точки', () => {
    const interpolation = create();
    interpolation.pushFix([0, 0], 0);
    interpolation.pushFix([40, 0], 1000);

    interpolation.pushFix([80, 0], 1500);

    // Отрисованная точка в момент фикса - [20, 0]. Старт от прошлой цели дал бы
    // прыжок вперёд в [40, 0], старт от начала отрезка - откат в [0, 0].
    expect(interpolation.sample(1500)).toEqual([20, 0]);
    expect(interpolation.sample(1750)).toEqual([50, 0]);
    expect(interpolation.sample(2000)).toEqual([80, 0]);
  });

  test('серия фиксов не увеличивает расстояние до текущей цели', () => {
    const interpolation = create();
    interpolation.pushFix([0, 0], 0);

    let previousDistance = Infinity;
    for (let fix = 1; fix <= 5; fix++) {
      const time = fix * 1000;
      interpolation.pushFix([fix * 10, 0], time);
      const target = interpolation.getTarget();
      if (!target) throw new Error('цель обязана существовать после фикса');
      previousDistance = Infinity;
      for (let frame = 0; frame <= 10; frame++) {
        const rendered = interpolation.sample(time + frame * 100);
        if (!rendered) throw new Error('координата обязана существовать после фикса');
        const distance = euclideanMeters(rendered, target);
        expect(distance).toBeLessThanOrEqual(previousDistance);
        previousDistance = distance;
      }
    }
  });

  test('isAnimating истинно только внутри интервала анимации', () => {
    const interpolation = create();
    interpolation.pushFix([0, 0], 0);
    interpolation.pushFix([10, 0], 1000);

    expect(interpolation.isAnimating(1000)).toBe(true);
    expect(interpolation.isAnimating(1999)).toBe(true);
    expect(interpolation.isAnimating(2000)).toBe(false);
    expect(interpolation.isAnimating(5000)).toBe(false);
  });

  test('reset возвращает состояние к пустому', () => {
    const interpolation = create();
    interpolation.pushFix([0, 0], 0);
    interpolation.pushFix([10, 0], 1000);

    interpolation.reset();

    expect(interpolation.sample(1500)).toBeNull();
    expect(interpolation.getTarget()).toBeNull();
    expect(interpolation.pushFix([10, 0], 2000).kind).toBe('first');
  });

  test('недоступная метрика расстояния превращает фиксы в мгновенные', () => {
    const interpolation = create(() => Infinity);
    interpolation.pushFix([0, 0], 0);

    expect(interpolation.pushFix([1, 0], 1000).kind).toBe('teleport');
    expect(interpolation.pushFix([2, 0], 2000).kind).toBe('teleport');
  });

  test('цель не связана с массивом вызывающей стороны', () => {
    const interpolation = create();
    const coords = [10, 10];
    interpolation.pushFix(coords, 0);

    coords[0] = 999;

    expect(interpolation.getTarget()).toEqual([10, 10]);
  });

  test('нулевая длительность не ломает выборку', () => {
    const interpolation = create();
    interpolation.pushFix([5, 5], 0);

    expect(interpolation.sample(0)).toEqual([5, 5]);
    expect(interpolation.sample(1e6)).toEqual([5, 5]);
    expect(interpolation.isAnimating(0)).toBe(false);
  });
});
