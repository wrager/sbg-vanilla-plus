import { ITEM_TYPE_REFERENCE } from '../../core/gameConstants';
import type { IRefByGuid } from './slowRefsDelete';
import { calculateSlowDeletions, collectOverLimit } from './slowRefsDelete';
import type { IDeletionEntry } from './cleanupCalculator';
import { calculateDeletions } from './cleanupCalculator';

// --- collectOverLimit ---

describe('collectOverLimit', () => {
  test('limit=-1 не удаляет ничего', () => {
    const refs: IRefByGuid[] = [{ itemGuid: 'r1', pointGuid: 'p1', amount: 100 }];
    const deletions: IDeletionEntry[] = [];
    collectOverLimit(refs, -1, deletions);
    expect(deletions).toEqual([]);
  });

  test('limit=0 удаляет все ключи от каждой точки', () => {
    const refs: IRefByGuid[] = [
      { itemGuid: 'r1', pointGuid: 'p1', amount: 5 },
      { itemGuid: 'r2', pointGuid: 'p2', amount: 3 },
    ];
    const deletions: IDeletionEntry[] = [];
    collectOverLimit(refs, 0, deletions);
    expect(deletions).toEqual([
      { guid: 'r1', type: ITEM_TYPE_REFERENCE, level: null, amount: 5, pointGuid: 'p1' },
      { guid: 'r2', type: ITEM_TYPE_REFERENCE, level: null, amount: 3, pointGuid: 'p2' },
    ]);
  });

  test('per-point лимит: каждая точка рассчитывается отдельно', () => {
    const refs: IRefByGuid[] = [
      { itemGuid: 'r1', pointGuid: 'p1', amount: 10 },
      { itemGuid: 'r2', pointGuid: 'p2', amount: 3 },
    ];
    const deletions: IDeletionEntry[] = [];
    collectOverLimit(refs, 5, deletions);
    // p1: 10-5=5 к удалению. p2: 3<=5, ок.
    expect(deletions).toEqual([
      { guid: 'r1', type: ITEM_TYPE_REFERENCE, level: null, amount: 5, pointGuid: 'p1' },
    ]);
  });

  test('multi-stack одной точки: FIFO внутри группы', () => {
    const refs: IRefByGuid[] = [
      { itemGuid: 'r1', pointGuid: 'p1', amount: 4 },
      { itemGuid: 'r2', pointGuid: 'p1', amount: 6 },
    ];
    const deletions: IDeletionEntry[] = [];
    collectOverLimit(refs, 3, deletions);
    // p1: всего 10, лимит 3, excess 7. FIFO: 4 из r1, 3 из r2.
    expect(deletions).toEqual([
      { guid: 'r1', type: ITEM_TYPE_REFERENCE, level: null, amount: 4, pointGuid: 'p1' },
      { guid: 'r2', type: ITEM_TYPE_REFERENCE, level: null, amount: 3, pointGuid: 'p1' },
    ]);
  });

  test('количество в пределах лимита — ничего не удаляется', () => {
    const refs: IRefByGuid[] = [{ itemGuid: 'r1', pointGuid: 'p1', amount: 2 }];
    const deletions: IDeletionEntry[] = [];
    collectOverLimit(refs, 5, deletions);
    expect(deletions).toEqual([]);
  });

  test('количество ровно равно лимиту — ничего не удаляется', () => {
    const refs: IRefByGuid[] = [{ itemGuid: 'r1', pointGuid: 'p1', amount: 5 }];
    const deletions: IDeletionEntry[] = [];
    collectOverLimit(refs, 5, deletions);
    expect(deletions).toEqual([]);
  });

  test('пустой массив refs — ничего не удаляется', () => {
    const deletions: IDeletionEntry[] = [];
    collectOverLimit([], 0, deletions);
    expect(deletions).toEqual([]);
  });
});

// --- calculateSlowDeletions ---

