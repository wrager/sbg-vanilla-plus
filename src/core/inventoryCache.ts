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

/**
 * Возвращает GUID'ы точек, у которых хотя бы одна стопка ключей помечена
 * флагом lock (бит 1 поля `f`, refs/game/script.js:3405). Стопки - деталь
 * хранения; в UI игрок видит точку, и lock-семантика пользователю «защитить
 * ключи этой точки от удаления». Поэтому агрегируем per-point: одна locked
 * стопка - вся точка под защитой.
 *
 * Принимает `unknown[]` - позволяет передавать сырой `inventory-cache` без
 * предварительной фильтрации; внутренний `isInventoryReference` отсеивает
 * не-рефы и стопки без поля `f`.
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
