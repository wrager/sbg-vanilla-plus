import {
  isInventoryCore,
  isInventoryCatalyser,
  isInventoryReference,
  isInventoryBroom,
  isInventoryItem,
} from '../../core/inventoryTypes';
import { parseInventoryCache } from './inventoryParser';
import { shouldRunCleanup, calculateDeletions, formatDeletionSummary } from './cleanupCalculator';
import type { ICleanupLimits } from './cleanupSettings';
import { saveCleanupSettings, defaultCleanupSettings } from './cleanupSettings';
import { inventoryCleanup } from './inventoryCleanup';
import { initCleanupSettingsUi, destroyCleanupSettingsUi } from './cleanupSettingsUi';
import { registerModules } from '../../core/moduleRegistry';
import {
  loadFavorites,
  resetForTests as resetFavoritesStoreForTests,
  setLockMigrationDone,
} from '../../core/favoritesStore';

async function seedFavoritesIdb(
  records: { guid: string; cooldown: number | null }[],
): Promise<void> {
  // Заполняет IDB CUI/favorites через прямой вызов API. Тестам нужно подставить
  // легаси-снимок без запуска CUI/нашего модуля - семя ставится напрямую.
  await loadFavorites();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('CUI');
    request.onsuccess = (): void => {
      const db = request.result;
      const tx = db.transaction('favorites', 'readwrite');
      const store = tx.objectStore('favorites');
      for (const record of records) store.put(record);
      tx.oncomplete = (): void => {
        db.close();
        resolve();
      };
      tx.onabort = (): void => {
        db.close();
        reject(tx.error ?? new Error('seed transaction aborted'));
      };
    };
    request.onerror = (): void => {
      reject(request.error ?? new Error('seed IDB open failed'));
    };
  });
}

// --- inventoryTypes ---

describe('isInventoryCore', () => {
  test('accepts valid core', () => {
    expect(isInventoryCore({ g: 'abc', t: 1, l: 5, a: 3 })).toBe(true);
  });

  test('rejects wrong type', () => {
    expect(isInventoryCore({ g: 'abc', t: 2, l: 5, a: 3 })).toBe(false);
  });

  test('rejects missing fields', () => {
    expect(isInventoryCore({ t: 1, l: 5 })).toBe(false);
  });

  test('rejects non-object', () => {
    expect(isInventoryCore('string')).toBe(false);
    expect(isInventoryCore(null)).toBe(false);
  });
});

describe('isInventoryCatalyser', () => {
  test('accepts valid catalyser', () => {
    expect(isInventoryCatalyser({ g: 'abc', t: 2, l: 7, a: 10 })).toBe(true);
  });

  test('rejects wrong type', () => {
    expect(isInventoryCatalyser({ g: 'abc', t: 1, l: 7, a: 10 })).toBe(false);
  });
});

describe('isInventoryReference', () => {
  test('accepts valid reference', () => {
    expect(isInventoryReference({ g: 'abc', t: 3, l: 'point-guid', a: 1 })).toBe(true);
  });

  test('rejects numeric l (wrong type for reference)', () => {
    expect(isInventoryReference({ g: 'abc', t: 3, l: 5, a: 1 })).toBe(false);
  });
});

describe('isInventoryBroom', () => {
  test('accepts valid broom', () => {
    expect(isInventoryBroom({ g: 'abc', t: 4, l: 0, a: 2 })).toBe(true);
  });

  test('rejects wrong type', () => {
    expect(isInventoryBroom({ g: 'abc', t: 3, l: 0, a: 2 })).toBe(false);
  });
});

describe('isInventoryItem', () => {
  test('accepts all valid types', () => {
    expect(isInventoryItem({ g: 'a', t: 1, l: 1, a: 1 })).toBe(true);
    expect(isInventoryItem({ g: 'b', t: 2, l: 2, a: 1 })).toBe(true);
    expect(isInventoryItem({ g: 'c', t: 3, l: 'p', a: 1 })).toBe(true);
    expect(isInventoryItem({ g: 'd', t: 4, l: 0, a: 1 })).toBe(true);
  });

  test('rejects unknown type', () => {
    expect(isInventoryItem({ g: 'a', t: 5, l: 1, a: 1 })).toBe(false);
  });

  test('rejects non-object', () => {
    expect(isInventoryItem(42)).toBe(false);
  });
});

// --- inventoryParser ---

describe('parseInventoryCache', () => {
  afterEach(() => {
    localStorage.removeItem('inventory-cache');
  });

  test('returns empty array when no cache', () => {
    expect(parseInventoryCache()).toEqual([]);
  });

  test('returns empty array for invalid JSON', () => {
    localStorage.setItem('inventory-cache', 'not-json');
    expect(parseInventoryCache()).toEqual([]);
  });

  test('returns empty array for non-array JSON', () => {
    localStorage.setItem('inventory-cache', '{"a":1}');
    expect(parseInventoryCache()).toEqual([]);
  });

  test('filters out invalid items', () => {
    localStorage.setItem(
      'inventory-cache',
      JSON.stringify([
        { g: 'valid', t: 1, l: 5, a: 3 },
        { invalid: true },
        { g: 'also-valid', t: 3, l: 'point', a: 1 },
      ]),
    );
    const result = parseInventoryCache();
    expect(result).toHaveLength(2);
    expect(result[0].g).toBe('valid');
    expect(result[1].g).toBe('also-valid');
  });

  test('parses all item types', () => {
    localStorage.setItem(
      'inventory-cache',
      JSON.stringify([
        { g: 'c1', t: 1, l: 3, a: 10 },
        { g: 'k1', t: 2, l: 7, a: 5 },
        { g: 'r1', t: 3, l: 'pg', a: 2 },
        { g: 'b1', t: 4, l: 0, a: 1 },
      ]),
    );
    const result = parseInventoryCache();
    expect(result).toHaveLength(4);
  });
});

// --- shouldRunCleanup ---

describe('shouldRunCleanup', () => {
  test('returns true when free slots below threshold', () => {
    expect(shouldRunCleanup(2950, 3000, 100)).toBe(true);
  });

  test('returns false when enough free slots', () => {
    expect(shouldRunCleanup(2800, 3000, 100)).toBe(false);
  });

  test('returns true when exactly at threshold', () => {
    expect(shouldRunCleanup(2901, 3000, 100)).toBe(true);
  });

  test('returns false when exactly enough free slots', () => {
    expect(shouldRunCleanup(2900, 3000, 100)).toBe(false);
  });

  test('returns true when inventory is full', () => {
    expect(shouldRunCleanup(3000, 3000, 100)).toBe(true);
  });

  test('returns true when inventory exceeds limit', () => {
    expect(shouldRunCleanup(3050, 3000, 100)).toBe(true);
  });

  test('returns false when inventory is empty', () => {
    expect(shouldRunCleanup(0, 3000, 100)).toBe(false);
  });

  test('returns false with minFreeSlots = 0 when inventory is full', () => {
    // 0 < 0 = false — очистка не нужна, инвентарь ровно на пределе
    expect(shouldRunCleanup(3000, 3000, 0)).toBe(false);
  });

  test('returns true with minFreeSlots = 0 when inventory overflows', () => {
    // -1 < 0 = true — инвентарь превышает лимит
    expect(shouldRunCleanup(3001, 3000, 0)).toBe(true);
  });

  test('returns false with minFreeSlots = 0 when any free space', () => {
    expect(shouldRunCleanup(2999, 3000, 0)).toBe(false);
  });

  test('handles event-boosted limit', () => {
    expect(shouldRunCleanup(3500, 4000, 100)).toBe(false);
    expect(shouldRunCleanup(3950, 4000, 100)).toBe(true);
  });
});

