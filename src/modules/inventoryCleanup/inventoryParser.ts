import type { IInventoryItem } from '../../core/inventoryTypes';
import { isInventoryItem } from '../../core/inventoryTypes';
import { readInventoryCache } from '../../core/inventoryCache';

export function parseInventoryCache(): IInventoryItem[] {
  return readInventoryCache().filter(isInventoryItem);
}
