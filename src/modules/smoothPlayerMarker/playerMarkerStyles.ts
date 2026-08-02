/**
 * Работа с игровыми стилями маркера игрока (refs/game/script.js:184-210).
 *
 * player_styles[0] - иконка без собственной геометрии, рисуется по геометрии
 * фичи; player_styles[1..3] - круги радиуса действия, взрыва и максимального
 * взрыва, у каждого ol.geom.Circle с центром на позиции игрока.
 *
 * Мы подменяем геометрию рендера у иконки и центры кругов. Геометрия самой
 * фичи не трогается: игра отправляет её на сервер в каждом действии и по ней
 * считает isInRange (refs/game/script.js:804, 3541-3547). Радиусы кругов тоже
 * остаются игровыми - на них держится анимация взрыва и пересчёт RANGE.
 */

import type { IOlCircleGeometry, IOlFeature, IOlPointGeometry, IOlStyle } from '../../core/olMap';

/** Число стилей в маркере игрока: иконка плюс три круга. */
const PLAYER_STYLES_COUNT = 4;

export interface IPlayerMarkerStyles {
  icon: IOlStyle;
  circles: IOlCircleGeometry[];
}

function isOlStyle(value: unknown): value is IOlStyle {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.setGeometry === 'function' && typeof candidate.getGeometry === 'function';
}

function toCircleGeometry(style: unknown): IOlCircleGeometry | null {
  if (typeof style !== 'object' || style === null) return null;
  const getGeometry = (style as Record<string, unknown>).getGeometry;
  if (typeof getGeometry !== 'function') return null;
  const geometry: unknown = getGeometry.call(style);
  if (typeof geometry !== 'object' || geometry === null) return null;
  const candidate = geometry as Record<string, unknown>;
  if (typeof candidate.setCenter !== 'function' || typeof candidate.getCenter !== 'function') {
    return null;
  }
  return geometry as IOlCircleGeometry;
}

/**
 * Разбирает стили фичи игрока. Возвращает null, если структура не та, что мы
 * ожидаем: игра могла обновиться, и тогда сглаживание не включается.
 */
export function resolvePlayerMarkerStyles(feature: IOlFeature): IPlayerMarkerStyles | null {
  const style: unknown = feature.getStyle?.();
  if (!Array.isArray(style) || style.length < PLAYER_STYLES_COUNT) return null;

  const icon: unknown = style[0];
  if (!isOlStyle(icon)) return null;

  const circles: IOlCircleGeometry[] = [];
  for (const circleStyle of style.slice(1, PLAYER_STYLES_COUNT)) {
    const geometry = toCircleGeometry(circleStyle);
    if (!geometry) return null;
    circles.push(geometry);
  }

  return { icon, circles };
}

/** Точка, которую мы мутируем каждый кадр. null, если ol недоступен. */
export function createInterpolatedPoint(coordinate: number[]): IOlPointGeometry | null {
  const Point = window.ol?.geom?.Point;
  if (!Point) return null;
  return new Point(coordinate.slice());
}

export function applyRenderedPosition(
  feature: IOlFeature,
  styles: IPlayerMarkerStyles,
  point: IOlPointGeometry,
  coordinate: number[],
): void {
  point.setCoordinates(coordinate);
  // Style.setGeometry кладёт замыкание над переданным объектом
  // (refs/ol/ol.js:6884), поэтому достаточно одного вызова - дальше меняется
  // сама точка.
  if (styles.icon.getGeometry() !== point) styles.icon.setGeometry(point);
  for (const circle of styles.circles) circle.setCenter(coordinate);
  // Без changed() renderer не пересоберёт execution plan и оставит маркер
  // на прежнем месте до ближайшего движения карты.
  feature.changed?.();
}

/** Возвращает игре её собственный рендер: иконка и круги встают на реальный фикс. */
export function restoreNativeRendering(feature: IOlFeature, styles: IPlayerMarkerStyles): void {
  styles.icon.setGeometry(undefined);
  const real = feature.getGeometry().getCoordinates();
  for (const circle of styles.circles) circle.setCenter(real);
  feature.changed?.();
}