// --- calculateDeletions ---

function unlimitedLimits(): ICleanupLimits {
  const levelLimits: Record<number, number> = {};
  for (let i = 1; i <= 10; i++) levelLimits[i] = -1;
  return {
    cores: { ...levelLimits },
    catalysers: { ...levelLimits },
    referencesMode: 'off',
    referencesFastLimit: -1,
    referencesAlliedLimit: -1,
    referencesNotAlliedLimit: -1,
  };
}

describe('calculateDeletions', () => {
  test('returns empty for empty items array', () => {
    expect(calculateDeletions([], unlimitedLimits())).toEqual([]);
  });

  test('returns empty when all limits unlimited', () => {
    const items = [
      { g: 'c1', t: 1 as const, l: 5, a: 100 },
      { g: 'k1', t: 2 as const, l: 3, a: 50 },
      { g: 'r1', t: 3 as const, l: 'point', a: 200 },
      { g: 'b1', t: 4 as const, l: 0, a: 10 },
    ];
    expect(calculateDeletions(items, unlimitedLimits())).toEqual([]);
  });

  test('returns empty when within limits', () => {
    const limits = unlimitedLimits();
    limits.cores[5] = 100;
    const items = [{ g: 'c1', t: 1 as const, l: 5, a: 50 }];
    expect(calculateDeletions(items, limits)).toEqual([]);
  });

  test('returns empty when count exactly equals limit', () => {
    const limits = unlimitedLimits();
    limits.cores[5] = 10;
    const items = [{ g: 'c1', t: 1 as const, l: 5, a: 10 }];
    expect(calculateDeletions(items, limits)).toEqual([]);
  });

  // --- cores ---

  test('deletes excess cores at specific level', () => {
    const limits = unlimitedLimits();
    limits.cores[5] = 10;
    const items = [{ g: 'c1', t: 1 as const, l: 5, a: 25 }];
    const result = calculateDeletions(items, limits);
    expect(result).toEqual([{ guid: 'c1', type: 1, level: 5, amount: 15 }]);
  });

  test('deletes cores from multiple stacks FIFO', () => {
    const limits = unlimitedLimits();
    limits.cores[3] = 5;
    const items = [
      { g: 'c1', t: 1 as const, l: 3, a: 4 },
      { g: 'c2', t: 1 as const, l: 3, a: 6 },
    ];
    const result = calculateDeletions(items, limits);
    expect(result).toEqual([
      { guid: 'c1', type: 1, level: 3, amount: 4 },
      { guid: 'c2', type: 1, level: 3, amount: 1 },
    ]);
  });

  test('core limit does not affect other levels', () => {
    const limits = unlimitedLimits();
    limits.cores[3] = 0;
    const items = [
      { g: 'c1', t: 1 as const, l: 3, a: 10 },
      { g: 'c2', t: 1 as const, l: 5, a: 10 },
    ];
    const result = calculateDeletions(items, limits);
    expect(result).toEqual([{ guid: 'c1', type: 1, level: 3, amount: 10 }]);
  });

  test('core limit 0 deletes all at that level', () => {
    const limits = unlimitedLimits();
    limits.cores[1] = 0;
    const items = [{ g: 'c1', t: 1 as const, l: 1, a: 20 }];
    const result = calculateDeletions(items, limits);
    expect(result).toEqual([{ guid: 'c1', type: 1, level: 1, amount: 20 }]);
  });

  test('multiple core levels with different limits', () => {
    const limits = unlimitedLimits();
    limits.cores[1] = 5;
    limits.cores[5] = 3;
    limits.cores[10] = 0;
    const items = [
      { g: 'c1', t: 1 as const, l: 1, a: 10 },
      { g: 'c5', t: 1 as const, l: 5, a: 7 },
      { g: 'c10', t: 1 as const, l: 10, a: 2 },
    ];
    const result = calculateDeletions(items, limits);
    expect(result).toEqual([
      { guid: 'c1', type: 1, level: 1, amount: 5 },
      { guid: 'c5', type: 1, level: 5, amount: 4 },
      { guid: 'c10', type: 1, level: 10, amount: 2 },
    ]);
  });

  test('FIFO: deletes entire first stack then partial second', () => {
    const limits = unlimitedLimits();
    limits.cores[2] = 3;
    const items = [
      { g: 'c1', t: 1 as const, l: 2, a: 5 },
      { g: 'c2', t: 1 as const, l: 2, a: 5 },
      { g: 'c3', t: 1 as const, l: 2, a: 5 },
    ];
    const result = calculateDeletions(items, limits);
    expect(result).toEqual([
      { guid: 'c1', type: 1, level: 2, amount: 5 },
      { guid: 'c2', type: 1, level: 2, amount: 5 },
      { guid: 'c3', type: 1, level: 2, amount: 2 },
    ]);
  });

  // --- catalysers ---

  test('deletes excess catalysers', () => {
    const limits = unlimitedLimits();
    limits.catalysers[7] = 3;
    const items = [{ g: 'k1', t: 2 as const, l: 7, a: 8 }];
    const result = calculateDeletions(items, limits);
    expect(result).toEqual([{ guid: 'k1', type: 2, level: 7, amount: 5 }]);
  });

  test('catalyser limit does not affect cores at same level', () => {
    const limits = unlimitedLimits();
    limits.catalysers[5] = 0;
    const items = [
      { g: 'c1', t: 1 as const, l: 5, a: 10 },
      { g: 'k1', t: 2 as const, l: 5, a: 10 },
    ];
    const result = calculateDeletions(items, limits);
    expect(result).toEqual([{ guid: 'k1', type: 2, level: 5, amount: 10 }]);
  });

  test('catalysers FIFO across multiple stacks', () => {
    const limits = unlimitedLimits();
    limits.catalysers[3] = 2;
    const items = [
      { g: 'k1', t: 2 as const, l: 3, a: 3 },
      { g: 'k2', t: 2 as const, l: 3, a: 4 },
    ];
    const result = calculateDeletions(items, limits);
    expect(result).toEqual([
      { guid: 'k1', type: 2, level: 3, amount: 3 },
      { guid: 'k2', type: 2, level: 3, amount: 2 },
    ]);
  });

  // --- references (удаление отключено до модуля «Избранные точки») ---

  test('never deletes references regardless of limit', () => {
    const limits = unlimitedLimits();
    limits.referencesFastLimit = 0;
    const items = [
      { g: 'r1', t: 3 as const, l: 'p1', a: 30 },
      { g: 'r2', t: 3 as const, l: 'p2', a: 40 },
    ];
    const result = calculateDeletions(items, limits);
    const refDeletions = result.filter((entry) => entry.type === 3);
    expect(refDeletions).toEqual([]);
  });

  test('never deletes references even with limit 0 and many stacks', () => {
    const limits = unlimitedLimits();
    limits.referencesFastLimit = 0;
    const items = [
      { g: 'r1', t: 3 as const, l: 'p1', a: 10 },
      { g: 'r2', t: 3 as const, l: 'p2', a: 10 },
      { g: 'r3', t: 3 as const, l: 'p3', a: 10 },
    ];
    const result = calculateDeletions(items, limits);
    const refDeletions = result.filter((entry) => entry.type === 3);
    expect(refDeletions).toEqual([]);
  });

  // --- mixed types ---

  test('handles mixed types with some exceeding (refs untouched)', () => {
    const limits = unlimitedLimits();
    limits.cores[1] = 5;
    limits.referencesFastLimit = 2;
    const items = [
      { g: 'c1', t: 1 as const, l: 1, a: 10 },
      { g: 'c2', t: 1 as const, l: 2, a: 10 },
      { g: 'k1', t: 2 as const, l: 5, a: 10 },
      { g: 'r1', t: 3 as const, l: 'p1', a: 3 },
    ];
    const result = calculateDeletions(items, limits);
    expect(result).toEqual([{ guid: 'c1', type: 1, level: 1, amount: 5 }]);
  });

  test('all types exceeding simultaneously (refs untouched)', () => {
    const limits = unlimitedLimits();
    limits.cores[1] = 2;
    limits.catalysers[1] = 3;
    limits.referencesFastLimit = 1;
    const items = [
      { g: 'c1', t: 1 as const, l: 1, a: 5 },
      { g: 'k1', t: 2 as const, l: 1, a: 6 },
      { g: 'r1', t: 3 as const, l: 'p1', a: 4 },
    ];
    const result = calculateDeletions(items, limits);
    expect(result).toEqual([
      { guid: 'c1', type: 1, level: 1, amount: 3 },
      { guid: 'k1', type: 2, level: 1, amount: 3 },
    ]);
  });

  test('level field is correct for per-level items', () => {
    const limits = unlimitedLimits();
    limits.cores[3] = 1;
    limits.cores[7] = 2;
    const items = [
      { g: 'c3', t: 1 as const, l: 3, a: 5 },
      { g: 'c7', t: 1 as const, l: 7, a: 5 },
    ];
    const result = calculateDeletions(items, limits);
    expect(result).toEqual([
      { guid: 'c3', type: 1, level: 3, amount: 4 },
      { guid: 'c7', type: 1, level: 7, amount: 3 },
    ]);
  });

  test('references are never included in deletions', () => {
    const limits = unlimitedLimits();
    limits.referencesFastLimit = 0;
    const items = [{ g: 'r1', t: 3 as const, l: 'p1', a: 1 }];
    const result = calculateDeletions(items, limits);
    expect(result).toEqual([]);
  });

  test('ignores items with zero amount', () => {
    const limits: ICleanupLimits = {
      cores: { 5: 0 },
      catalysers: {},
      referencesMode: 'off',
      referencesFastLimit: -1,
      referencesAlliedLimit: -1,
      referencesNotAlliedLimit: -1,
    };
    const items = [
      { g: 'c1', t: 1 as const, l: 5, a: 0 },
      { g: 'c2', t: 1 as const, l: 5, a: 3 },
    ];
    const result = calculateDeletions(items, limits);
    expect(result).toEqual([{ guid: 'c2', type: 1, level: 5, amount: 3 }]);
  });

  test('ignores items with negative amount', () => {
    const limits: ICleanupLimits = {
      cores: { 5: 0 },
      catalysers: {},
      referencesMode: 'off',
      referencesFastLimit: -1,
      referencesAlliedLimit: -1,
      referencesNotAlliedLimit: -1,
    };
    const items = [
      { g: 'c1', t: 1 as const, l: 5, a: -5 },
      { g: 'c2', t: 1 as const, l: 5, a: 3 },
    ];
    const result = calculateDeletions(items, limits);
    expect(result).toEqual([{ guid: 'c2', type: 1, level: 5, amount: 3 }]);
  });

  test('never deletes references even with various amounts', () => {
    const limits: ICleanupLimits = {
      cores: {},
      catalysers: {},
      referencesMode: 'fast',
      referencesFastLimit: 0,
      referencesAlliedLimit: -1,
      referencesNotAlliedLimit: -1,
    };
    const items = [
      { g: 'r1', t: 3 as const, l: 'p1', a: 0 },
      { g: 'r2', t: 3 as const, l: 'p2', a: -1 },
      { g: 'r3', t: 3 as const, l: 'p3', a: 5 },
    ];
    const result = calculateDeletions(items, limits);
    expect(result).toEqual([]);
  });

  // --- references fast mode ---

  test('fast mode: ключи не удаляются, если в кэше нет ни одной стопки с полем f (нет lock-поддержки)', () => {
    // На 0.6.0 сервер не отдаёт `f` в инвентаре — нативная защита недоступна,
    // удаление ключей вслепую запрещено. В кэше у всех стопок item.f === undefined.
    const limits = unlimitedLimits();
    limits.referencesMode = 'fast';
    limits.referencesFastLimit = 2;
    const items = [
      { g: 'r1', t: 3 as const, l: 'p1', a: 5 },
      { g: 'r2', t: 3 as const, l: 'p2', a: 3 },
    ];
    const result = calculateDeletions(items, limits);
    expect(result).toEqual([]);
  });

  test('fast mode: mix-кэш (часть стопок без f) блокирует удаление', () => {
    // Регрессия: раньше isProtectionFlagSupportAvailable считался через `some` — хватало
    // одной стопки с `f`, и стопки без `f` могли быть удалены, даже если их
    // точка фактически защищена. Теперь `every` — при mix-кэше удаление
    // блокируется целиком, исключая риск удалить незащищённую часть.
    const limits = unlimitedLimits();
    limits.referencesMode = 'fast';
    limits.referencesFastLimit = 0;
    const items = [
      { g: 'r1', t: 3 as const, l: 'p1', a: 5, f: 0 }, // имеет f
      { g: 'r2', t: 3 as const, l: 'p2', a: 3 }, // без f - mix
    ];
    const result = calculateDeletions(items, limits);
    expect(result).toEqual([]);
  });

  test('fast mode: удаляет лишние ключи от каждой точки отдельно (защита lock или favorite: стопки с f=0)', () => {
    const limits = unlimitedLimits();
    limits.referencesMode = 'fast';
    limits.referencesFastLimit = 2;
    // f=0 — стопка известна серверу как not-locked. Lock-поддержка доступна.
    const items = [
      { g: 'r1', t: 3 as const, l: 'p1', a: 5, f: 0 }, // 5 ключей от p1, лимит 2 → удалить 3
      { g: 'r2', t: 3 as const, l: 'p2', a: 1, f: 0 }, // 1 ключ от p2, лимит 2 → не трогаем
      { g: 'r3', t: 3 as const, l: 'p3', a: 3, f: 0 }, // 3 ключа от p3, лимит 2 → удалить 1
    ];
    const result = calculateDeletions(items, limits);
    expect(result).toEqual([
      { guid: 'r1', type: 3, level: null, amount: 3, pointGuid: 'p1' },
      { guid: 'r3', type: 3, level: null, amount: 1, pointGuid: 'p3' },
    ]);
  });

  test('fast mode: лимит 0 удаляет все ключи от незащищённых точек', () => {
    const limits = unlimitedLimits();
    limits.referencesMode = 'fast';
    limits.referencesFastLimit = 0;
    const items = [
      { g: 'r1', t: 3 as const, l: 'p1', a: 3, f: 0 },
      { g: 'r2', t: 3 as const, l: 'p2', a: 2, f: 0 },
    ];
    const result = calculateDeletions(items, limits);
    expect(result).toEqual([
      { guid: 'r1', type: 3, level: null, amount: 3, pointGuid: 'p1' },
      { guid: 'r2', type: 3, level: null, amount: 2, pointGuid: 'p2' },
    ]);
  });

  test('fast mode: несколько стопок от одной точки — FIFO внутри группы', () => {
    const limits = unlimitedLimits();
    limits.referencesMode = 'fast';
    limits.referencesFastLimit = 2;
    const items = [
      { g: 'r1', t: 3 as const, l: 'p1', a: 3, f: 0 }, // стек 1 от p1
      { g: 'r2', t: 3 as const, l: 'p1', a: 4, f: 0 }, // стек 2 от p1, всего 7, удалить 5
    ];
    const result = calculateDeletions(items, limits);
    // FIFO: 3 из r1, потом 2 из r2.
    expect(result).toEqual([
      { guid: 'r1', type: 3, level: null, amount: 3, pointGuid: 'p1' },
      { guid: 'r2', type: 3, level: null, amount: 2, pointGuid: 'p1' },
    ]);
  });

  test('fast mode: не удаляет ключи защищённых точек с lock (бит 0b10 поля f)', () => {
    const limits = unlimitedLimits();
    limits.referencesMode = 'fast';
    limits.referencesFastLimit = 0;
    const items = [
      { g: 'r1', t: 3 as const, l: 'p1', a: 5, f: 0b10 }, // locked
      { g: 'r2', t: 3 as const, l: 'p2', a: 3, f: 0 },
    ];
    const result = calculateDeletions(items, limits);
    // p1 locked — не трогаем. p2 превышает лимит 0, удаляем всё.
    expect(result).toEqual([{ guid: 'r2', type: 3, level: null, amount: 3, pointGuid: 'p2' }]);
  });

  test('fast mode: агрегация per-point — одна lock-стопка защищает все стопки точки', () => {
    const limits = unlimitedLimits();
    limits.referencesMode = 'fast';
    limits.referencesFastLimit = 0;
    const items = [
      { g: 'r1', t: 3 as const, l: 'p1', a: 5, f: 0b10 }, // locked-стопка точки p1
      { g: 'r2', t: 3 as const, l: 'p1', a: 3, f: 0 }, // вторая стопка той же точки — тоже под защитой
    ];
    const result = calculateDeletions(items, limits);
    expect(result).toEqual([]);
  });

  test('fast mode: favorite-флаг (бит 0b01) защищает от удаления (как и lock)', () => {
    // Постановка обновлена: и lock, и favorite защищают. Семантика для
    // пользователя единая - и замочек, и звёздочка означают «не трогать».
    const limits = unlimitedLimits();
    limits.referencesMode = 'fast';
    limits.referencesFastLimit = 0;
    const items = [
      { g: 'r1', t: 3 as const, l: 'p1', a: 5, f: 0b01 }, // favorite, без lock
    ];
    const result = calculateDeletions(items, limits);
    expect(result).toEqual([]);
  });

  test('fast mode: favorite-агрегация per-point — одна favorite-стопка защищает все стопки точки', () => {
    const limits = unlimitedLimits();
    limits.referencesMode = 'fast';
    limits.referencesFastLimit = 0;
    const items = [
      { g: 'r1', t: 3 as const, l: 'p1', a: 5, f: 0b01 }, // favorite-стопка точки p1
      { g: 'r2', t: 3 as const, l: 'p1', a: 3, f: 0 }, // вторая стопка той же точки — тоже под защитой
    ];
    const result = calculateDeletions(items, limits);
    expect(result).toEqual([]);
  });

  test('off mode: не трогает ключи даже при доступной lock-поддержке', () => {
    const limits = unlimitedLimits();
    limits.referencesMode = 'off';
    limits.referencesFastLimit = 0;
    const items = [{ g: 'r1', t: 3 as const, l: 'p1', a: 5, f: 0 }];
    const result = calculateDeletions(items, limits);
    expect(result).toEqual([]);
  });

  test('slow mode: не трогает ключи автоочисткой (только через кнопку)', () => {
    const limits = unlimitedLimits();
    limits.referencesMode = 'slow';
    limits.referencesAlliedLimit = 0;
    limits.referencesNotAlliedLimit = 0;
    const items = [{ g: 'r1', t: 3 as const, l: 'p1', a: 5, f: 0 }];
    const result = calculateDeletions(items, limits);
    expect(result).toEqual([]);
  });

  test('fast mode limit=-1 не удаляет ничего', () => {
    const limits = unlimitedLimits();
    limits.referencesMode = 'fast';
    limits.referencesFastLimit = -1;
    const items = [{ g: 'r1', t: 3 as const, l: 'p1', a: 100, f: 0 }];
    const result = calculateDeletions(items, limits);
    expect(result).toEqual([]);
  });

  test('slow mode: автоочистка удаляет cores/catalysers, но не ключи', () => {
    const limits = unlimitedLimits();
    limits.referencesMode = 'slow';
    limits.referencesAlliedLimit = 0;
    limits.referencesNotAlliedLimit = 0;
    limits.cores[5] = 2;
    limits.catalysers[3] = 1;
    const items = [
      { g: 'c1', t: 1 as const, l: 5, a: 10 },
      { g: 'k1', t: 2 as const, l: 3, a: 5 },
      { g: 'r1', t: 3 as const, l: 'p1', a: 50, f: 0 },
    ];
    const result = calculateDeletions(items, limits);
    expect(result).toEqual([
      { guid: 'c1', type: 1, level: 5, amount: 8 },
      { guid: 'k1', type: 2, level: 3, amount: 4 },
    ]);
  });

  test('fast mode без lock-поддержки: cores/catalysers удаляются, ключи нет', () => {
    const limits = unlimitedLimits();
    limits.referencesMode = 'fast';
    limits.referencesFastLimit = 0;
    limits.cores[1] = 3;
    const items = [
      { g: 'c1', t: 1 as const, l: 1, a: 10 },
      { g: 'r1', t: 3 as const, l: 'p1', a: 20 }, // f отсутствует
    ];
    const result = calculateDeletions(items, limits);
    // Ключи не удаляются (нет ни одной стопки с f), cores удаляются.
    expect(result).toEqual([{ guid: 'c1', type: 1, level: 1, amount: 7 }]);
  });

  test('off mode: cores/catalysers удаляются, ключи нет', () => {
    const limits = unlimitedLimits();
    limits.referencesMode = 'off';
    limits.cores[5] = 0;
    const items = [
      { g: 'c1', t: 1 as const, l: 5, a: 3 },
      { g: 'r1', t: 3 as const, l: 'p1', a: 10 },
    ];
    const result = calculateDeletions(items, limits);
    expect(result).toEqual([{ guid: 'c1', type: 1, level: 5, amount: 3 }]);
  });
});

