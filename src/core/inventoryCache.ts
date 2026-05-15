import type { IInventoryReference, IInventoryReferenceFull } from './inventoryTypes';
import { isInventoryReference, isInventoryReferenceFull, MARK_FLAG_BITS } from './inventoryTypes';

/**
 * Допустимые значения битовой маски для фильтрации по полю `f`:
 * 1 (favorite), 2 (locked), 3 (favorite | locked).
 */
type FlagMask = 1 | 2 | 3;

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
 * Базовая агрегация per-point по битовой маске флага `f`. Не экспортируется
 * наружу: публичный API ниже (`buildLockedPointGuids`, `buildProtectedPointGuids`)
 * фиксирует доменно-значимые маски, чтобы вызывающий код не передавал сырые
 * биты. Объединение в одной функции исключает класс ошибки рассинхрона guard
 * `item.f === undefined` и фильтра `isInventoryReference` при будущих правках
 * (добавление третьей маски, изменение формата `f`).
 *
 * Принимает `unknown[]` - позволяет передавать сырой `inventory-cache` без
 * предварительной фильтрации; внутренний `isInventoryReference` отсеивает
 * не-рефы и стопки без поля `f`.
 */
function buildPointGuidsByFlagMask(items: readonly unknown[], mask: FlagMask): Set<string> {
  const result = new Set<string>();
  for (const item of items) {
    if (!isInventoryReference(item)) continue;
    if (item.f === undefined) continue;
    if ((item.f & mask) === 0) continue;
    result.add(item.l);
  }
  return result;
}

/**
 * Возвращает GUID'ы точек, у которых хотя бы одна стопка ключей помечена
 * флагом lock (бит 1 поля `f`, refs/game/script.js:3405). Стопки - деталь
 * хранения; в UI игрок видит точку, и lock-семантика пользователю «защитить
 * ключи этой точки от удаления». Поэтому агрегируем per-point: одна locked
 * стопка - вся точка под защитой.
 *
 * Используется для логики миграции legacy SVP/CUI-избранных в нативный lock
 * (`favoritesMigration/migrationApi.ts`), где нужен именно lock-бит, а не
 * «защищена от удаления». Для логики защиты от удаления есть
 * `buildProtectedPointGuids` (ниже): она ловит и lock, и favorite.
 */
export function buildLockedPointGuids(items: readonly unknown[]): Set<string> {
  return buildPointGuidsByFlagMask(items, MARK_FLAG_BITS.locked);
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
 */
export function buildProtectedPointGuids(items: readonly unknown[]): Set<string> {
  // TypeScript не выводит literal-тип из побитового OR; приведение безопасно:
  // 0b01 | 0b10 = 0b11 = 3, входит в FlagMask.
  const protectionMask = (MARK_FLAG_BITS.favorite | MARK_FLAG_BITS.locked) as FlagMask;
  return buildPointGuidsByFlagMask(items, protectionMask);
}

/**
 * Можно ли полагаться на поле `f` стопок для определения защиты ключей. Поле
 * появилось в SBG 0.6.1; на 0.6.0 его нет ни у одной стопки, и любая защита
 * через `buildProtectedPointGuids` молча даст пустой Set - удаление пройдёт
 * вслепую. Проверка through `every`: ВСЕ реф-стопки в кэше должны иметь поле
 * `f`. При mix-кэше (часть с `f`, часть без) стопки без `f` отсеиваются в
 * `buildPointGuidsByFlagMask` (`if (item.f === undefined) continue`), и
 * фактически защищённая точка по своей mix-стопке могла быть удалена.
 * `every` исключает этот класс ошибки целиком, не полагаясь на неявные
 * предположения о поведении сервера.
 *
 * Возвращает `false` для пустого набора рефов: нет стопок - нет evidence,
 * безопаснее не запускать удаление.
 */
export function isProtectionFlagSupportAvailable(items: readonly unknown[]): boolean {
  const refStacks = items.filter(isInventoryReference);
  if (refStacks.length === 0) return false;
  return refStacks.every((item) => item.f !== undefined);
}
