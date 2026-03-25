import {
  INVENTORY_CACHE_KEY,
  readInventoryCache,
  readInventoryReferences,
  readFullInventoryReferences,
} from './inventoryCache';
import { ITEM_TYPE_REFERENCE, ITEM_TYPE_CORE } from './gameConstants';

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
