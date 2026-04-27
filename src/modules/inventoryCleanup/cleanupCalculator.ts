import type { IInventoryItem, IInventoryReference } from '../../core/inventoryTypes';
import { isInventoryReference } from '../../core/inventoryTypes';
import type { ICleanupLimits } from './cleanupSettings';
import type { ILocalizedString } from '../../core/l10n';
import { t } from '../../core/l10n';
import { ITEM_TYPE_CORE, ITEM_TYPE_CATALYSER, ITEM_TYPE_REFERENCE } from '../../core/gameConstants';

const TYPE_LABELS: Partial<Record<number, ILocalizedString>> = {
  [ITEM_TYPE_CORE]: { en: 'Co', ru: 'Я' },
  [ITEM_TYPE_CATALYSER]: { en: 'Ca', ru: 'К' },
  [ITEM_TYPE_REFERENCE]: { en: 'Ref', ru: 'Кл' },
};

export interface IDeletionEntry {
  guid: string;
  type: number;
  level: number | null;
  amount: number;
  /** GUID точки — только для ключей (references). Используется для финального guard. */
  pointGuid?: string;
}

export function shouldRunCleanup(
  currentCount: number,
  inventoryLimit: number,
  minFreeSlots: number,
): boolean {
  return inventoryLimit - currentCount < minFreeSlots;
}

export function calculateDeletions(
  items: readonly IInventoryItem[],
  limits: ICleanupLimits,
): IDeletionEntry[] {
  const deletions: IDeletionEntry[] = [];

  const coresByLevel = groupByLevel(items, ITEM_TYPE_CORE);
  addLevelDeletions(coresByLevel, limits.cores, ITEM_TYPE_CORE, deletions);

  const catalysersByLevel = groupByLevel(items, ITEM_TYPE_CATALYSER);
  addLevelDeletions(catalysersByLevel, limits.catalysers, ITEM_TYPE_CATALYSER, deletions);

  // Ключи удаляются при выполнении базовых условий выбора режима И наличии
  // нативной поддержки lock-флагов в кэше: ВСЕ реф-стопки имеют поле `f`.
  // Это сигнал, что сервер уже отдаёт lock-семантику для всего инвентаря (0.6.1+);
  // без него защита по locked невозможна — не трогаем ключи, чтобы не удалить
  // их вслепую (например, на старом 0.6.0 или при mix-кэше, когда часть стопок
  // ещё с прежним форматом без `f`). Раньше проверялось `some`, но при mix-кэше
  // стопки без `f` не попадают в lockedPointGuids и могли быть удалены даже у
  // фактически защищённой точки. Симметрично с финальным guard в inventoryApi.
  // Legacy SVP/CUI-избранные в логике удаления НЕ участвуют — они только
  // источник миграции в favoritesMigration. Сама автоочистка блокируется
  // на уровне runCleanup (см. inventoryCleanup.ts), пока миграция не сделана.
  if (limits.referencesMode === 'fast' && limits.referencesFastLimit !== -1) {
    const refStacks = items.filter(isInventoryReference);
    const lockSupportAvailable =
      refStacks.length > 0 && refStacks.every((item) => item.f !== undefined);
    if (lockSupportAvailable) {
      addReferenceDeletions(items, limits.referencesFastLimit, deletions);
    }
  }

  return deletions;
}

/**
 * Возвращает GUID'ы точек, у которых хотя бы одна стопка ключей помечена
 * флагом `lock` (бит 1 поля `f`, refs/game-beta/script.js:3405).
 * Стопки — деталь хранения; в UI игрок видит точку, и lock-семантика
 * пользователю «защитить ключи этой точки от удаления». Поэтому агрегируем
 * per-point: одна locked-стопка ⇒ вся точка под защитой.
 *
 * Принимает `unknown[]` — позволяет передавать сырой `inventory-cache` без
 * предварительной фильтрации; внутренний `isInventoryReference` отсеивает
 * не-рефы.
 */
export function buildLockedPointGuids(items: readonly unknown[]): Set<string> {
  const locked = new Set<string>();
  for (const item of items) {
    if (!isInventoryReference(item)) continue;
    if (item.f === undefined) continue;
    if ((item.f & 0b10) === 0) continue;
    locked.add(item.l);
  }
  return locked;
}