describe('calculateSlowDeletions', () => {
  const PLAYER_TEAM = 1;
  const ENEMY_TEAM = 2;

  test('allied и hostile лимиты применяются к разным фракциям', () => {
    const refs: IRefByGuid[] = [
      { itemGuid: 'a1', pointGuid: 'pa', amount: 10 }, // allied
      { itemGuid: 'h1', pointGuid: 'ph', amount: 8 }, // hostile
    ];
    const teams = new Map<string, number | null>([
      ['pa', PLAYER_TEAM],
      ['ph', ENEMY_TEAM],
    ]);
    const result = calculateSlowDeletions(refs, teams, PLAYER_TEAM, 3, 2);
    // allied pa: 10-3=7. hostile ph: 8-2=6.
    expect(result).toEqual([
      { guid: 'a1', type: ITEM_TYPE_REFERENCE, level: null, amount: 7, pointGuid: 'pa' },
      { guid: 'h1', type: ITEM_TYPE_REFERENCE, level: null, amount: 6, pointGuid: 'ph' },
    ]);
  });

  test('unknown team (null) — ключ не трогается', () => {
    const refs: IRefByGuid[] = [
      { itemGuid: 'r1', pointGuid: 'p1', amount: 100 },
      { itemGuid: 'r2', pointGuid: 'p2', amount: 50 },
    ];
    const teams = new Map<string, number | null>([
      ['p1', null],
      ['p2', ENEMY_TEAM],
    ]);
    const result = calculateSlowDeletions(refs, teams, PLAYER_TEAM, 0, 0);
    // p1: unknown → skip. p2: hostile, limit=0 → delete all.
    expect(result).toEqual([
      { guid: 'r2', type: ITEM_TYPE_REFERENCE, level: null, amount: 50, pointGuid: 'p2' },
    ]);
  });

  test('unknown team (undefined/missing) — ключ не трогается', () => {
    const refs: IRefByGuid[] = [{ itemGuid: 'r1', pointGuid: 'p1', amount: 10 }];
    const teams = new Map<string, number | null>(); // p1 отсутствует
    const result = calculateSlowDeletions(refs, teams, PLAYER_TEAM, 0, 0);
    expect(result).toEqual([]);
  });

  test('allied=-1 не удаляет allied, hostile удаляется', () => {
    const refs: IRefByGuid[] = [
      { itemGuid: 'a1', pointGuid: 'pa', amount: 50 },
      { itemGuid: 'h1', pointGuid: 'ph', amount: 10 },
    ];
    const teams = new Map<string, number | null>([
      ['pa', PLAYER_TEAM],
      ['ph', ENEMY_TEAM],
    ]);
    const result = calculateSlowDeletions(refs, teams, PLAYER_TEAM, -1, 3);
    // allied: -1 → skip. hostile: 10-3=7.
    expect(result).toEqual([
      { guid: 'h1', type: ITEM_TYPE_REFERENCE, level: null, amount: 7, pointGuid: 'ph' },
    ]);
  });

  test('оба лимита -1 — ничего не удаляется', () => {
    const refs: IRefByGuid[] = [
      { itemGuid: 'a1', pointGuid: 'pa', amount: 100 },
      { itemGuid: 'h1', pointGuid: 'ph', amount: 100 },
    ];
    const teams = new Map<string, number | null>([
      ['pa', PLAYER_TEAM],
      ['ph', ENEMY_TEAM],
    ]);
    const result = calculateSlowDeletions(refs, teams, PLAYER_TEAM, -1, -1);
    expect(result).toEqual([]);
  });

  test('оба лимита 0 — удаляются все с известной фракцией', () => {
    const refs: IRefByGuid[] = [
      { itemGuid: 'a1', pointGuid: 'pa', amount: 5 },
      { itemGuid: 'h1', pointGuid: 'ph', amount: 3 },
      { itemGuid: 'u1', pointGuid: 'pu', amount: 7 }, // unknown
    ];
    const teams = new Map<string, number | null>([
      ['pa', PLAYER_TEAM],
      ['ph', ENEMY_TEAM],
      ['pu', null],
    ]);
    const result = calculateSlowDeletions(refs, teams, PLAYER_TEAM, 0, 0);
    expect(result).toEqual([
      { guid: 'a1', type: ITEM_TYPE_REFERENCE, level: null, amount: 5, pointGuid: 'pa' },
      { guid: 'h1', type: ITEM_TYPE_REFERENCE, level: null, amount: 3, pointGuid: 'ph' },
    ]);
  });

  test('несколько точек одной фракции — per-point лимит', () => {
    const refs: IRefByGuid[] = [
      { itemGuid: 'h1', pointGuid: 'ph1', amount: 10 },
      { itemGuid: 'h2', pointGuid: 'ph2', amount: 2 },
    ];
    const teams = new Map<string, number | null>([
      ['ph1', ENEMY_TEAM],
      ['ph2', ENEMY_TEAM],
    ]);
    const result = calculateSlowDeletions(refs, teams, PLAYER_TEAM, -1, 5);
    // ph1: 10-5=5. ph2: 2<=5, ок.
    expect(result).toEqual([
      { guid: 'h1', type: ITEM_TYPE_REFERENCE, level: null, amount: 5, pointGuid: 'ph1' },
    ]);
  });

  test('пустой список refs — пустой результат', () => {
    const teams = new Map<string, number | null>();
    const result = calculateSlowDeletions([], teams, PLAYER_TEAM, 0, 0);
    expect(result).toEqual([]);
  });
});

// --- Регрессия: empty favorites + fast mode (P0-4) ---

describe('регрессия: calculateDeletions с empty favorites и snapshotReady', () => {
  // Этот тест живёт здесь рядом с slowRefsDelete, но тестирует calculateDeletions —
  // регрессия на баг, когда favoritedGuids.size > 0 блокировал fast-mode при 0 избранных.

  function unlimitedLimits() {
    const levelLimits: Record<number, number> = {};
    for (let level = 1; level <= 10; level++) {
      levelLimits[level] = -1;
    }
    return {
      cores: { ...levelLimits },
      catalysers: { ...levelLimits },
      referencesMode: 'fast' as const,
      referencesFastLimit: 2,
      referencesAlliedLimit: -1,
      referencesHostileLimit: -1,
    };
  }

  test('referencesEnabled=true + empty favoritedGuids + snapshotReady=true: ключи удаляются', () => {
    const items = [
      { g: 'r1', t: 3 as const, l: 'p1', a: 5 },
      { g: 'r2', t: 3 as const, l: 'p2', a: 1 },
    ];
    const result = calculateDeletions(items, unlimitedLimits(), {
      favoritedGuids: new Set<string>(),
      referencesEnabled: true,
      favoritesSnapshotReady: true,
    });
    // p1: 5-2=3 к удалению. p2: 1<=2, ок.
    expect(result).toEqual([
      { guid: 'r1', type: ITEM_TYPE_REFERENCE, level: null, amount: 3, pointGuid: 'p1' },
    ]);
  });

  test('referencesEnabled=true + empty favoritedGuids + snapshotReady=false: ключи НЕ удаляются', () => {
    const items = [{ g: 'r1', t: 3 as const, l: 'p1', a: 100 }];
    const result = calculateDeletions(items, unlimitedLimits(), {
      favoritedGuids: new Set<string>(),
      referencesEnabled: true,
      favoritesSnapshotReady: false,
    });
    expect(result).toEqual([]);
  });
});
