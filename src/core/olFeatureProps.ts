import type { IOlFeature } from './olMap';

/**
 * Типизированный доступ к свойствам OL Feature на слое refs-on-map. Каждая
 * стопка ключей живёт как отдельная фича; в feature.properties лежат
 * pointGuid, team, amount, title, isSelected, isLocked, isFavorited,
 * deletionState, toDelete, toSurvive (см. showViewer / refreshFeatureClassifications).
 *
 * Helper'ы нужны, чтобы каждое чтение не повторяло `feature.getProperties?.()
 * ?? {}` + ручную проверку типа значения. Прямой `feature.getProperties()`
 * возвращает `Record<string, unknown>` - без guard любая опечатка ключа
 * "проходит" по типам.
 */

export function getRefFeatureProps(feature: IOlFeature): Record<string, unknown> {
  return feature.getProperties?.() ?? {};
}

export function getPointGuid(feature: IOlFeature): string | null {
  const properties = getRefFeatureProps(feature);
  return typeof properties.pointGuid === 'string' ? properties.pointGuid : null;
}

/**
 * team:
 * - number: конкретная команда (1..4),
 * - null: нейтральная точка (сервер ответил `te: null`),
 * - undefined: команда ещё не загружена (fail-safe для protective-mode).
 */
export function getTeam(feature: IOlFeature): number | null | undefined {
  const properties = getRefFeatureProps(feature);
  const team: unknown = properties.team;
  if (typeof team === 'number') return team;
  if (team === null) return null;
  return undefined;
}

export function getAmount(feature: IOlFeature): number {
  const properties = getRefFeatureProps(feature);
  return typeof properties.amount === 'number' ? properties.amount : 0;
}

export function isFeatureSelected(feature: IOlFeature): boolean {
  const properties = getRefFeatureProps(feature);
  return properties.isSelected === true;
}
