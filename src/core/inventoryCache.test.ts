import {
  INVENTORY_CACHE_KEY,
  readInventoryCache,
  readInventoryReferences,
  readFullInventoryReferences,
  buildLockedPointGuids,
  buildProtectedPointGuids,
  isProtectionFlagSupportAvailable,
} from './inventoryCache';
import { ITEM_TYPE_REFERENCE, ITEM_TYPE_CORE } from './gameConstants';
import type { IInventoryItem } from './inventoryTypes';

beforeEach(() => {
  localStorage.clear();
});

describe('INVENTORY_CACHE_KEY', () => {
  it('equals "inventory-cache"', () => {
    expect(INVENTORY_CACHE_KEY).toBe('inventory-cache');
  });
});

describe('readInventoryCache', () => {
  it('returns empty array when key is missing', () => {
    expect(readInventoryCache()).toEqual([]);
  });

  it('returns empty array for invalid JSON', () => {
    localStorage.setItem(INVENTORY_CACHE_KEY, '{broken');
    expect(readInventoryCache()).toEqual([]);
  });

  it('returns empty array when value is not an array', () => {
    localStorage.setItem(INVENTORY_CACHE_KEY, JSON.stringify({ key: 'value' }));
    expect(readInventoryCache()).toEqual([]);
  });

  it('returns parsed array as-is', () => {
    const items = [{ t: 1 }, { t: 2 }, 'garbage'];
    localStorage.setItem(INVENTORY_CACHE_KEY, JSON.stringify(items));
    expect(readInventoryCache()).toEqual(items);
  });

  it('returns empty array for empty string', () => {
    localStorage.setItem(INVENTORY_CACHE_KEY, '');
    expect(readInventoryCache()).toEqual([]);
  });
});

describe('readInventoryReferences', () => {
  it('returns only references from cache', () => {
    const items = [
      { g: 'core1', t: ITEM_TYPE_CORE, l: 5, a: 10 },
      { g: 'ref1', t: ITEM_TYPE_REFERENCE, l: 'point-a', a: 2 },
      { g: 'ref2', t: ITEM_TYPE_REFERENCE, l: 'point-b', a: 3 },
    ];
    localStorage.setItem(INVENTORY_CACHE_KEY, JSON.stringify(items));

    const result = readInventoryReferences();
    expect(result).toHaveLength(2);
    expect(result[0].g).toBe('ref1');
    expect(result[1].g).toBe('ref2');
  });

  it('returns empty array when no references', () => {
    const items = [{ g: 'core1', t: ITEM_TYPE_CORE, l: 5, a: 10 }];
    localStorage.setItem(INVENTORY_CACHE_KEY, JSON.stringify(items));
    expect(readInventoryReferences()).toEqual([]);
  });

  it('returns empty array when cache is empty', () => {
    expect(readInventoryReferences()).toEqual([]);
  });
});

describe('readFullInventoryReferences', () => {
  it('returns only full references with coordinates and title', () => {
    const items = [
      { g: 'ref1', t: ITEM_TYPE_REFERENCE, l: 'point-a', a: 2 },
      { g: 'ref2', t: ITEM_TYPE_REFERENCE, l: 'point-b', a: 3, c: [55.7, 37.6], ti: 'Title' },
    ];
    localStorage.setItem(INVENTORY_CACHE_KEY, JSON.stringify(items));

    const result = readFullInventoryReferences();
    expect(result).toHaveLength(1);
    expect(result[0].g).toBe('ref2');
    expect(result[0].ti).toBe('Title');
  });

  it('returns empty array when no full references', () => {
    const items = [{ g: 'ref1', t: ITEM_TYPE_REFERENCE, l: 'point-a', a: 2 }];
    localStorage.setItem(INVENTORY_CACHE_KEY, JSON.stringify(items));
    expect(readFullInventoryReferences()).toEqual([]);
  });
});

function ref(g: string, point: string, amount: number, f?: number): IInventoryItem {
  const item: { g: string; t: number; l: string; a: number; f?: number } = {
    g,
    t: ITEM_TYPE_REFERENCE,
    l: point,
    a: amount,
  };
  if (f !== undefined) item.f = f;
  return item as IInventoryItem;
}

