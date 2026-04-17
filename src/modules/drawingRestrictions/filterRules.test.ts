import {
  applyPredicates,
  buildPredicates,
  countHiddenByLastKey,
  type IDrawEntry,
} from './filterRules';
import type { IDrawingRestrictionsSettings } from './settings';

const FAVORITES = new Set(['fav1', 'fav2']);
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
    favorites?: ReadonlySet<string>;
    starCenterGuid?: string | null;
    currentPopupGuid?: string | null;
  } = {},
): string[] {
  const predicates = buildPredicates({
    settings: current,
    favorites: options.favorites ?? FAVORITES,
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

  test('favMode=protectLastKey — скрывает избранное с a=1', () => {
    expect(run(settings({ favProtectionMode: 'protectLastKey' }))).toEqual([
      'fav2',
      'n1',
      'n2',
      'p3',
      'noD',
    ]);
  });

  test('favMode=hideAllFavorites — скрывает все избранные', () => {
    expect(run(settings({ favProtectionMode: 'hideAllFavorites' }))).toEqual([
      'n1',
      'n2',
      'p3',
      'noD',
    ]);
  });

  test('favMode без избранных — ничего не фильтрует', () => {
    expect(
      run(settings({ favProtectionMode: 'hideAllFavorites' }), { favorites: new Set() }),
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

describe('countHiddenByLastKey', () => {
  test('считает только избранные с a=1 при mode=protectLastKey', () => {
    expect(countHiddenByLastKey(ENTRIES, FAVORITES, 'protectLastKey')).toBe(1);
  });

  test('mode=off — 0', () => {
    expect(countHiddenByLastKey(ENTRIES, FAVORITES, 'off')).toBe(0);
  });

  test('mode=hideAllFavorites — 0 (эта ветка не показывает toast)', () => {
    expect(countHiddenByLastKey(ENTRIES, FAVORITES, 'hideAllFavorites')).toBe(0);
  });

  test('пустой set избранных — 0', () => {
    expect(countHiddenByLastKey(ENTRIES, new Set(), 'protectLastKey')).toBe(0);
  });

  test('игнорирует записи без p или a', () => {
    const entries: IDrawEntry[] = [{ p: 'fav1', a: 1 }, { a: 1 }, { p: 'fav2' }];
    expect(countHiddenByLastKey(entries, FAVORITES, 'protectLastKey')).toBe(1);
  });
});
