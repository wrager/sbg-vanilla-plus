import type { IDrawingRestrictionsSettings } from './settings';

export interface IDrawEntry {
  p?: string;
  a?: number;
  d?: number;
}

export type DrawPredicate = (entry: IDrawEntry) => boolean;

export interface IBuildPredicatesDeps {
  settings: IDrawingRestrictionsSettings;
  favorites: ReadonlySet<string>;
  starCenterGuid: string | null;
  /** GUID точки в открытом попапе — точка, с которой уходит /api/draw. */
  currentPopupGuid: string | null;
}

function keepByFavMode(
  mode: IDrawingRestrictionsSettings['favProtectionMode'],
  favorites: ReadonlySet<string>,
): DrawPredicate | null {
  if (mode === 'off') return null;
  if (favorites.size === 0) return null;
  if (mode === 'protectLastKey') {
    return (entry) => {
      const pointGuid = entry.p;
      const amount = entry.a;
      if (typeof pointGuid !== 'string' || typeof amount !== 'number') return true;
      return !(favorites.has(pointGuid) && amount === 1);
    };
  }
  // hideAllFavorites
  return (entry) => {
    const pointGuid = entry.p;
    if (typeof pointGuid !== 'string') return true;
    return !favorites.has(pointGuid);
  };
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
  const favPredicate = keepByFavMode(deps.settings.favProtectionMode, deps.favorites);
  if (favPredicate) predicates.push(favPredicate);
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
 * Сколько элементов было скрыто правилом protectLastKey. Считается отдельно от
 * остальных правил, потому что только эта ветка показывает toast — скрытие
 * массово-ожидаемое (hideAllFavorites, distance) не требует уведомления.
 */
export function countHiddenByLastKey(
  entries: readonly IDrawEntry[],
  favorites: ReadonlySet<string>,
  mode: IDrawingRestrictionsSettings['favProtectionMode'],
): number {
  if (mode !== 'protectLastKey' || favorites.size === 0) return 0;
  let hidden = 0;
  for (const entry of entries) {
    if (typeof entry.p !== 'string' || typeof entry.a !== 'number') continue;
    if (favorites.has(entry.p) && entry.a === 1) hidden += 1;
  }
  return hidden;
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
