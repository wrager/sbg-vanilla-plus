import type { IInventoryItem } from './inventoryTypes';
import type { ICleanupLimits } from './cleanupSettings';
import type { ILocalizedString } from '../../core/l10n';
import { t } from '../../core/l10n';

const TYPE_LABELS: Partial<Record<number, ILocalizedString>> = {
  1: { en: 'Co', ru: 'Я' },
  2: { en: 'Ca', ru: 'К' },
  3: { en: 'Ref', ru: 'Кл' },
};

export interface IDeletionEntry {
  guid: string;
  type: number;
  level: number | null;
  amount: number;
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

  const coresByLevel = groupByLevel(items, 1);
  addLevelDeletions(coresByLevel, limits.cores, 1, deletions);

  const catalysersByLevel = groupByLevel(items, 2);
  addLevelDeletions(catalysersByLevel, limits.catalysers, 2, deletions);

  // Удаление ключей временно отключено до реализации модуля «Избранные точки».
  // Когда модуль будет готов — заменить -1 на limits.references.
  addFlatDeletions(items, 3, -1, deletions);

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

function addFlatDeletions(
  items: readonly IInventoryItem[],
  type: number,
  limit: number,
  deletions: IDeletionEntry[],
): void {
  if (limit === -1) return;

  const matching = items.filter((item) => item.t === type && item.a > 0);
  const total = matching.reduce((sum, item) => sum + item.a, 0);
  let excess = total - limit;
  if (excess <= 0) return;

  for (const item of matching) {
    if (excess <= 0) break;
    const toDelete = Math.min(item.a, excess);
    deletions.push({ guid: item.g, type, level: null, amount: toDelete });
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
