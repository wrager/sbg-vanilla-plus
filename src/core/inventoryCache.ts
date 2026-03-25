import type { IInventoryReference, IInventoryReferenceFull } from './inventoryTypes';
import { isInventoryReference, isInventoryReferenceFull } from './inventoryTypes';

export const INVENTORY_CACHE_KEY = 'inventory-cache';

/** Читает и парсит inventory-cache из localStorage. Возвращает пустой массив при ошибке. */
export function readInventoryCache(): unknown[] {
  const raw = localStorage.getItem(INVENTORY_CACHE_KEY);
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed;
}

/** Возвращает ключи (refs) из inventory-cache с базовыми полями. */
export function readInventoryReferences(): IInventoryReference[] {
  return readInventoryCache().filter(isInventoryReference);
}

/** Возвращает ключи (refs) из inventory-cache с полными данными (координаты, название). */
export function readFullInventoryReferences(): IInventoryReferenceFull[] {
  return readInventoryCache().filter(isInventoryReferenceFull);
}
