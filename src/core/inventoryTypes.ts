import {
  ITEM_TYPE_CORE,
  ITEM_TYPE_CATALYSER,
  ITEM_TYPE_REFERENCE,
  ITEM_TYPE_BROOM,
} from './gameConstants';

export interface IInventoryCore {
  g: string;
  t: typeof ITEM_TYPE_CORE;
  l: number;
  a: number;
}

export interface IInventoryCatalyser {
  g: string;
  t: typeof ITEM_TYPE_CATALYSER;
  l: number;
  a: number;
}

export interface IInventoryReference {
  g: string;
  t: typeof ITEM_TYPE_REFERENCE;
  l: string;
  a: number;
  // Bitfield-флаги, проставляемые сервером в ответе /api/inventory (SBG 0.6.1+).
  // Бит 0 — favorite, бит 1 — locked. Поле опциональное: на 0.6.0 сервер его
  // не возвращает, и проверки `(item.f & 0bX)` корректно дают 0 для undefined.
  // См. refs/game/script.js:3404-3405 — `is_fav = !!(item?.f & 0b1)`.
  f?: number;
}

/** Нативные флаги SBG 0.6.1, применяемые через POST /api/marks. */
export type MarkFlag = 'favorite' | 'locked';

/**
 * Биты в `IInventoryReference.f` (поле стопки в `inventory-cache`):
 * бит 0 — favorite, бит 1 — locked.
 *
 * Размещены здесь, а не в core/marksApi, чтобы core/inventoryCache мог читать
 * их без циклической зависимости (marksApi импортирует inventoryCache).
 *
 * `as const` сохраняет literal-типы (1 | 2) вместо `number`, позволяя
 * TypeScript точнее проверять использование битовых масок.
 */
export const MARK_FLAG_BITS = {
  favorite: 0b01,
  locked: 0b10,
} as const satisfies Record<MarkFlag, number>;

/** Полные данные ключа из inventory-cache (включая координаты и название точки). */
export interface IInventoryReferenceFull extends IInventoryReference {
  c: [number, number];
  ti: string;
}

export interface IInventoryBroom {
  g: string;
  t: typeof ITEM_TYPE_BROOM;
  l: number;
  a: number;
}

export type IInventoryItem =
  | IInventoryCore
  | IInventoryCatalyser
  | IInventoryReference
  | IInventoryBroom;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function isInventoryCore(value: unknown): value is IInventoryCore {
  return (
    isRecord(value) &&
    typeof value.g === 'string' &&
    value.t === ITEM_TYPE_CORE &&
    typeof value.l === 'number' &&
    typeof value.a === 'number'
  );
}

export function isInventoryCatalyser(value: unknown): value is IInventoryCatalyser {
  return (
    isRecord(value) &&
    typeof value.g === 'string' &&
    value.t === ITEM_TYPE_CATALYSER &&
    typeof value.l === 'number' &&
    typeof value.a === 'number'
  );
}

export function isInventoryReference(value: unknown): value is IInventoryReference {
  if (
    !isRecord(value) ||
    typeof value.g !== 'string' ||
    value.t !== ITEM_TYPE_REFERENCE ||
    typeof value.l !== 'string' ||
    typeof value.a !== 'number'
  ) {
    return false;
  }
  // f опциональный: на 0.6.0 он отсутствует. Если присутствует - обязан быть
  // целым числом: это битовое поле, NaN/Infinity имеют typeof === 'number' но
  // дают 0 при побитовых операциях, маскируя некорректные данные сервера.
  if (value.f !== undefined && !Number.isInteger(value.f)) return false;
  return true;
}

export function isInventoryReferenceFull(value: unknown): value is IInventoryReferenceFull {
  if (!isInventoryReference(value)) return false;
  // as unknown as: после isInventoryReference TS сужает тип, Record-каст требует промежуточный unknown
  const record = value as unknown as Record<string, unknown>;
  return (
    Array.isArray(record.c) &&
    record.c.length === 2 &&
    typeof record.c[0] === 'number' &&
    typeof record.c[1] === 'number' &&
    typeof record.ti === 'string'
  );
}

export function isInventoryBroom(value: unknown): value is IInventoryBroom {
  return (
    isRecord(value) &&
    typeof value.g === 'string' &&
    value.t === ITEM_TYPE_BROOM &&
    typeof value.l === 'number' &&
    typeof value.a === 'number'
  );
}

export function isInventoryItem(value: unknown): value is IInventoryItem {
  return (
    isInventoryCore(value) ||
    isInventoryCatalyser(value) ||
    isInventoryReference(value) ||
    isInventoryBroom(value)
  );
}
