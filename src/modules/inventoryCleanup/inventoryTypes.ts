import {
  ITEM_TYPE_CORE,
  ITEM_TYPE_CATALYSER,
  ITEM_TYPE_REFERENCE,
  ITEM_TYPE_BROOM,
} from '../../core/gameConstants';

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
  return (
    isRecord(value) &&
    typeof value.g === 'string' &&
    value.t === ITEM_TYPE_REFERENCE &&
    typeof value.l === 'string' &&
    typeof value.a === 'number'
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
