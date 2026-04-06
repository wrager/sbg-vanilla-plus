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

export interface ICalculateDeletionsOptions {
  /** GUID избранных точек — ключи от них никогда не попадают в deletions. */
  favoritedGuids: ReadonlySet<string>;
  /**
   * true, если модуль favoritedPoints загружен и готов (status=ready).
   * false — автоочистка не трогает ключи независимо от referencesMode.
   */
  referencesEnabled: boolean;
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
  options: ICalculateDeletionsOptions,
): IDeletionEntry[] {
  const deletions: IDeletionEntry[] = [];

  const coresByLevel = groupByLevel(items, ITEM_TYPE_CORE);
  addLevelDeletions(coresByLevel, limits.cores, ITEM_TYPE_CORE, deletions);

  const catalysersByLevel = groupByLevel(items, ITEM_TYPE_CATALYSER);
  addLevelDeletions(catalysersByLevel, limits.catalysers, ITEM_TYPE_CATALYSER, deletions);

  // Ключи удаляются ТОЛЬКО при одновременном выполнении ВСЕХ условий:
  // 1. referencesEnabled — модуль favoritedPoints включён И готов (isModuleActive)
  // 2. referencesMode === 'fast' — пользователь явно выбрал быстрый режим
  // 3. referencesFastLimit !== -1 — пользователь задал конкретный лимит
  // 4. favoritedGuids.size > 0 — в memory cache есть избранные (защита от сбоя IDB)
  // Если хоть одно условие не выполнено — ключи не трогаются.
  if (
    options.referencesEnabled &&
    limits.referencesMode === 'fast' &&
    limits.referencesFastLimit !== -1 &&
    options.favoritedGuids.size > 0
  ) {
    addReferenceDeletions(items, limits.referencesFastLimit, options.favoritedGuids, deletions);
  }

  return deletions;
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
    const level = item.l as number;
    const entries = grouped.get(level) ?? [];
    entries.push({ guid: item.g, amount: item.a });
    grouped.set(level, entries);
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

function addReferenceDeletions(
  items: readonly IInventoryItem[],
  limit: number,
  favoritedGuids: ReadonlySet<string>,
  deletions: IDeletionEntry[],
): void {
  if (limit === -1) return;

  // Отфильтровать ключи избранных точек ПЕРЕД расчётом лимита — их не должно быть
  // в списке ни в каких подсчётах. Даже при лимите 0 эти ключи остаются в инвентаре.
  const matching: IInventoryReference[] = items.filter(
    (item): item is IInventoryReference =>
      isInventoryReference(item) && item.a > 0 && !favoritedGuids.has(item.l),
  );

  const total = matching.reduce((sum, item) => sum + item.a, 0);
  let excess = total - limit;
  if (excess <= 0) return;

  for (const item of matching) {
    if (excess <= 0) break;
    const toDelete = Math.min(item.a, excess);
    const pointGuid = item.l;
    deletions.push({
      guid: item.g,
      type: ITEM_TYPE_REFERENCE,
      level: null,
      amount: toDelete,
      pointGuid,
    });
    excess -= toDelete;
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