// --- formatDeletionSummary ---

describe('formatDeletionSummary', () => {
  test('returns empty string for no deletions', () => {
    expect(formatDeletionSummary([])).toBe('');
  });

  test('formats cores with level', () => {
    const deletions = [{ guid: 'c1', type: 1, level: 5, amount: 15 }];
    expect(formatDeletionSummary(deletions)).toBe('Co5 ×15');
  });

  test('formats catalysers with level', () => {
    const deletions = [{ guid: 'k1', type: 2, level: 3, amount: 7 }];
    expect(formatDeletionSummary(deletions)).toBe('Ca3 ×7');
  });

  test('formats references without level', () => {
    const deletions = [{ guid: 'r1', type: 3, level: null, amount: 20 }];
    expect(formatDeletionSummary(deletions)).toBe('Ref ×20');
  });

  test('groups same type+level and sums amounts', () => {
    const deletions = [
      { guid: 'c1', type: 1, level: 3, amount: 4 },
      { guid: 'c2', type: 1, level: 3, amount: 6 },
    ];
    expect(formatDeletionSummary(deletions)).toBe('Co3 ×10');
  });

  test('formats mixed types', () => {
    const deletions = [
      { guid: 'c1', type: 1, level: 1, amount: 5 },
      { guid: 'k1', type: 2, level: 7, amount: 3 },
      { guid: 'r1', type: 3, level: null, amount: 20 },
    ];
    expect(formatDeletionSummary(deletions)).toBe('Co1 ×5, Ca7 ×3, Ref ×20');
  });

  test('keeps different levels separate', () => {
    const deletions = [
      { guid: 'c1', type: 1, level: 1, amount: 3 },
      { guid: 'c5', type: 1, level: 5, amount: 7 },
    ];
    expect(formatDeletionSummary(deletions)).toBe('Co1 ×3, Co5 ×7');
  });

  test('uses Russian labels when locale is ru', () => {
    localStorage.setItem('settings', JSON.stringify({ lang: 'ru' }));
    const deletions = [
      { guid: 'c1', type: 1, level: 5, amount: 10 },
      { guid: 'k1', type: 2, level: 3, amount: 3 },
      { guid: 'r1', type: 3, level: null, amount: 2 },
    ];
    expect(formatDeletionSummary(deletions)).toBe('Я5 ×10, К3 ×3, Кл ×2');
    localStorage.removeItem('settings');
  });
});

