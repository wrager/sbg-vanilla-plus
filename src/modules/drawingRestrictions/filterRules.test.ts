import {
  applyPredicates,
  buildPredicates,
  countHiddenByDistance,
  countHiddenByLockMode,
  countHiddenByStar,
  type IDrawEntry,
} from './filterRules';
import type { IDrawingRestrictionsSettings } from './settings';

const LOCKED_POINTS = new Set(['fav1', 'fav2']);
const STAR_CENTER = 'p3';

const ENTRIES: IDrawEntry[] = [
  { p: 'fav1', a: 1, d: 300 },
  { p: 'fav2', a: 3, d: 900 },
  { p: 'n1', a: 2, d: 300 },
  { p: 'n2', a: 1, d: 900 },
  { p: 'p3', a: 4, d: 500 },
  { p: 'noD', a: 2 },
];

function settings(
  partial: Partial<IDrawingRestrictionsSettings> = {},
): IDrawingRestrictionsSettings {
  return {
    version: 1,
    favProtectionMode: 'off',
    maxDistanceMeters: 0,
    ...partial,
  };
}

function run(
  current: IDrawingRestrictionsSettings,
  options: {
    lockedPoints?: ReadonlySet<string>;
    starCenterGuid?: string | null;
    currentPopupGuid?: string | null;
  } = {},
): string[] {
  const predicates = buildPredicates({
    settings: current,
    lockedPoints: options.lockedPoints ?? LOCKED_POINTS,
    starCenterGuid: options.starCenterGuid ?? null,
    currentPopupGuid: options.currentPopupGuid ?? null,
  });
  return applyPredicates(ENTRIES, predicates)
    .map((entry) => entry.p)
    .filter((value): value is string => typeof value === 'string');
}

describe('buildPredicates', () => {
  test('all off без лимита — все записи остаются', () => {
    expect(run(settings())).toEqual(['fav1', 'fav2', 'n1', 'n2', 'p3', 'noD']);
  });

  test('favMode=protectLastKey — скрывает locked-точку с a=1', () => {
    expect(run(settings({ favProtectionMode: 'protectLastKey' }))).toEqual([
      'fav2',
      'n1',
      'n2',
      'p3',
      'noD',
    ]);
  });

  test('favMode=hideAllFavorites — скрывает все locked-точки', () => {
    expect(run(settings({ favProtectionMode: 'hideAllFavorites' }))).toEqual([
      'n1',
      'n2',
      'p3',
      'noD',
    ]);
  });

  test('favMode без locked-точек — ничего не фильтрует', () => {
    expect(
      run(settings({ favProtectionMode: 'hideAllFavorites' }), { lockedPoints: new Set() }),
    ).toHaveLength(ENTRIES.length);
  });

  test('distance=500 — скрывает записи дальше порога, отсутствие d оставляет', () => {
    expect(run(settings({ maxDistanceMeters: 500 }))).toEqual(['fav1', 'n1', 'p3', 'noD']);
  });

  test('distance=0 — не фильтрует', () => {
    expect(run(settings({ maxDistanceMeters: 0 }))).toHaveLength(ENTRIES.length);
  });

  test('distance отрицательное — трактуется как no-op', () => {
    expect(run(settings({ maxDistanceMeters: -100 }))).toHaveLength(ENTRIES.length);
  });

  test('звезда: открыт попап центра — все записи остаются', () => {
    expect(
      run(settings(), { starCenterGuid: STAR_CENTER, currentPopupGuid: STAR_CENTER }),
    ).toHaveLength(ENTRIES.length);
  });

  test('звезда: открыт попап другой точки — остаётся только центр', () => {
    expect(run(settings(), { starCenterGuid: STAR_CENTER, currentPopupGuid: 'n1' })).toEqual([
      'p3',
    ]);
  });

  test('звезда: центр отсутствует в data — пустой список', () => {
    expect(run(settings(), { starCenterGuid: 'unknown', currentPopupGuid: 'n1' })).toEqual([]);
  });

  test('звезда не назначена — не фильтрует по звезде', () => {
    expect(run(settings(), { starCenterGuid: null, currentPopupGuid: 'n1' })).toHaveLength(
      ENTRIES.length,
    );
  });

  test('звезда: закрытый попап (currentPopupGuid=null) — фильтр оставляет только центр', () => {
    expect(run(settings(), { starCenterGuid: STAR_CENTER, currentPopupGuid: null })).toEqual([
      'p3',
    ]);
  });

  test('композиция hideAllFavorites + distance=500', () => {
    expect(
      run(settings({ favProtectionMode: 'hideAllFavorites', maxDistanceMeters: 500 })),
    ).toEqual(['n1', 'p3', 'noD']);
  });

  test('композиция protectLastKey + distance=500', () => {
    expect(run(settings({ favProtectionMode: 'protectLastKey', maxDistanceMeters: 500 }))).toEqual([
      'n1',
      'p3',
      'noD',
    ]);
  });

  test('композиция всех трёх правил, открыт попап другой точки — остаётся только центр', () => {
    expect(
      run(settings({ favProtectionMode: 'hideAllFavorites', maxDistanceMeters: 500 }), {
        starCenterGuid: STAR_CENTER,
        currentPopupGuid: 'n1',
      }),
    ).toEqual(['p3']);
  });
});

