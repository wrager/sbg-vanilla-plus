export interface IInventoryCore {
  g: string;
  t: 1;
  l: number;
  a: number;
}

export interface IInventoryCatalyser {
  g: string;
  t: 2;
  l: number;
  a: number;
}

export interface IInventoryReference {
  g: string;
  t: 3;
  l: string;
  a: number;
}

export interface IInventoryBroom {
  g: string;
  t: 4;
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
    value.t === 1 &&
    typeof value.l === 'number' &&
    typeof value.a === 'number'
  );
}

export function isInventoryCatalyser(value: unknown): value is IInventoryCatalyser {
  return (
    isRecord(value) &&
    typeof value.g === 'string' &&
    value.t === 2 &&
    typeof value.l === 'number' &&
    typeof value.a === 'number'
  );
}

export function isInventoryReference(value: unknown): value is IInventoryReference {
  return (
    isRecord(value) &&
    typeof value.g === 'string' &&
    value.t === 3 &&
    typeof value.l === 'string' &&
    typeof value.a === 'number'
  );
}

export function isInventoryBroom(value: unknown): value is IInventoryBroom {
  return (
    isRecord(value) &&
    typeof value.g === 'string' &&
    value.t === 4 &&
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