// --- inventoryCleanup module ---

describe('inventoryCleanup module', () => {
  test('has correct metadata', () => {
    expect(inventoryCleanup.id).toBe('inventoryCleanup');
    expect(inventoryCleanup.category).toBe('feature');
    expect(inventoryCleanup.defaultEnabled).toBe(true);
    expect(inventoryCleanup.name.ru).toBe('Автоочистка инвентаря');
    expect(inventoryCleanup.name.en).toBe('Inventory auto-cleanup');
  });

  test('enable adds click listener and disable removes it', async () => {
    const addSpy = jest.spyOn(document, 'addEventListener');
    const removeSpy = jest.spyOn(document, 'removeEventListener');

    await inventoryCleanup.enable();
    expect(addSpy).toHaveBeenCalledWith('click', expect.any(Function), true);

    await inventoryCleanup.disable();
    expect(removeSpy).toHaveBeenCalledWith('click', expect.any(Function), true);

    addSpy.mockRestore();
    removeSpy.mockRestore();
  });

  test('click on non-action button does not trigger cleanup', () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    void inventoryCleanup.enable();

    const button = document.createElement('button');
    button.id = 'some-other-button';
    document.body.appendChild(button);
    button.click();

    expect(consoleSpy).not.toHaveBeenCalled();

    void inventoryCleanup.disable();
    button.remove();
    consoleSpy.mockRestore();
  });

  // runCleanup вызывает fetch → нужен мок
  let originalFetch: typeof window.fetch;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    originalFetch = window.fetch;
    fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ count: { total: 100 } }),
    });
    Object.defineProperty(window, 'fetch', { value: fetchMock, writable: true });
    localStorage.setItem('auth', 'test-token');
  });

  afterEach(() => {
    window.fetch = originalFetch;
    localStorage.removeItem('auth');
  });

  async function flushPromises(): Promise<void> {
    // Несколько тиков, чтобы промис-цепочка runCleanup → deleteInventoryItems → fetch → json
    // полностью завершилась и finally-блок сбросил cleanupInProgress
    for (let i = 0; i < 10; i++) {
      await new Promise((resolve) => {
        process.nextTick(resolve);
      });
    }
  }

  /**
   * Возвращает только вызовы fetch к `/api/inventory` (DELETE), отбрасывая
   * `/api/settings` (POST), который шлёт `nativeGarbageGuard` на enable.
   * Эти тесты проверяют логику cleanup и не должны падать из-за побочного
   * defence-вызова.
   */
  function inventoryDeleteCalls(): unknown[][] {
    const calls = fetchMock.mock.calls as unknown[][];
    return calls.filter((call) => call[0] === '/api/inventory');
  }

  /** Симулирует запись игрой в inventory-cache после ответа discover */
  function simulateDiscoverResponse(): void {
    const cache = localStorage.getItem('inventory-cache') ?? '[]';
    localStorage.setItem('inventory-cache', cache);
  }

  test('click on discover triggers cleanup when inventory is near limit', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

    const invElement = document.createElement('span');
    invElement.id = 'self-info__inv';
    invElement.textContent = '2950';
    document.body.appendChild(invElement);

    const limElement = document.createElement('span');
    limElement.id = 'self-info__inv-lim';
    limElement.textContent = '3000';
    document.body.appendChild(limElement);

    const settings = defaultCleanupSettings();
    settings.limits.cores[5] = 0;
    saveCleanupSettings(settings);

    localStorage.setItem('inventory-cache', JSON.stringify([{ g: 'c1', t: 1, l: 5, a: 8 }]));

    void inventoryCleanup.enable();

    const button = document.createElement('button');
    button.id = 'discover';
    document.body.appendChild(button);
    button.click();
    simulateDiscoverResponse();

    await flushPromises();

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Удалить'),
      expect.arrayContaining([expect.objectContaining({ guid: 'c1', amount: 8 })]),
    );

    const toast = document.querySelector('.svp-toast');
    expect(toast).not.toBeNull();
    expect(toast?.textContent).toContain('Co5 ×8');

    expect(invElement.textContent).toBe('100');

    void inventoryCleanup.disable();
    invElement.remove();
    limElement.remove();
    button.remove();
    toast?.remove();
    localStorage.removeItem('inventory-cache');
    localStorage.removeItem('svp_inventoryCleanup');
    consoleSpy.mockRestore();
  });

  test('updates DOM inventory count after successful cleanup', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ count: { total: 2942 } }),
    });

    const invElement = document.createElement('span');
    invElement.id = 'self-info__inv';
    invElement.textContent = '2950';
    document.body.appendChild(invElement);

    const limElement = document.createElement('span');
    limElement.id = 'self-info__inv-lim';
    limElement.textContent = '3000';
    document.body.appendChild(limElement);

    const settings = defaultCleanupSettings();
    settings.limits.cores[5] = 0;
    saveCleanupSettings(settings);

    localStorage.setItem('inventory-cache', JSON.stringify([{ g: 'c1', t: 1, l: 5, a: 8 }]));

    void inventoryCleanup.enable();

    const button = document.createElement('button');
    button.id = 'discover';
    document.body.appendChild(button);
    button.click();
    simulateDiscoverResponse();

    await flushPromises();

    expect(invElement.textContent).toBe('2942');

    void inventoryCleanup.disable();
    invElement.remove();
    limElement.remove();
    button.remove();
    document.querySelector('.svp-toast')?.remove();
    localStorage.removeItem('inventory-cache');
    localStorage.removeItem('svp_inventoryCleanup');
    consoleSpy.mockRestore();
  });

  test('no cleanup when discover button is disabled', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

    const invElement = document.createElement('span');
    invElement.id = 'self-info__inv';
    invElement.textContent = '2950';
    document.body.appendChild(invElement);

    const limElement = document.createElement('span');
    limElement.id = 'self-info__inv-lim';
    limElement.textContent = '3000';
    document.body.appendChild(limElement);

    const settings = defaultCleanupSettings();
    settings.limits.cores[5] = 0;
    saveCleanupSettings(settings);

    localStorage.setItem('inventory-cache', JSON.stringify([{ g: 'c1', t: 1, l: 5, a: 8 }]));

    void inventoryCleanup.enable();

    const button = document.createElement('button');
    button.id = 'discover';
    button.disabled = true;
    document.body.appendChild(button);
    button.click();

    await flushPromises();

    expect(consoleSpy).not.toHaveBeenCalled();
    expect(inventoryDeleteCalls()).toHaveLength(0);

    void inventoryCleanup.disable();
    invElement.remove();
    limElement.remove();
    button.remove();
    localStorage.removeItem('inventory-cache');
    localStorage.removeItem('svp_inventoryCleanup');
    consoleSpy.mockRestore();
  });

  test('click on discover does not trigger cleanup when inventory has space', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

    const invElement = document.createElement('span');
    invElement.id = 'self-info__inv';
    invElement.textContent = '100';
    document.body.appendChild(invElement);

    const limElement = document.createElement('span');
    limElement.id = 'self-info__inv-lim';
    limElement.textContent = '3000';
    document.body.appendChild(limElement);

    void inventoryCleanup.enable();

    const button = document.createElement('button');
    button.id = 'discover';
    document.body.appendChild(button);
    button.click();
    simulateDiscoverResponse();

    await flushPromises();

    expect(consoleSpy).not.toHaveBeenCalled();

    void inventoryCleanup.disable();
    invElement.remove();
    limElement.remove();
    button.remove();
    consoleSpy.mockRestore();
  });

  test('click on deploy does not trigger cleanup', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

    const invElement = document.createElement('span');
    invElement.id = 'self-info__inv';
    invElement.textContent = '2950';
    document.body.appendChild(invElement);

    const limElement = document.createElement('span');
    limElement.id = 'self-info__inv-lim';
    limElement.textContent = '3000';
    document.body.appendChild(limElement);

    const settings = defaultCleanupSettings();
    settings.limits.cores[5] = 0;
    saveCleanupSettings(settings);

    localStorage.setItem('inventory-cache', JSON.stringify([{ g: 'c1', t: 1, l: 5, a: 8 }]));

    void inventoryCleanup.enable();

    const button = document.createElement('button');
    button.id = 'deploy';
    document.body.appendChild(button);
    button.click();
    // Запись в inventory-cache без предшествующего клика по discover не должна вызвать очистку
    simulateDiscoverResponse();

    await flushPromises();

    expect(consoleSpy).not.toHaveBeenCalled();

    void inventoryCleanup.disable();
    invElement.remove();
    limElement.remove();
    button.remove();
    localStorage.removeItem('inventory-cache');
    localStorage.removeItem('svp_inventoryCleanup');
    consoleSpy.mockRestore();
  });

  test('click on child of discover button triggers cleanup', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

    const invElement = document.createElement('span');
    invElement.id = 'self-info__inv';
    invElement.textContent = '2960';
    document.body.appendChild(invElement);

    const limElement = document.createElement('span');
    limElement.id = 'self-info__inv-lim';
    limElement.textContent = '3000';
    document.body.appendChild(limElement);

    const settings = defaultCleanupSettings();
    settings.limits.cores[1] = 0;
    saveCleanupSettings(settings);

    localStorage.setItem('inventory-cache', JSON.stringify([{ g: 'c1', t: 1, l: 1, a: 3 }]));

    void inventoryCleanup.enable();

    const button = document.createElement('button');
    button.id = 'discover';
    const span = document.createElement('span');
    span.textContent = 'Изучить';
    button.appendChild(span);
    document.body.appendChild(button);

    span.click();
    simulateDiscoverResponse();

    await flushPromises();

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Удалить'), expect.any(Array));

    void inventoryCleanup.disable();
    invElement.remove();
    limElement.remove();
    button.remove();
    localStorage.removeItem('inventory-cache');
    localStorage.removeItem('svp_inventoryCleanup');
    consoleSpy.mockRestore();
  });

  test('click on discover-mod (no-key) triggers cleanup', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

    const invElement = document.createElement('span');
    invElement.id = 'self-info__inv';
    invElement.textContent = '2950';
    document.body.appendChild(invElement);

    const limElement = document.createElement('span');
    limElement.id = 'self-info__inv-lim';
    limElement.textContent = '3000';
    document.body.appendChild(limElement);

    const settings = defaultCleanupSettings();
    settings.limits.cores[5] = 0;
    saveCleanupSettings(settings);

    localStorage.setItem('inventory-cache', JSON.stringify([{ g: 'c1', t: 1, l: 5, a: 8 }]));

    void inventoryCleanup.enable();

    const button = document.createElement('button');
    button.classList.add('discover-mod');
    button.dataset['wish'] = '2';
    document.body.appendChild(button);
    button.click();
    simulateDiscoverResponse();

    await flushPromises();

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Удалить'),
      expect.arrayContaining([expect.objectContaining({ guid: 'c1', amount: 8 })]),
    );

    void inventoryCleanup.disable();
    invElement.remove();
    limElement.remove();
    button.remove();
    document.querySelector('.svp-toast')?.remove();
    localStorage.removeItem('inventory-cache');
    localStorage.removeItem('svp_inventoryCleanup');
    consoleSpy.mockRestore();
  });

  test('click on discover-mod (key-only) triggers cleanup', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

    const invElement = document.createElement('span');
    invElement.id = 'self-info__inv';
    invElement.textContent = '2950';
    document.body.appendChild(invElement);

    const limElement = document.createElement('span');
    limElement.id = 'self-info__inv-lim';
    limElement.textContent = '3000';
    document.body.appendChild(limElement);

    const settings = defaultCleanupSettings();
    settings.limits.cores[5] = 0;
    saveCleanupSettings(settings);

    localStorage.setItem('inventory-cache', JSON.stringify([{ g: 'c1', t: 1, l: 5, a: 8 }]));

    void inventoryCleanup.enable();

    const button = document.createElement('button');
    button.classList.add('discover-mod');
    button.dataset['wish'] = '3';
    document.body.appendChild(button);
    button.click();
    simulateDiscoverResponse();

    await flushPromises();

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Удалить'),
      expect.arrayContaining([expect.objectContaining({ guid: 'c1', amount: 8 })]),
    );

    void inventoryCleanup.disable();
    invElement.remove();
    limElement.remove();
    button.remove();
    document.querySelector('.svp-toast')?.remove();
    localStorage.removeItem('inventory-cache');
    localStorage.removeItem('svp_inventoryCleanup');
    consoleSpy.mockRestore();
  });

  test('click on discover without inventory-cache update does not trigger cleanup', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

    const invElement = document.createElement('span');
    invElement.id = 'self-info__inv';
    invElement.textContent = '2950';
    document.body.appendChild(invElement);

    const limElement = document.createElement('span');
    limElement.id = 'self-info__inv-lim';
    limElement.textContent = '3000';
    document.body.appendChild(limElement);

    const settings = defaultCleanupSettings();
    settings.limits.cores[5] = 0;
    saveCleanupSettings(settings);

    localStorage.setItem('inventory-cache', JSON.stringify([{ g: 'c1', t: 1, l: 5, a: 8 }]));

    void inventoryCleanup.enable();

    const button = document.createElement('button');
    button.id = 'discover';
    document.body.appendChild(button);
    button.click();
    // Не вызываем simulateDiscoverResponse — сервер не ответил

    await flushPromises();

    expect(consoleSpy).not.toHaveBeenCalled();
    expect(inventoryDeleteCalls()).toHaveLength(0);

    void inventoryCleanup.disable();
    invElement.remove();
    limElement.remove();
    button.remove();
    localStorage.removeItem('inventory-cache');
    localStorage.removeItem('svp_inventoryCleanup');
    consoleSpy.mockRestore();
  });

  test('concurrent clicks do not trigger duplicate cleanup', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

    const invElement = document.createElement('span');
    invElement.id = 'self-info__inv';
    invElement.textContent = '2950';
    document.body.appendChild(invElement);

    const limElement = document.createElement('span');
    limElement.id = 'self-info__inv-lim';
    limElement.textContent = '3000';
    document.body.appendChild(limElement);

    const settings = defaultCleanupSettings();
    settings.limits.cores[5] = 0;
    saveCleanupSettings(settings);

    localStorage.setItem('inventory-cache', JSON.stringify([{ g: 'c1', t: 1, l: 5, a: 8 }]));
    localStorage.setItem('auth', 'test-token');

    void inventoryCleanup.enable();

    const button = document.createElement('button');
    button.id = 'discover';
    document.body.appendChild(button);

    button.click();
    simulateDiscoverResponse();
    button.click();
    simulateDiscoverResponse();

    await flushPromises();

    expect(inventoryDeleteCalls()).toHaveLength(1);

    void inventoryCleanup.disable();
    invElement.remove();
    limElement.remove();
    button.remove();
    localStorage.removeItem('inventory-cache');
    localStorage.removeItem('svp_inventoryCleanup');
    localStorage.removeItem('auth');
    consoleSpy.mockRestore();
  });

  // Регрессия на гонку snapshot: bootstrap.initModules запускает init модулей
  // параллельно. inventoryCleanup.enable() уже работает, а favoritesMigration.init()
  // (await loadFavorites) ещё не закончил. Без guard'а первый discover в этом
  // окне удалил бы legacy-favorited ключи. Эмулируем через registerModules с
  // favoritesMigration в status='ready' и реальный favoritesStore с
  // snapshotLoaded=false (resetForTests сбрасывает в false).
  describe('snapshot race: legacy SVP/CUI-favorites не теряются до загрузки IDB', () => {
    test('snapshot не готов и модуль миграции активен — рефы не удаляются', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      // favoritesMigration зарегистрирован, status='ready', settings разрешают.
      registerModules([
        {
          id: 'favoritesMigration',
          name: { en: '', ru: '' },
          description: { en: '', ru: '' },
          defaultEnabled: true,
          category: 'utility',
          status: 'ready',
          init() {},
          enable() {},
          disable() {},
        },
      ]);
      // Snapshot нарочно не загружен: resetForTests ставит snapshotLoaded=false.
      resetFavoritesStoreForTests();

      const invElement = document.createElement('span');
      invElement.id = 'self-info__inv';
      invElement.textContent = '2950';
      document.body.appendChild(invElement);

      const limElement = document.createElement('span');
      limElement.id = 'self-info__inv-lim';
      limElement.textContent = '3000';
      document.body.appendChild(limElement);

      const settings = defaultCleanupSettings();
      settings.limits.referencesMode = 'fast';
      settings.limits.referencesFastLimit = 1;
      saveCleanupSettings(settings);

      // Кэш с lock-поддержкой (есть f), две стопки от одной точки сверх лимита.
      localStorage.setItem(
        'inventory-cache',
        JSON.stringify([
          { g: 'r1', t: 3, l: 'p1', a: 5, f: 0 },
          { g: 'r2', t: 3, l: 'p1', a: 3, f: 0 },
        ]),
      );

      void inventoryCleanup.enable();

      const button = document.createElement('button');
      button.id = 'discover';
      document.body.appendChild(button);
      button.click();
      simulateDiscoverResponse();

      await flushPromises();

      // DELETE к /api/inventory вообще не отправлялся (cores/cats нет, ключи
      // заблокированы snapshot-guard'ом).
      expect(inventoryDeleteCalls()).toHaveLength(0);

      void inventoryCleanup.disable();
      registerModules([]);
      invElement.remove();
      limElement.remove();
      button.remove();
      localStorage.removeItem('inventory-cache');
      localStorage.removeItem('svp_inventoryCleanup');
      consoleSpy.mockRestore();
    });

    test('snapshot готов, легаси-список пуст — рефы удаляются по обычным лимитам', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      registerModules([
        {
          id: 'favoritesMigration',
          name: { en: '', ru: '' },
          description: { en: '', ru: '' },
          defaultEnabled: true,
          category: 'utility',
          status: 'ready',
          init() {},
          enable() {},
          disable() {},
        },
      ]);
      // Имитируем успешный loadFavorites с пустой IDB (новый юзер).
      resetFavoritesStoreForTests();
      await loadFavorites();

      const invElement = document.createElement('span');
      invElement.id = 'self-info__inv';
      invElement.textContent = '2950';
      document.body.appendChild(invElement);

      const limElement = document.createElement('span');
      limElement.id = 'self-info__inv-lim';
      limElement.textContent = '3000';
      document.body.appendChild(limElement);

      const settings = defaultCleanupSettings();
      settings.limits.referencesMode = 'fast';
      settings.limits.referencesFastLimit = 1;
      saveCleanupSettings(settings);

      localStorage.setItem(
        'inventory-cache',
        JSON.stringify([
          { g: 'r1', t: 3, l: 'p1', a: 5, f: 0 },
          { g: 'r2', t: 3, l: 'p1', a: 3, f: 0 },
        ]),
      );

      void inventoryCleanup.enable();

      const button = document.createElement('button');
      button.id = 'discover';
      document.body.appendChild(button);
      button.click();
      simulateDiscoverResponse();

      await flushPromises();

      // Snapshot готов и пуст — guard не срабатывает, удаление ключей идёт.
      expect(inventoryDeleteCalls().length).toBeGreaterThan(0);

      void inventoryCleanup.disable();
      registerModules([]);
      resetFavoritesStoreForTests();
      invElement.remove();
      limElement.remove();
      button.remove();
      localStorage.removeItem('inventory-cache');
      localStorage.removeItem('svp_inventoryCleanup');
      consoleSpy.mockRestore();
    });

    test('lock-migration-done выставлен → cleanup ключей не блокируется даже при непустом legacy', async () => {
      // После успешной миграции в native lock пользователь подтвердил, что
      // защиту обеспечивает нативный lock-флаг. Legacy-список становится
      // архивом, не должен влиять на cleanup. Это тот самый сценарий, который
      // ломал прежнюю логику ("Run favorites migration first" после успешной
      // миграции, потому что IDB остался непустым).
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      registerModules([
        {
          id: 'favoritesMigration',
          name: { en: '', ru: '' },
          description: { en: '', ru: '' },
          defaultEnabled: true,
          category: 'utility',
          status: 'ready',
          init() {},
          enable() {},
          disable() {},
        },
      ]);
      resetFavoritesStoreForTests();
      // legacy-список НЕпустой (IDB после миграции не очищается).
      await seedFavoritesIdb([{ guid: 'p1', cooldown: null }]);
      await loadFavorites();
      // Пользователь подтвердил миграцию через успешный Mark as locked.
      setLockMigrationDone();

      const invElement = document.createElement('span');
      invElement.id = 'self-info__inv';
      invElement.textContent = '2950';
      document.body.appendChild(invElement);

      const limElement = document.createElement('span');
      limElement.id = 'self-info__inv-lim';
      limElement.textContent = '3000';
      document.body.appendChild(limElement);

      const settings = defaultCleanupSettings();
      settings.limits.referencesMode = 'fast';
      settings.limits.referencesFastLimit = 1;
      saveCleanupSettings(settings);

      // Кэш с lock-поддержкой, точка p1 НЕ locked нативно (но мы доверяем
      // флагу: пользователь сказал "миграция сделана", дальше его выбор).
      // Точка p2 не в legacy и не locked, должна быть удалена.
      localStorage.setItem(
        'inventory-cache',
        JSON.stringify([{ g: 'r2', t: 3, l: 'p2', a: 5, f: 0 }]),
      );

      void inventoryCleanup.enable();

      const button = document.createElement('button');
      button.id = 'discover';
      document.body.appendChild(button);
      button.click();
      simulateDiscoverResponse();

      await flushPromises();

      // Удаление ключей идёт - lock-migration-done снимает блок legacy.
      expect(inventoryDeleteCalls().length).toBeGreaterThan(0);

      void inventoryCleanup.disable();
      registerModules([]);
      resetFavoritesStoreForTests();
      invElement.remove();
      limElement.remove();
      button.remove();
      localStorage.removeItem('inventory-cache');
      localStorage.removeItem('svp_inventoryCleanup');
      consoleSpy.mockRestore();
    });

    test('lock-migration-done выставлен: native lock-флаг ВСЁ РАВНО защищает стопку от удаления', async () => {
      // Документированная семантика lock-migration-done: после миграции
      // защита переходит на нативный lock/favorite-флаг; legacy-список
      // становится архивом. Это значит, что для конкретной стопки с f=0b10
      // защита обеспечивается через buildProtectedPointGuids в
      // calculateDeletions (отфильтровывается до подсчёта) и через final
      // guard в deleteInventoryItems (блокирует, если что-то прошло).
      //
      // Без этого теста инвариант "флаг lock-migration-done не подавляет
      // нативную защиту" формализован только в комментариях. Если кто-то
      // изменит calculateDeletions так, чтобы при флаге=true пропускать
      // фильтр по protectedPointGuids, тесты выше (про unblock) останутся
      // зелёными - там точка не защищённая в кэше.
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      registerModules([
        {
          id: 'favoritesMigration',
          name: { en: '', ru: '' },
          description: { en: '', ru: '' },
          defaultEnabled: true,
          category: 'utility',
          status: 'ready',
          init() {},
          enable() {},
          disable() {},
        },
      ]);
      resetFavoritesStoreForTests();
      await loadFavorites();
      setLockMigrationDone();

      const invElement = document.createElement('span');
      invElement.id = 'self-info__inv';
      invElement.textContent = '2950';
      document.body.appendChild(invElement);

      const limElement = document.createElement('span');
      limElement.id = 'self-info__inv-lim';
      limElement.textContent = '3000';
      document.body.appendChild(limElement);

      const settings = defaultCleanupSettings();
      settings.limits.referencesMode = 'fast';
      settings.limits.referencesFastLimit = 1;
      saveCleanupSettings(settings);

      // Точка p-locked: locked в нативе (f=0b10), 5 ключей. Должна остаться.
      // Точка p-free: НЕ locked (f=0), 5 ключей. Лимит=1 -> 4 уйдут в deletions.
      localStorage.setItem(
        'inventory-cache',
        JSON.stringify([
          { g: 'r-locked', t: 3, l: 'p-locked', a: 5, f: 0b10 },
          { g: 'r-free', t: 3, l: 'p-free', a: 5, f: 0 },
        ]),
      );

      void inventoryCleanup.enable();

      const button = document.createElement('button');
      button.id = 'discover';
      document.body.appendChild(button);
      button.click();
      simulateDiscoverResponse();

      await flushPromises();

      // Удаление должно пройти, но ТОЛЬКО для p-free.
      const calls = inventoryDeleteCalls();
      expect(calls.length).toBeGreaterThan(0);
      // Тело каждого fetch'а DELETE содержит selection с guid'ами стопок.
      // r-locked в selection быть не должно ни в одном вызове.
      for (const call of calls) {
        const init = call[1];
        if (typeof init !== 'object' || init === null) continue;
        const body = (init as { body?: unknown }).body;
        if (typeof body !== 'string') continue;
        expect(body).not.toContain('r-locked');
      }

      void inventoryCleanup.disable();
      registerModules([]);
      resetFavoritesStoreForTests();
      invElement.remove();
      limElement.remove();
      button.remove();
      localStorage.removeItem('inventory-cache');
      localStorage.removeItem('svp_inventoryCleanup');
      consoleSpy.mockRestore();
    });
  });
});

