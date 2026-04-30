/**
 * Логика выбора следующей точки для навигации свайпом по попапу. Чистые
 * функции без модульного state - все зависимости (карта, игрок, посещённые)
 * передаются через ctx. Это позволяет переиспользовать логику в нескольких
 * модулях (betterNextPointSwipe, nextPointSwipeAnimation), каждый держит
 * свой ctx.
 */

import type { IOlFeature } from './olMap';

export interface NextPointContext {
  /** EPSG:3857 проецированные координаты игрока. */
  playerCoords: number[];
  /** Все features из points-layer. */
  features: IOlFeature[];
  /** GUID текущей открытой точки. */
  currentGuid: string;
  /**
   * Множество посещённых GUID-ов в текущей цепочке свайпов. Мутируется:
   * pickNextInRange добавляет currentGuid перед поиском, а при исчерпании
   * (циклическая навигация) очищает и оставляет только текущий.
   */
  visited: Set<string | number>;
  /** Радиус (м) от игрока для выбора кандидатов. */
  radiusMeters: number;
}

/**
 * Геодезическое расстояние между двумя точками в проецированных координатах
 * (EPSG:3857). Возвращает расстояние в метрах. Использует ol.sphere.getLength -
 * тот же метод, что игра в isInRange/getDistance (refs/game/script.js:2751-2757).
 */
export function getGeodeticDistance(coordsA: number[], coordsB: number[]): number {
  const ol = window.ol;
  if (!ol?.geom?.LineString || !ol.sphere?.getLength) return Infinity;
  const line = new ol.geom.LineString([coordsA, coordsB]);
  return ol.sphere.getLength(line);
}

export function findFeaturesInRange(
  center: number[],
  features: IOlFeature[],
  radiusMeters: number,
): IOlFeature[] {
  const result: IOlFeature[] = [];
  for (const feature of features) {
    const id = feature.getId();
    if (id === undefined) continue;
    const coords = feature.getGeometry().getCoordinates();
    if (getGeodeticDistance(center, coords) <= radiusMeters) {
      result.push(feature);
    }
  }
  return result;
}

/**
 * Ближайшая feature по проецированному расстоянию (без геодезической
 * корректировки). Достаточно для упорядочивания внутри ограниченного радиуса -
 * порядок совпадает с геодезическим, и quadratic-form избегает sqrt и lon/lat
 * пересчётов на каждом сравнении.
 */
export function findNearestByDistance(center: number[], features: IOlFeature[]): IOlFeature | null {
  let nearest: IOlFeature | null = null;
  let minDistanceSquared = Infinity;
  for (const feature of features) {
    const coords = feature.getGeometry().getCoordinates();
    const dx = coords[0] - center[0];
    const dy = coords[1] - center[1];
    const distanceSquared = dx * dx + dy * dy;
    if (distanceSquared < minDistanceSquared) {
      minDistanceSquared = distanceSquared;
      nearest = feature;
    }
  }
  return nearest;
}

/** Точка имеет свободные слоты для деплоя (< 6 ядер). refs/game/script.js:1246 */
export function hasFreeSlots(feature: IOlFeature): boolean {
  const cores = feature.get?.('cores');
  return cores === undefined || (typeof cores === 'number' && cores < 6);
}

/** Точка доступна для изучения (нет активного кулдауна). refs/game/script.js:636-638 */
export function isDiscoverable(feature: IOlFeature): boolean {
  const id = feature.getId();
  if (id === undefined) return false;
  const cooldowns = JSON.parse(localStorage.getItem('cooldowns') ?? '{}') as Record<
    string,
    { t?: number; c?: number } | undefined
  >;
  const cooldown = cooldowns[String(id)];
  if (!cooldown?.t) return true;
  return cooldown.t <= Date.now() && (cooldown.c ?? 0) > 0;
}

/**
 * Выбор следующей точки с приоритетом по полезности.
 * Порядок: свободные слоты > доступная для изучения > любая.
 * Внутри каждого приоритета - ближайшая.
 */
export function findNextByPriority(center: number[], candidates: IOlFeature[]): IOlFeature | null {
  return (
    findNearestByDistance(center, candidates.filter(hasFreeSlots)) ??
    findNearestByDistance(center, candidates.filter(isDiscoverable)) ??
    findNearestByDistance(center, candidates)
  );
}

/**
 * Выбирает следующую точку в радиусе для свайп-навигации. Side-effect:
 * добавляет ctx.currentGuid в visited перед поиском (чтобы не вернуть текущую).
 * Если все точки в радиусе посещены - сбрасывает visited (циклическая
 * навигация), оставляя только текущую, и ищет заново.
 */
export function pickNextInRange(ctx: NextPointContext): IOlFeature | null {
  ctx.visited.add(ctx.currentGuid);

  const inRange = findFeaturesInRange(ctx.playerCoords, ctx.features, ctx.radiusMeters);
  let candidates = inRange.filter((feature) => {
    const id = feature.getId();
    return id !== undefined && !ctx.visited.has(id);
  });
  let next = findNextByPriority(ctx.playerCoords, candidates);

  if (!next) {
    // Все in-range уже посещены - циклически начинаем заново.
    ctx.visited.clear();
    ctx.visited.add(ctx.currentGuid);
    candidates = inRange.filter((feature) => {
      const id = feature.getId();
      return id !== undefined && !ctx.visited.has(id);
    });
    next = findNextByPriority(ctx.playerCoords, candidates);
  }

  return next;
}
