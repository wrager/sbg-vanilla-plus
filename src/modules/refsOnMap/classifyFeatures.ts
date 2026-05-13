import type { IOlFeature } from '../../core/olMap';
import type { OwnTeamMode } from './refsOnMapSettings';

/**
 * Единый классификатор фич слоя svp-refs-on-map. Один источник правды для:
 * 1. Карты (иконки lock/star, текст "=1", alpha выделения защищённых).
 * 2. Удаления (payload + bucket'ы для единого тоста).
 * 3. Селекшен-инфо (счётчики по категориям защиты).
 *
 * isLocked/isFavorited - всегда из inventory-cache, независимо от выделения и
 * mode. deletion - судьба фичи при текущем mode/playerTeam:
 *
 * - lockedProtected: locked в инвентаре, не удаляется ни при каком mode.
 * - ownProtected: своя команда, mode='keep' - полная защита.
 * - unknownProtected: команда не загружена (team=undefined) при mode='keep'/'keepOne' -
 *   fail-safe, цвет неизвестен.
 * - keepOneTrimmed: mode='keepOne', своя точка - стопка частично удаляется или
 *   полностью защищена (правило "оставить 1 ключ" применилось).
 * - fullyDeletable: подлежит полному удалению.
 * - nothingToDelete: невыделенная фича; либо выделенная с amount<=0;
 *   либо без pointGuid (нарушение инварианта данных - safe default).
 *
 * Поведение для team=null (нейтральная точка): при mode='keep'/'keepOne' не
 * считается своей -> deletable как любая чужая. Это совпадает с текущим
 * partitionByLockProtection. Fail-safe только для team=undefined.
 */

export type DeletionOutcome =
  | 'lockedProtected'
  | 'ownProtected'
  | 'unknownProtected'
  | 'keepOneTrimmed'
  | 'fullyDeletable'
  | 'nothingToDelete';

export interface IFeatureClassification {
  isLocked: boolean;
  isFavorited: boolean;
  deletion: DeletionOutcome;
  // Сколько ключей пойдёт в DELETE-payload для этой стопки (0 для защищённых).
  toDelete: number;
  // Сколько ключей останется в инвентаре по этой стопке после удаления.
  toSurvive: number;
}

export interface IClassificationContext {
  mode: OwnTeamMode;
  playerTeam: number | null;
  lockedPointGuids: ReadonlySet<string>;
  favoritedPointGuids: ReadonlySet<string>;
  // pointGuid -> сумма amount всех стопок этой точки в инвентаре. Нужно для
  // keepOne-распределения: при наличии невыделенных стопок защита уже
  // выполнена, обрезка не требуется.
  inventoryTotals: ReadonlyMap<string, number>;
}

function getAmount(feature: IOlFeature): number {
  const properties = feature.getProperties?.() ?? {};
  return typeof properties.amount === 'number' ? properties.amount : 0;
}

function getPointGuid(feature: IOlFeature): string | null {
  const properties = feature.getProperties?.() ?? {};
  return typeof properties.pointGuid === 'string' ? properties.pointGuid : null;
}

function getTeam(feature: IOlFeature): number | null | undefined {
  const properties = feature.getProperties?.() ?? {};
  const team: unknown = properties.team;
  if (typeof team === 'number') return team;
  if (team === null) return null;
  return undefined;
}

function isSelected(feature: IOlFeature): boolean {
  const properties = feature.getProperties?.() ?? {};
  return properties.isSelected === true;
}