interface IItemEntry {
  guid: string;
  amount: number;
}

function groupByLevel(items: readonly IInventoryItem[], type: number): Map<number, IItemEntry[]> {
  const grouped = new Map<number, IItemEntry[]>();
  for (const item of items) {
    if (item.t !== type) continue;
    if (item.a <= 0) continue;
    // Для cores/catalysers item.l — number (уровень). TS не сужает union по item.t,
    // поэтому проверяем runtime: string l означает reference, пропускаем.
    if (typeof item.l !== 'number') continue;
    const entries = grouped.get(item.l) ?? [];
    entries.push({ guid: item.g, amount: item.a });
    grouped.set(item.l, entries);
  }
  return grouped;
}

function addLevelDeletions(
  grouped: Map<number, IItemEntry[]>,
  levelLimits: Record<number, number>,
  type: number,
  deletions: IDeletionEntry[],
): void {
  for (const [level, entries] of grouped) {
    const limit = levelLimits[level] ?? -1;
    if (limit === -1) continue;

    const total = entries.reduce((sum, entry) => sum + entry.amount, 0);
    let excess = total - limit;
    if (excess <= 0) continue;

    for (const entry of entries) {
      if (excess <= 0) break;
      const toDelete = Math.min(entry.amount, excess);
      deletions.push({ guid: entry.guid, type, level, amount: toDelete });
      excess -= toDelete;
    }
  }
}

/**
 * Лимит ключей — НА ТОЧКУ: для каждой уникальной точки оставляет не более limit
 * ключей. Аналогично cores/catalysers, где лимит задаётся на уровень.
 * Из расчёта исключаются точки, у которых в инвентаре есть хотя бы одна стопка
 * с нативным lock-флагом (бит 1 в `item.f`) — пользователь явно защитил их в
 * UI игры 0.6.1. Favorite-флаг (бит 0) НЕ защищает от удаления: пользователь
 * подтвердил это в постановке («избранные ключи не защищаются от удаления,
 * заблокированные — не удаляются автоочисткой»).
 */
function addReferenceDeletions(
  items: readonly IInventoryItem[],
  limit: number,
  deletions: IDeletionEntry[],
): void {
  if (limit === -1) return;

  const lockedPointGuids = buildLockedPointGuids(items);

  // Отфильтровать ключи заблокированных точек ПЕРЕД расчётом лимита.
  const matching: IInventoryReference[] = items.filter(
    (item): item is IInventoryReference =>
      isInventoryReference(item) && item.a > 0 && !lockedPointGuids.has(item.l),
  );

  // Группировка по pointGuid (item.l для ключей = GUID точки).
  const byPoint = new Map<string, IItemEntry[]>();
  for (const item of matching) {
    const pointGuid = item.l;
    const entries = byPoint.get(pointGuid) ?? [];
    entries.push({ guid: item.g, amount: item.a });
    byPoint.set(pointGuid, entries);
  }

  // Для каждой точки — применяем лимит (FIFO внутри группы).
  for (const [pointGuid, entries] of byPoint) {
    const total = entries.reduce((sum, entry) => sum + entry.amount, 0);
    let excess = total - limit;
    if (excess <= 0) continue;

    for (const entry of entries) {
      if (excess <= 0) break;
      const toDelete = Math.min(entry.amount, excess);
      deletions.push({
        guid: entry.guid,
        type: ITEM_TYPE_REFERENCE,
        level: null,
        amount: toDelete,
        pointGuid,
      });
      excess -= toDelete;
    }
  }
}

export function formatDeletionSummary(deletions: readonly IDeletionEntry[]): string {
  const grouped = new Map<string, number>();
  for (const entry of deletions) {
    const localizedLabel = TYPE_LABELS[entry.type];
    const label = localizedLabel ? t(localizedLabel) : `?${entry.type}`;
    const key = entry.level !== null ? `${label}${entry.level}` : label;
    grouped.set(key, (grouped.get(key) ?? 0) + entry.amount);
  }

  const parts: string[] = [];
  for (const [label, amount] of grouped) {
    parts.push(`${label} ×${amount}`);
  }
  return parts.join(', ');
}
