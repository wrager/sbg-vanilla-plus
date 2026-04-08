import { ITEM_TYPE_REFERENCE } from '../../core/gameConstants';
import type { IRefByGuid } from './slowRefsDelete';
import {
  calculateSlowDeletions,
  collectOverLimit,
  fetchPointTeam,
  fetchTeamsForGuids,
  FETCH_CONCURRENCY,
} from './slowRefsDelete';
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

  test('allied и notAllied лимиты применяются к разным фракциям', () => {
    const refs: IRefByGuid[] = [
      { itemGuid: 'a1', pointGuid: 'pa', amount: 10 }, // allied
      { itemGuid: 'h1', pointGuid: 'ph', amount: 8 }, // not allied
    ];
    const teams = new Map<string, number | null>([
      ['pa', PLAYER_TEAM],
      ['ph', ENEMY_TEAM],
    ]);
    const result = calculateSlowDeletions(refs, teams, PLAYER_TEAM, 3, 2);
    // allied pa: 10-3=7. notAllied ph: 8-2=6.
    expect(result).toEqual([
      { guid: 'a1', type: ITEM_TYPE_REFERENCE, level: null, amount: 7, pointGuid: 'pa' },
      { guid: 'h1', type: ITEM_TYPE_REFERENCE, level: null, amount: 6, pointGuid: 'ph' },
    ]);
  });

  test('unknown team (null) — считается несоюзным, применяется notAlliedLimit', () => {
    const refs: IRefByGuid[] = [
      { itemGuid: 'r1', pointGuid: 'p1', amount: 100 }, // team=null (нейтральная)
      { itemGuid: 'r2', pointGuid: 'p2', amount: 50 }, // team=ENEMY
    ];
    const teams = new Map<string, number | null>([
      ['p1', null],
      ['p2', ENEMY_TEAM],
    ]);
    const result = calculateSlowDeletions(refs, teams, PLAYER_TEAM, 0, 0);
    // p1: null → notAllied, limit=0 → delete all. p2: enemy → notAllied, limit=0 → delete all.
    expect(result).toEqual([
      { guid: 'r1', type: ITEM_TYPE_REFERENCE, level: null, amount: 100, pointGuid: 'p1' },
      { guid: 'r2', type: ITEM_TYPE_REFERENCE, level: null, amount: 50, pointGuid: 'p2' },
    ]);
  });

  test('unknown team (undefined/missing) — считается несоюзным', () => {
    const refs: IRefByGuid[] = [{ itemGuid: 'r1', pointGuid: 'p1', amount: 10 }];
    const teams = new Map<string, number | null>(); // p1 отсутствует в teams
    const result = calculateSlowDeletions(refs, teams, PLAYER_TEAM, -1, 0);
    // p1: undefined → notAllied, limit=0 → delete all.
    expect(result).toEqual([
      { guid: 'r1', type: ITEM_TYPE_REFERENCE, level: null, amount: 10, pointGuid: 'p1' },
    ]);
  });

  test('unknown team (null) + notAlliedLimit=-1 — не удаляется', () => {
    const refs: IRefByGuid[] = [{ itemGuid: 'r1', pointGuid: 'p1', amount: 10 }];
    const teams = new Map<string, number | null>([['p1', null]]);
    const result = calculateSlowDeletions(refs, teams, PLAYER_TEAM, 0, -1);
    // p1: null → notAllied, limit=-1 → skip.
    expect(result).toEqual([]);
  });

  test('allied=-1 не удаляет allied, notAllied удаляется', () => {
    const refs: IRefByGuid[] = [
      { itemGuid: 'a1', pointGuid: 'pa', amount: 50 },
      { itemGuid: 'h1', pointGuid: 'ph', amount: 10 },
    ];
    const teams = new Map<string, number | null>([
      ['pa', PLAYER_TEAM],
      ['ph', ENEMY_TEAM],
    ]);
    const result = calculateSlowDeletions(refs, teams, PLAYER_TEAM, -1, 3);
    // allied: -1 → skip. notAllied: 10-3=7.
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

  test('оба лимита 0 — удаляются все, включая нейтральные', () => {
    const refs: IRefByGuid[] = [
      { itemGuid: 'a1', pointGuid: 'pa', amount: 5 },
      { itemGuid: 'h1', pointGuid: 'ph', amount: 3 },
      { itemGuid: 'u1', pointGuid: 'pu', amount: 7 }, // нейтральная (null)
    ];
    const teams = new Map<string, number | null>([
      ['pa', PLAYER_TEAM],
      ['ph', ENEMY_TEAM],
      ['pu', null],
    ]);
    const result = calculateSlowDeletions(refs, teams, PLAYER_TEAM, 0, 0);
    // Все удаляются: allied limit=0, notAllied limit=0. Нейтральная pu → notAllied.
    expect(result).toEqual([
      { guid: 'a1', type: ITEM_TYPE_REFERENCE, level: null, amount: 5, pointGuid: 'pa' },
      { guid: 'h1', type: ITEM_TYPE_REFERENCE, level: null, amount: 3, pointGuid: 'ph' },
      { guid: 'u1', type: ITEM_TYPE_REFERENCE, level: null, amount: 7, pointGuid: 'pu' },
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
      referencesNotAlliedLimit: -1,
    };
  }

  test('referencesEnabled=true + empty favoritedGuids + snapshotReady=true: ключи НЕ удаляются (защита от потери IDB)', () => {
    const items = [
      { g: 'r1', t: 3 as const, l: 'p1', a: 5 },
      { g: 'r2', t: 3 as const, l: 'p2', a: 1 },
    ];
    const result = calculateDeletions(items, unlimitedLimits(), {
      favoritedGuids: new Set<string>(),
      referencesEnabled: true,
      favoritesSnapshotReady: true,
    });
    expect(result).toEqual([]);
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

// --- fetchPointTeam ---

// jsdom не имеет нативного fetch — создаём мок вручную.
let mockFetchFunction: jest.Mock;

beforeEach(() => {
  mockFetchFunction = jest.fn();
  globalThis.fetch = mockFetchFunction;
});

afterEach(() => {
  // Убираем мок: в jsdom fetch изначально не определён.
  globalThis.fetch = undefined as unknown as typeof fetch;
});

describe('fetchPointTeam', () => {
  test('успешный ответ — возвращает team number', async () => {
    mockFetchFunction.mockResolvedValue(
      new Response(JSON.stringify({ data: { g: 'p1', te: 2 } }), { status: 200 }),
    );
    const result = await fetchPointTeam('p1');
    expect(result).toBe(2);
  });

  test('ответ без data — возвращает null', async () => {
    mockFetchFunction.mockResolvedValue(
      new Response(JSON.stringify({ error: 'nope' }), { status: 200 }),
    );
    const result = await fetchPointTeam('p1');
    expect(result).toBeNull();
  });

  test('HTTP ошибка — возвращает null', async () => {
    mockFetchFunction.mockResolvedValue(new Response('', { status: 500 }));
    const result = await fetchPointTeam('p1');
    expect(result).toBeNull();
  });

  test('сетевая ошибка (fetch reject) — возвращает null', async () => {
    mockFetchFunction.mockRejectedValue(new Error('network'));
    const result = await fetchPointTeam('p1');
    expect(result).toBeNull();
  });

  test('data.te не number — возвращает null', async () => {
    mockFetchFunction.mockResolvedValue(
      new Response(JSON.stringify({ data: { g: 'p1', te: 'string' } }), { status: 200 }),
    );
    const result = await fetchPointTeam('p1');
    expect(result).toBeNull();
  });
});

// --- fetchTeamsForGuids ---

describe('fetchTeamsForGuids', () => {
  test('успешно получает team для всех GUID', async () => {
    mockFetchFunction.mockImplementation((url: string) => {
      const guid = new URL(url, 'http://localhost').searchParams.get('guid');
      const team = guid === 'p1' ? 1 : 2;
      return Promise.resolve(new Response(JSON.stringify({ data: { g: guid, te: team } })));
    });
    const progress = jest.fn();
    const result = await fetchTeamsForGuids(['p1', 'p2'], progress);
    expect(result.get('p1')).toBe(1);
    expect(result.get('p2')).toBe(2);
    expect(result.size).toBe(2);
  });

  test('progress callback вызывается для каждого GUID', async () => {
    mockFetchFunction.mockResolvedValue(new Response(JSON.stringify({ data: { te: 1 } })));
    const progress = jest.fn();
    await fetchTeamsForGuids(['a', 'b', 'c'], progress);
    expect(progress).toHaveBeenCalledTimes(3);
    expect(progress).toHaveBeenCalledWith(1, 3);
    expect(progress).toHaveBeenCalledWith(2, 3);
    expect(progress).toHaveBeenCalledWith(3, 3);
  });

  test('ошибка fetch для одного GUID — null для этого, остальные ок', async () => {
    mockFetchFunction.mockImplementation((url: string) => {
      const guid = new URL(url, 'http://localhost').searchParams.get('guid');
      if (guid === 'p2') return Promise.reject(new Error('network'));
      return Promise.resolve(new Response(JSON.stringify({ data: { g: guid, te: 1 } })));
    });
    const result = await fetchTeamsForGuids(['p1', 'p2', 'p3'], jest.fn());
    expect(result.get('p1')).toBe(1);
    expect(result.get('p2')).toBeNull();
    expect(result.get('p3')).toBe(1);
  });

  test('concurrency: не более FETCH_CONCURRENCY параллельных запросов', async () => {
    let concurrent = 0;
    let maxConcurrent = 0;
    mockFetchFunction.mockImplementation(() => {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      return new Promise<Response>((resolve) => {
        setTimeout(() => {
          concurrent--;
          resolve(new Response(JSON.stringify({ data: { te: 1 } })));
        }, 10);
      });
    });
    const guids = Array.from({ length: 10 }, (_, index) => `p${index}`);
    await fetchTeamsForGuids(guids, jest.fn());
    expect(maxConcurrent).toBeLessThanOrEqual(FETCH_CONCURRENCY);
    expect(maxConcurrent).toBe(FETCH_CONCURRENCY);
  });

  test('пустой массив — пустой результат', async () => {
    const result = await fetchTeamsForGuids([], jest.fn());
    expect(result.size).toBe(0);
    expect(mockFetchFunction).not.toHaveBeenCalled();
  });
});
