import type { IInventoryItem } from '../../core/inventoryTypes';
import { isInventoryItem } from '../../core/inventoryTypes';

export function parseInventoryCache(): IInventoryItem[] {
  const raw = localStorage.getItem('inventory-cache');
  if (!raw) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) return [];

  const items: IInventoryItem[] = [];
  for (const entry of parsed) {
    if (isInventoryItem(entry)) {
      items.push(entry);
    }
  }
  return items;
}
