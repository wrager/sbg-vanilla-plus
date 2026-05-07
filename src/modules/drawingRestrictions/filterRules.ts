import type { IDrawingRestrictionsSettings } from './settings';

export interface IDrawEntry {
  p?: string;
  a?: number;
  d?: number;
}

export type DrawPredicate = (entry: IDrawEntry) => boolean;

export interface IBuildPredicatesDeps {
  settings: IDrawingRestrictionsSettings;
  /**
   * GUID'ы точек, у которых хотя бы одна стопка ключей помечена нативным
   * lock-битом (`item.f & 0b10`). Семантика — «ключи этой точки защищены от
   * удаления»; в drawingRestrictions используется как сигнал «ключи этой точки
   * ценны игроку, не давать рисовать линии, расходующие их».
   */
  lockedPoints: ReadonlySet<string>;
  starCenterGuid: string | null;
  /** GUID точки в открытом попапе — точка, с которой уходит /api/draw. */
  currentPopupGuid: string | null;
}

function keepByLockMode(
  mode: IDrawingRestrictionsSettings['favProtectionMode'],
  lockedPoints: ReadonlySet<string>,
): DrawPredicate | null {
  if (mode === 'off') return null;
  if (lockedPoints.size === 0) return null;
  if (mode === 'protectLastKey') {
    return (entry) => {
      const pointGuid = entry.p;
      const amount = entry.a;
      if (typeof pointGuid !== 'string' || typeof amount !== 'number') return true;
      return !(lockedPoints.has(pointGuid) && amount === 1);
    };
  }
  // hideAllFavorites — историческое имя режима, теперь «скрыть все locked-точки».
  return (entry) => {
    const pointGuid = entry.p;
    if (typeof pointGuid !== 'string') return true;
    return !lockedPoints.has(pointGuid);
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
  const lockPredicate = keepByLockMode(deps.settings.favProtectionMode, deps.lockedPoints);
  if (lockPredicate) predicates.push(lockPredicate);
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
 * Сколько элементов было скрыто правилом защиты locked-точек (lock-axis в
 * toast-bitmask). Покрывает оба пользовательских режима через единый счётчик:
 * формулировка toast-сообщения для бита lock потом выбирается по mode в
 * drawFilter (mode-aware wording, см. lockMessage).
 *
 * - mode='protectLastKey': считаем locked-точки с amount=1 (только последний ключ).
 * - mode='hideAllFavorites': считаем все locked-точки (любой amount).
 * - mode='off': предикат не создаётся, ничего не скрывается.
 */
export function countHiddenByLockMode(
  entries: readonly IDrawEntry[],
  lockedPoints: ReadonlySet<string>,
  mode: IDrawingRestrictionsSettings['favProtectionMode'],
): number {
  if (mode === 'off' || lockedPoints.size === 0) return 0;
  let hidden = 0;
  for (const entry of entries) {
    if (typeof entry.p !== 'string') continue;
    if (mode === 'protectLastKey') {
      if (typeof entry.a !== 'number') continue;
      if (lockedPoints.has(entry.p) && entry.a === 1) hidden += 1;
    } else {
      // hideAllFavorites: любой amount считается, поле `a` для решения не нужно.
      if (lockedPoints.has(entry.p)) hidden += 1;
    }
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