describe('countHiddenByLockMode', () => {
  test('mode=protectLastKey: считает locked-точки с a=1', () => {
    expect(countHiddenByLockMode(ENTRIES, LOCKED_POINTS, 'protectLastKey')).toBe(1);
  });

  test('mode=hideAllFavorites: считает все locked-точки независимо от amount', () => {
    // ENTRIES содержит fav1 (a=1) и fav2 (a=3), обе locked - всего 2.
    expect(countHiddenByLockMode(ENTRIES, LOCKED_POINTS, 'hideAllFavorites')).toBe(2);
  });

  test('mode=off — 0', () => {
    expect(countHiddenByLockMode(ENTRIES, LOCKED_POINTS, 'off')).toBe(0);
  });

  test('пустой set locked-точек — 0 (любой mode)', () => {
    expect(countHiddenByLockMode(ENTRIES, new Set(), 'protectLastKey')).toBe(0);
    expect(countHiddenByLockMode(ENTRIES, new Set(), 'hideAllFavorites')).toBe(0);
  });

  test('protectLastKey: игнорирует записи без p или a', () => {
    const entries: IDrawEntry[] = [{ p: 'fav1', a: 1 }, { a: 1 }, { p: 'fav2' }];
    expect(countHiddenByLockMode(entries, LOCKED_POINTS, 'protectLastKey')).toBe(1);
  });

  test('hideAllFavorites: считает запись без a (любой amount подходит)', () => {
    const entries: IDrawEntry[] = [{ p: 'fav1', a: 5 }, { p: 'fav2' }, { p: 'other', a: 1 }];
    expect(countHiddenByLockMode(entries, LOCKED_POINTS, 'hideAllFavorites')).toBe(2);
  });

  test('hideAllFavorites: игнорирует записи без p', () => {
    const entries: IDrawEntry[] = [{ p: 'fav1', a: 5 }, { a: 1 }];
    expect(countHiddenByLockMode(entries, LOCKED_POINTS, 'hideAllFavorites')).toBe(1);
  });
});

describe('countHiddenByStar', () => {
  // Ранние выходы (5.B.1 / 5.B.2):
  test('центр не назначен — 0', () => {
    expect(countHiddenByStar(ENTRIES, null, 'n1')).toBe(0);
  });

  test('открыт попап центра — 0 (фильтр отключён)', () => {
    expect(countHiddenByStar(ENTRIES, STAR_CENTER, STAR_CENTER)).toBe(0);
  });

  // Основная ветка: центр назначен, попап НЕ центра.
  test('центр назначен, попап другой точки — считает всё кроме центра', () => {
    // ENTRIES имеет 6 записей, одна из них — центр (p3). Скрыто: 5.
    expect(countHiddenByStar(ENTRIES, STAR_CENTER, 'n1')).toBe(5);
  });

  test('центр назначен, попап null — считает всё кроме центра', () => {
    expect(countHiddenByStar(ENTRIES, STAR_CENTER, null)).toBe(5);
  });

  // 5.D: typeof entry.p !== 'string' — skip.
  test('entry без поля p не считается скрытым', () => {
    const entries: IDrawEntry[] = [{ a: 1 }, { p: 'p3', a: 5 }, { p: 'other', a: 2 }];
    // p3 = центр (не скрыт), other — скрыт. entry без p — пропущен.
    expect(countHiddenByStar(entries, STAR_CENTER, 'n1')).toBe(1);
  });

  // 5.C: FALSE-ветка «entry.p === center» — центр не считается скрытым.
  test('все точки равны центру — 0', () => {
    const entries: IDrawEntry[] = [{ p: STAR_CENTER, a: 1 }];
    expect(countHiddenByStar(entries, STAR_CENTER, 'n1')).toBe(0);
  });
});

describe('countHiddenByDistance', () => {
  // Ранние выходы (5.E.1 / 5.E.2):
  test('max = 0 — 0', () => {
    expect(countHiddenByDistance(ENTRIES, 0)).toBe(0);
  });

  test('max = -1 — 0', () => {
    expect(countHiddenByDistance(ENTRIES, -1)).toBe(0);
  });

  test('max = NaN — 0', () => {
    expect(countHiddenByDistance(ENTRIES, Number.NaN)).toBe(0);
  });

  test('max = Infinity — 0', () => {
    expect(countHiddenByDistance(ENTRIES, Number.POSITIVE_INFINITY)).toBe(0);
  });

  // 5.F: typeof entry.d !== 'number' — skip.
  test('entry без поля d не считается скрытым', () => {
    const entries: IDrawEntry[] = [{ p: 'a', d: 600 }, { p: 'b' }];
    // Только первая точка с d=600 > 500, вторая без d — пропущена.
    expect(countHiddenByDistance(entries, 500)).toBe(1);
  });

  // 5.G: entry.d > maxDistanceMeters.
  test('max = 500 — считает записи с d > 500', () => {
    // ENTRIES: d=300, 900, 300, 900, 500 (центр), noD. Скрыто: 2 (fav2=900, n2=900).
    // p3 имеет d=500 — не строго больше 500, не скрыт.
    expect(countHiddenByDistance(ENTRIES, 500)).toBe(2);
  });

  test('запись с d равным порогу не считается скрытой (строгое >)', () => {
    const entries: IDrawEntry[] = [{ p: 'a', d: 500 }];
    expect(countHiddenByDistance(entries, 500)).toBe(0);
  });
});