export function classifyFeatures(
  features: readonly IOlFeature[],
  context: IClassificationContext,
): Map<IOlFeature, IFeatureClassification> {
  const result = new Map<IOlFeature, IFeatureClassification>();

  // Первый проход: пер-фичу классификация без keepOne-обрезки. Выделенные
  // свои в режиме keepOne получают временное deletion='fullyDeletable' -
  // финальное решение принимается во втором проходе с группировкой по точке.
  for (const feature of features) {
    const guid = getPointGuid(feature);
    const isLocked = guid !== null && context.lockedPointGuids.has(guid);
    const isFavorited = guid !== null && context.favoritedPointGuids.has(guid);
    const amount = getAmount(feature);

    if (!isSelected(feature)) {
      result.set(feature, {
        isLocked,
        isFavorited,
        deletion: 'nothingToDelete',
        toDelete: 0,
        toSurvive: amount,
      });
      continue;
    }

    if (isLocked) {
      result.set(feature, {
        isLocked,
        isFavorited,
        deletion: 'lockedProtected',
        toDelete: 0,
        toSurvive: amount,
      });
      continue;
    }

    if (guid === null) {
      // Выделенная фича без pointGuid - сбой данных. Защищаем по дефолту,
      // чтобы не удалить вслепую. На практике инвариант не нарушается:
      // фичи строятся из /inview и inventory, оба источника поставляют guid.
      result.set(feature, {
        isLocked,
        isFavorited,
        deletion: 'nothingToDelete',
        toDelete: 0,
        toSurvive: amount,
      });
      continue;
    }

    const team = getTeam(feature);
    const protectiveMode = context.mode === 'keep' || context.mode === 'keepOne';

    if (protectiveMode && team === undefined) {
      result.set(feature, {
        isLocked,
        isFavorited,
        deletion: 'unknownProtected',
        toDelete: 0,
        toSurvive: amount,
      });
      continue;
    }

    const isOwn =
      protectiveMode &&
      context.playerTeam !== null &&
      typeof team === 'number' &&
      team === context.playerTeam;

    if (isOwn && context.mode === 'keep') {
      result.set(feature, {
        isLocked,
        isFavorited,
        deletion: 'ownProtected',
        toDelete: 0,
        toSurvive: amount,
      });
      continue;
    }

    // Для своих в keepOne и для всех чужих - временный fullyDeletable.
    // keepOne-обрезка для своих делается во втором проходе.
    if (amount <= 0) {
      result.set(feature, {
        isLocked,
        isFavorited,
        deletion: 'nothingToDelete',
        toDelete: 0,
        toSurvive: amount,
      });
      continue;
    }
    result.set(feature, {
      isLocked,
      isFavorited,
      deletion: 'fullyDeletable',
      toDelete: amount,
      toSurvive: 0,
    });
  }

  // Второй проход: keepOne-обрезка применяется ТОЛЬКО к выделенным своим.
  // Чужие в keepOne удаляются полностью (по плану).
  if (context.mode === 'keepOne' && context.playerTeam !== null) {
    applyKeepOneTrimming(features, context, result);
  }

  return result;
}

function applyKeepOneTrimming(
  features: readonly IOlFeature[],
  context: IClassificationContext,
  result: Map<IOlFeature, IFeatureClassification>,
): void {
  // Группа: pointGuid -> своя fully-deletable стопка (после первого прохода).
  const ownTrimmableByPoint = new Map<string, IOlFeature[]>();
  for (const feature of features) {
    const cls = result.get(feature);
    if (!cls || cls.deletion !== 'fullyDeletable') continue;
    const team = getTeam(feature);
    if (typeof team !== 'number' || team !== context.playerTeam) continue;
    const guid = getPointGuid(feature);
    if (guid === null) continue;
    const list = ownTrimmableByPoint.get(guid);
    if (list) list.push(feature);
    else ownTrimmableByPoint.set(guid, [feature]);
  }

  for (const [pointGuid, group] of ownTrimmableByPoint) {
    const selectedAmount = group.reduce((sum, f) => sum + getAmount(f), 0);
    const inventoryTotal = context.inventoryTotals.get(pointGuid) ?? 0;
    const unselectedAmount = inventoryTotal - selectedAmount;

    if (unselectedAmount >= 1) {
      // Защита уже выполнена невыделенными стопками - удаляем всё выделенное.
      continue;
    }

    const toDeleteTotal = selectedAmount - 1;
    if (toDeleteTotal <= 0) {
      // selectedAmount <= 1: вся выделенная часть точки защищена правилом.
      for (const feature of group) {
        const amount = getAmount(feature);
        const current = result.get(feature);
        if (!current) continue;
        result.set(feature, {
          ...current,
          deletion: 'keepOneTrimmed',
          toDelete: 0,
          toSurvive: amount,
        });
      }
      continue;
    }

    // Distribute. Sort by amount desc, ties по feature id (детерминированно
    // для воспроизводимого DELETE-payload и для стабильных тестов).
    const sorted = [...group].sort((a, b) => {
      const aAmount = getAmount(a);
      const bAmount = getAmount(b);
      if (bAmount !== aAmount) return bAmount - aAmount;
      return String(a.getId()).localeCompare(String(b.getId()));
    });

    let remaining = toDeleteTotal;
    for (const feature of sorted) {
      const amount = getAmount(feature);
      const current = result.get(feature);
      if (!current) continue;
      if (remaining <= 0 || amount <= 0) {
        result.set(feature, {
          ...current,
          deletion: 'keepOneTrimmed',
          toDelete: 0,
          toSurvive: amount,
        });
        continue;
      }
      const deleteAmount = Math.min(amount, remaining);
      remaining -= deleteAmount;
      if (deleteAmount === amount) {
        // Стопка полностью удалена; формально часть keepOne-применения на
        // точке, но per-feature deletion отражает индивидуальную судьбу
        // стопки - полностью удалена = fullyDeletable. Per-point счётчик
        // "Останется 1 ключ" считается отдельно по survived>0.
        result.set(feature, {
          ...current,
          deletion: 'fullyDeletable',
          toDelete: amount,
          toSurvive: 0,
        });
      } else {
        result.set(feature, {
          ...current,
          deletion: 'keepOneTrimmed',
          toDelete: deleteAmount,
          toSurvive: amount - deleteAmount,
        });
      }
    }
  }
}
