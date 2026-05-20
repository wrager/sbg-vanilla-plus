import type { IDrawingRestrictionsSettings } from './settings';

export interface IDrawEntry {
  p?: string;
  d?: number;
}

export type DrawPredicate = (entry: IDrawEntry) => boolean;

export interface IBuildPredicatesDeps {
  settings: IDrawingRestrictionsSettings;
  starCenterGuid: string | null;
  /** GUID точки в открытом попапе — точка, с которой уходит /api/draw. */
  currentPopupGuid: string | null;
}

function keepByDistance(maxDistanceMeters: number): DrawPredicate | null {
  if (!Number.isFinite(maxDistanceMeters) || maxDistanceMeters <= 0) return null;
  return (entry) => {
    const distance = entry.d;
    if (typeof distance !== 'number') return true;
    return distance <= maxDistanceMeters;
  };
}

function keepByStar(
  starCenterGuid: string | null,
  currentPopupGuid: string | null,
): DrawPredicate | null {
  if (starCenterGuid === null) return null;
  // Открыт попап самого центра: все линии из него — звёздные по определению,
  // фильтровать нечего.
  if (currentPopupGuid === starCenterGuid) return null;
  // Открыт попап любой другой точки — оставляем только линию на центр.
  return (entry) => entry.p === starCenterGuid;
}

export function buildPredicates(deps: IBuildPredicatesDeps): DrawPredicate[] {
  const predicates: DrawPredicate[] = [];
  const distancePredicate = keepByDistance(deps.settings.maxDistanceMeters);
  if (distancePredicate) predicates.push(distancePredicate);
  const starPredicate = keepByStar(deps.starCenterGuid, deps.currentPopupGuid);
  if (starPredicate) predicates.push(starPredicate);
  return predicates;
}

export function applyPredicates<T extends IDrawEntry>(
  entries: readonly T[],
  predicates: readonly DrawPredicate[],
): T[] {
  if (predicates.length === 0) return [...entries];
  return entries.filter((entry) => predicates.every((predicate) => predicate(entry)));
}

/**
 * Сколько элементов было бы скрыто правилом звезды. Возвращает 0, если центр
 * не назначен или открыт попап самого центра (в этих случаях `keepByStar`
 * предикат не создаётся — фильтр не применяется).
 */
export function countHiddenByStar(
  entries: readonly IDrawEntry[],
  starCenterGuid: string | null,
  currentPopupGuid: string | null,
): number {
  if (starCenterGuid === null || currentPopupGuid === starCenterGuid) return 0;
  let hidden = 0;
  for (const entry of entries) {
    if (typeof entry.p !== 'string') continue;
    if (entry.p !== starCenterGuid) hidden += 1;
  }
  return hidden;
}

/**
 * Сколько элементов было бы скрыто правилом дистанции. Возвращает 0, если
 * `maxDistanceMeters` не положительное число (в этом случае `keepByDistance`
 * предикат не создаётся — фильтр не применяется).
 */
export function countHiddenByDistance(
  entries: readonly IDrawEntry[],
  maxDistanceMeters: number,
): number {
  if (!Number.isFinite(maxDistanceMeters) || maxDistanceMeters <= 0) return 0;
  let hidden = 0;
  for (const entry of entries) {
    if (typeof entry.d !== 'number') continue;
    if (entry.d > maxDistanceMeters) hidden += 1;
  }
  return hidden;
}
