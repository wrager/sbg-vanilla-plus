import type { IDeletionEntry } from './cleanupCalculator';

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

export async function deleteInventoryItems(
  deletions: readonly IDeletionEntry[],
): Promise<IDeleteResult> {
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
  const raw = localStorage.getItem('inventory-cache');
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
  localStorage.setItem('inventory-cache', JSON.stringify(cache));
}
