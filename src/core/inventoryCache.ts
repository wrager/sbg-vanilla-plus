import type { IInventoryReference, IInventoryReferenceFull } from './inventoryTypes';
import { isInventoryReference, isInventoryReferenceFull, MARK_FLAG_BITS } from './inventoryTypes';

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
 *
 * Используется для логики миграции legacy SVP/CUI-избранных в нативный lock
 * (`favoritesMigration/migrationApi.ts`), где нужен именно lock-бит, а не
 * «защищена от удаления». Для логики защиты от удаления есть
 * `buildProtectedPointGuids` (ниже): она ловит и lock, и favorite.
 */
export function buildLockedPointGuids(items: readonly unknown[]): Set<string> {
  const locked = new Set<string>();
  for (const item of items) {
    if (!isInventoryReference(item)) continue;
    if (item.f === undefined) continue;
    if ((item.f & MARK_FLAG_BITS.locked) === 0) continue;
    locked.add(item.l);
  }
  return locked;
}

/**
 * Возвращает GUID'ы точек, защищённых от удаления: хотя бы одна стопка ключей
 * помечена флагом lock (бит 1) ИЛИ favorite (бит 0) поля `f`. Семантика
 * пользователю едина: «эту точку я отметил - её ключи не удалять автоочисткой
 * и не удалять через viewer refsOnMap». Lock в SBG 0.6.1 - явный замочек,
 * favorite - звёздочка; оба знака пользователь ставит сам, и оба означают
 * «не трогать».
 *
 * Per-point агрегация та же, что и у `buildLockedPointGuids`: одна
 * защищённая стопка - вся точка под защитой. Игрок видит точку, не стопку.
 *
 * Принимает `unknown[]` - позволяет передавать сырой `inventory-cache` без
 * предварительной фильтрации; внутренний `isInventoryReference` отсеивает
 * не-рефы и стопки без поля `f`.
 */
export function buildProtectedPointGuids(items: readonly unknown[]): Set<string> {
  const protectedGuids = new Set<string>();
  for (const item of items) {
    if (!isInventoryReference(item)) continue;
    if (item.f === undefined) continue;
    if ((item.f & 0b11) === 0) continue;
    protectedGuids.add(item.l);
  }
  return protectedGuids;
}
