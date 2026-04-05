import type { IDeletionEntry } from './cleanupCalculator';
import { ITEM_TYPE_CORE, ITEM_TYPE_CATALYSER, ITEM_TYPE_REFERENCE } from '../../core/gameConstants';
import { INVENTORY_CACHE_KEY } from '../../core/inventoryCache';

export interface IDeleteResult {
  total: number;
}

interface IApiResponse {
  count?: { total?: number };
  error?: string;
}

function buildAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem('auth');
  if (!token) {
    throw new Error('Auth token not found');
  }
  return {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
  };
}

function groupByType(deletions: readonly IDeletionEntry[]): Map<number, Record<string, number>> {
  const grouped = new Map<number, Record<string, number>>();
  for (const entry of deletions) {
    let selection = grouped.get(entry.type);
    if (!selection) {
      selection = {};
      grouped.set(entry.type, selection);
    }
    selection[entry.guid] = (selection[entry.guid] ?? 0) + entry.amount;
  }
  return grouped;
}

/** Типы предметов, удаление которых разрешено. Спецпредметы (вёники) защищены. */
const DELETABLE_TYPES = new Set([ITEM_TYPE_CORE, ITEM_TYPE_CATALYSER, ITEM_TYPE_REFERENCE]);

export interface IDeleteInventoryOptions {
  /**
   * Снимок GUID избранных точек на момент вызова — финальный guard перед DELETE.
   * Даже если ключ прошёл фильтрацию в calculateDeletions, перед отправкой
   * запроса мы ещё раз проверяем, что его pointGuid нет в этом наборе.
   */
  favoritedGuids: ReadonlySet<string>;
}

export async function deleteInventoryItems(
  deletions: readonly IDeletionEntry[],
  options: IDeleteInventoryOptions,
): Promise<IDeleteResult> {
  for (const entry of deletions) {
    if (!DELETABLE_TYPES.has(entry.type)) {
      throw new Error(`Удаление предметов типа ${entry.type} запрещено`);
    }
    if (entry.type === ITEM_TYPE_REFERENCE) {
      if (entry.pointGuid === undefined) {
        throw new Error(`Ключ ${entry.guid} без pointGuid не может быть удалён (guard избранных)`);
      }
      if (options.favoritedGuids.has(entry.pointGuid)) {
        throw new Error(
          `Ключ от избранной точки ${entry.pointGuid} не может быть удалён (guard избранных)`,
        );
      }
    }
  }

  const grouped = groupByType(deletions);
  let lastTotal = 0;

  for (const [type, selection] of grouped) {
    const response = await fetch('/api/inventory', {
      method: 'DELETE',
      headers: buildAuthHeaders(),
      body: JSON.stringify({ selection, tab: type }),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    let parsed: IApiResponse;
    try {
      parsed = (await response.json()) as IApiResponse;
    } catch {
      throw new Error('Invalid response from server');
    }

    if (parsed.error) {
      throw new Error(parsed.error);
    }

    if (!parsed.count || typeof parsed.count.total !== 'number') {
      throw new Error('Response missing inventory count');
    }

    lastTotal = parsed.count.total;
  }

  return { total: lastTotal };
}

export function updateInventoryCache(deletions: readonly IDeletionEntry[]): void {
  const raw = localStorage.getItem(INVENTORY_CACHE_KEY);
  if (!raw) {
    console.warn('[SVP inventoryCleanup] inventory-cache отсутствует, пропуск обновления');
    return;
  }

  let cache: { g: string; a: number; [key: string]: unknown }[];
  try {
    cache = JSON.parse(raw) as typeof cache;
  } catch {
    console.warn('[SVP inventoryCleanup] inventory-cache содержит невалидный JSON');
    return;
  }

  if (!Array.isArray(cache)) {
    console.warn('[SVP inventoryCleanup] inventory-cache не является массивом');
    return;
  }

  for (const entry of deletions) {
    const cached = cache.find((item) => item.g === entry.guid);
    if (cached) {
      cached.a -= entry.amount;
    }
  }

  cache = cache.filter((item) => item.a > 0);
  localStorage.setItem(INVENTORY_CACHE_KEY, JSON.stringify(cache));
}
