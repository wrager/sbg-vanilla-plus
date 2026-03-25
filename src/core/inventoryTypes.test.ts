import {
  isInventoryCore,
  isInventoryCatalyser,
  isInventoryReference,
  isInventoryReferenceFull,
  isInventoryBroom,
  isInventoryItem,
} from './inventoryTypes';
import {
  ITEM_TYPE_CORE,
  ITEM_TYPE_CATALYSER,
  ITEM_TYPE_REFERENCE,
  ITEM_TYPE_BROOM,
} from './gameConstants';

describe('inventoryTypes', () => {
  const validCore = { g: 'guid1', t: ITEM_TYPE_CORE, l: 5, a: 10 };
  const validCatalyser = { g: 'guid2', t: ITEM_TYPE_CATALYSER, l: 3, a: 5 };
  const validReference = { g: 'guid3', t: ITEM_TYPE_REFERENCE, l: 'point-guid', a: 2 };
  const validReferenceFull = {
    g: 'guid4',
    t: ITEM_TYPE_REFERENCE,
    l: 'point-guid',
    a: 3,
    c: [55.7, 37.6] as [number, number],
    ti: 'Point Title',
  };
  const validBroom = { g: 'guid5', t: ITEM_TYPE_BROOM, l: 1, a: 1 };

  describe('isInventoryCore', () => {
    it('returns true for valid core', () => {
      expect(isInventoryCore(validCore)).toBe(true);
    });

    it('returns false for wrong type', () => {
      expect(isInventoryCore({ ...validCore, t: ITEM_TYPE_CATALYSER })).toBe(false);
    });

    it('returns false for null', () => {
      expect(isInventoryCore(null)).toBe(false);
    });

    it('returns false for non-object', () => {
      expect(isInventoryCore('string')).toBe(false);
    });
  });

  describe('isInventoryCatalyser', () => {
    it('returns true for valid catalyser', () => {
      expect(isInventoryCatalyser(validCatalyser)).toBe(true);
    });

    it('returns false for wrong type', () => {
      expect(isInventoryCatalyser({ ...validCatalyser, t: ITEM_TYPE_CORE })).toBe(false);
    });
  });

  describe('isInventoryReference', () => {
    it('returns true for valid reference', () => {
      expect(isInventoryReference(validReference)).toBe(true);
    });

    it('returns true for full reference (superset)', () => {
      expect(isInventoryReference(validReferenceFull)).toBe(true);
    });

    it('returns false when l is number instead of string', () => {
      expect(isInventoryReference({ ...validReference, l: 42 })).toBe(false);
    });

    it('returns false for wrong type', () => {
      expect(isInventoryReference({ ...validReference, t: ITEM_TYPE_CORE })).toBe(false);
    });
  });

  describe('isInventoryReferenceFull', () => {
    it('returns true for valid full reference', () => {
      expect(isInventoryReferenceFull(validReferenceFull)).toBe(true);
    });

    it('returns false for basic reference without c and ti', () => {
      expect(isInventoryReferenceFull(validReference)).toBe(false);
    });

    it('returns false when c is not an array', () => {
      expect(isInventoryReferenceFull({ ...validReferenceFull, c: 'not-array' })).toBe(false);
    });

    it('returns false when c has wrong length', () => {
      expect(isInventoryReferenceFull({ ...validReferenceFull, c: [1] })).toBe(false);
    });

    it('returns false when c contains non-numbers', () => {
      expect(isInventoryReferenceFull({ ...validReferenceFull, c: ['a', 'b'] })).toBe(false);
    });

    it('returns false when ti is not a string', () => {
      expect(isInventoryReferenceFull({ ...validReferenceFull, ti: 123 })).toBe(false);
    });

    it('returns false for null', () => {
      expect(isInventoryReferenceFull(null)).toBe(false);
    });
  });

  describe('isInventoryBroom', () => {
    it('returns true for valid broom', () => {
      expect(isInventoryBroom(validBroom)).toBe(true);
    });

    it('returns false for wrong type', () => {
      expect(isInventoryBroom({ ...validBroom, t: ITEM_TYPE_CORE })).toBe(false);
    });
  });

  describe('isInventoryItem', () => {
    it('returns true for all valid item types', () => {
      expect(isInventoryItem(validCore)).toBe(true);
      expect(isInventoryItem(validCatalyser)).toBe(true);
      expect(isInventoryItem(validReference)).toBe(true);
      expect(isInventoryItem(validBroom)).toBe(true);
    });

    it('returns false for unknown type', () => {
      expect(isInventoryItem({ g: 'guid', t: 99, l: 1, a: 1 })).toBe(false);
    });

    it('returns false for empty object', () => {
      expect(isInventoryItem({})).toBe(false);
    });
  });
});