// --- cleanupSettingsUi ---

describe('cleanupSettingsUi', () => {
  afterEach(() => {
    destroyCleanupSettingsUi();
    document.body.innerHTML = '';
    localStorage.removeItem('svp_inventoryCleanup');
  });

  test('injectStyles adds style element on init', () => {
    initCleanupSettingsUi();
    const styleElement = document.getElementById('svp-inventoryCleanup');
    expect(styleElement).not.toBeNull();
  });

  test('destroyCleanupSettingsUi removes style element', () => {
    initCleanupSettingsUi();
    destroyCleanupSettingsUi();
    const styleElement = document.getElementById('svp-inventoryCleanup');
    expect(styleElement).toBeNull();
  });

  test('injects configure button into module row', () => {
    const settingsPanel = document.createElement('div');
    settingsPanel.id = 'svp-settings-panel';
    const row = document.createElement('div');
    row.className = 'svp-module-row';
    const nameLine = document.createElement('div');
    nameLine.className = 'svp-module-name-line';
    const moduleId = document.createElement('div');
    moduleId.className = 'svp-module-id';
    moduleId.textContent = 'inventoryCleanup';
    nameLine.appendChild(moduleId);
    row.appendChild(nameLine);
    settingsPanel.appendChild(row);
    document.body.appendChild(settingsPanel);

    initCleanupSettingsUi();

    const configButton = document.querySelector('.svp-cleanup-configure-button');
    expect(configButton).not.toBeNull();
  });
});
