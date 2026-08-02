/**
 * Ядро плавного движения маркера: чистая арифметика интерполяции без OL, DOM
 * и собственных часов - время приходит аргументом в pushFix/sample. Благодаря
 * этому вся политика (кламп длительности, порог телепорта, распознавание
 * перерисовки) тестируется вызовами с числами.
 *
 * Отличия от реализации CUI (refs/cui/index.js:737-842):
 * - анимация стартует от текущей отрисованной точки, а не от предыдущей цели
 *   (у CUI новый фикс во время анимации откидывает маркер назад);
 * - длительность равна измеренному интервалу между фиксами, а не фиксированной
 *   секунде;
 * - повторный movePlayer с той же координатой (перерисовки игры,
 *   refs/game/script.js:1565, 1606, 1807, 1825) не считается фиксом.
 */

export type FixKind =
  /** Первый фикс за включение: анимировать не от чего, рисуем сразу. */
  | 'first'
  /** Скачок больше порога: линейный слайд читался бы как глитч, рисуем сразу. */
  | 'teleport'
  /** Та же координата: игра перерисовывает маркер, цель и такт не трогаем. */
  | 'redraw'
  /** Обычный фикс: едем от текущей отрисованной точки к новой. */
  | 'animated';

export interface IFixResult {
  kind: FixKind;
  /** Длительность анимации, мс. Ноль для first, teleport и остановленной redraw. */
  durationMs: number;
}

export interface IMarkerInterpolationOptions {
  /**
   * Расстояние в метрах между двумя проецированными координатами (EPSG:3857).
   * В продакшене - getGeodeticDistance, тот же ol.sphere, что у игры в
   * isInRange. Инъекция нужна, чтобы ядро не зависело от window.ol и чтобы
   * порог телепорта не плыл по широте.
   */
  distanceMeters(from: number[], to: number[]): number;
  minDurationMs: number;
  maxDurationMs: number;
  teleportDistanceMeters: number;
  /** Порог "та же координата", в проецированных единицах. */
  sameTargetEpsilon: number;
}

export interface IMarkerInterpolation {
  pushFix(target: number[], now: number): IFixResult;
  /** Координата, которую надо рисовать сейчас. null - фиксов ещё не было. */
  sample(now: number): number[] | null;
  isAnimating(now: number): boolean;
  /** Последний реальный фикс. null - фиксов не было. */
  getTarget(): number[] | null;
  reset(): void;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function isSameCoordinate(a: number[], b: number[], epsilon: number): boolean {
  return Math.abs(a[0] - b[0]) <= epsilon && Math.abs(a[1] - b[1]) <= epsilon;
}

export function createMarkerInterpolation(
  options: IMarkerInterpolationOptions,
): IMarkerInterpolation {
  let startCoordinate: number[] | null = null;
  let targetCoordinate: number[] | null = null;
  let startTime = 0;
  let durationMs = 0;
  let lastFixTime = 0;

  function sample(now: number): number[] | null {
    if (!startCoordinate || !targetCoordinate) return null;
    if (durationMs <= 0) return targetCoordinate.slice();
    const progress = clamp((now - startTime) / durationMs, 0, 1);
    return [
      startCoordinate[0] + (targetCoordinate[0] - startCoordinate[0]) * progress,
      startCoordinate[1] + (targetCoordinate[1] - startCoordinate[1]) * progress,
    ];
  }

  function isAnimating(now: number): boolean {
    if (!targetCoordinate || durationMs <= 0) return false;
    return now < startTime + durationMs;
  }

  function jumpTo(target: number[], now: number, kind: FixKind): IFixResult {
    startCoordinate = target.slice();
    targetCoordinate = target.slice();
    startTime = now;
    durationMs = 0;
    lastFixTime = now;
    return { kind, durationMs: 0 };
  }

  return {
    pushFix(target, now) {
      if (!targetCoordinate) return jumpTo(target, now, 'first');

      if (isSameCoordinate(targetCoordinate, target, options.sameTargetEpsilon)) {
        // Такт (lastFixTime) намеренно не обновляем: перерисовка занизила бы
        // измеренный интервал, и следующий реальный фикс поехал бы рывком.
        return { kind: 'redraw', durationMs: isAnimating(now) ? startTime + durationMs - now : 0 };
      }

      const current = sample(now) ?? target;
      // Порог считаем от того, что нарисовано сейчас: вопрос "сколько нам
      // ехать", а не "как далеко прыгнул GPS".
      if (options.distanceMeters(current, target) > options.teleportDistanceMeters) {
        return jumpTo(target, now, 'teleport');
      }

      durationMs = clamp(now - lastFixTime, options.minDurationMs, options.maxDurationMs);
      startCoordinate = current;
      targetCoordinate = target.slice();
      startTime = now;
      lastFixTime = now;
      return { kind: 'animated', durationMs };
    },
    sample,
    isAnimating,
    getTarget() {
      return targetCoordinate ? targetCoordinate.slice() : null;
    },
    reset() {
      startCoordinate = null;
      targetCoordinate = null;
      startTime = 0;
      durationMs = 0;
      lastFixTime = 0;
    },
  };
}