describe('buildLockedPointGuids', () => {
  test('lock-flag (bit 1) adds point', () => {
    const items = [ref('s1', 'p1', 5, 0b10)];
    expect([...buildLockedPointGuids(items)]).toEqual(['p1']);
  });

  test('favorite-flag (bit 0) alone does NOT add point (lock-only semantics)', () => {
    const items = [ref('s1', 'p1', 5, 0b01)];
    expect(buildLockedPointGuids(items).size).toBe(0);
  });

  test('per-point aggregation: one locked stack => entire point locked', () => {
    const items = [ref('stack-a', 'p1', 3, 0b10), ref('stack-b', 'p1', 2, 0)];
    expect([...buildLockedPointGuids(items)]).toEqual(['p1']);
  });

  test('ignores entries without f field (0.6.0 compatibility)', () => {
    const items = [ref('s1', 'p1', 5)];
    expect(buildLockedPointGuids(items).size).toBe(0);
  });
});

describe('buildProtectedPointGuids', () => {
  test('empty inventory: empty Set', () => {
    expect(buildProtectedPointGuids([]).size).toBe(0);
  });

  test('ignores entries without f field (0.6.0 compatibility)', () => {
    const items = [ref('s1', 'p1', 5)];
    expect(buildProtectedPointGuids(items).size).toBe(0);
  });

  test('lock-flag (bit 1) protects', () => {
    const items = [ref('s1', 'p1', 5, 0b10)];
    expect([...buildProtectedPointGuids(items)]).toEqual(['p1']);
  });

  test('favorite-flag (bit 0) protects', () => {
    const items = [ref('s1', 'p1', 5, 0b01)];
    expect([...buildProtectedPointGuids(items)]).toEqual(['p1']);
  });

  test('lock + favorite (bits 0 and 1) - point is protected', () => {
    const items = [ref('s1', 'p1', 5, 0b11)];
    expect([...buildProtectedPointGuids(items)]).toEqual(['p1']);
  });

  test('per-point aggregation: one locked stack => entire point protected', () => {
    const items = [ref('stack-a', 'p1', 3, 0b10), ref('stack-b', 'p1', 2, 0)];
    expect([...buildProtectedPointGuids(items)]).toEqual(['p1']);
  });

  test('per-point aggregation: one favorite stack => entire point protected', () => {
    const items = [ref('stack-a', 'p1', 3, 0b01), ref('stack-b', 'p1', 2, 0)];
    expect([...buildProtectedPointGuids(items)]).toEqual(['p1']);
  });

  test('per-point aggregation: mixed stacks (one favorite, one lock) - point protected once', () => {
    const items = [ref('stack-a', 'p1', 3, 0b01), ref('stack-b', 'p1', 2, 0b10)];
    expect([...buildProtectedPointGuids(items)]).toEqual(['p1']);
  });

  test('different points are protected independently', () => {
    const items = [
      ref('s1', 'p-lock', 3, 0b10),
      ref('s2', 'p-fav', 2, 0b01),
      ref('s3', 'p-open', 4, 0),
    ];
    expect(buildProtectedPointGuids(items)).toEqual(new Set(['p-lock', 'p-fav']));
  });

  test('f=0 does not protect', () => {
    const items = [ref('s1', 'p1', 5, 0)];
    expect(buildProtectedPointGuids(items).size).toBe(0);
  });

  test('ignores non-refs (cores/cats), even if they have a similar field', () => {
    const core = { g: 'c1', t: ITEM_TYPE_CORE, l: 5, a: 10, f: 0b11 };
    expect(buildProtectedPointGuids([core]).size).toBe(0);
  });
});

describe('isProtectionFlagSupportAvailable', () => {
  test('empty ref set: false (no evidence)', () => {
    expect(isProtectionFlagSupportAvailable([])).toBe(false);
  });

  test('all stacks without f field (0.6.0): false', () => {
    const items = [ref('s1', 'p1', 5), ref('s2', 'p2', 3)];
    expect(isProtectionFlagSupportAvailable(items)).toBe(false);
  });

  test('all stacks with f field (0.6.1+): true', () => {
    const items = [ref('s1', 'p1', 5, 0), ref('s2', 'p2', 3, 0b10)];
    expect(isProtectionFlagSupportAvailable(items)).toBe(true);
  });

  test('mix-cache (some with f, some without): false - blocks entirely', () => {
    const items = [ref('s1', 'p1', 5, 0), ref('s2', 'p2', 3)];
    expect(isProtectionFlagSupportAvailable(items)).toBe(false);
  });

  test('ignores non-refs when counting: set without ref stacks -> false', () => {
    const core = { g: 'c1', t: ITEM_TYPE_CORE, l: 1, a: 10, f: 0b11 };
    expect(isProtectionFlagSupportAvailable([core])).toBe(false);
  });
});
