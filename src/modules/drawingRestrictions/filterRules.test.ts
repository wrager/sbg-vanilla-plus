import {
  applyPredicates,
  buildPredicates,
  countHiddenByDistance,
  countHiddenByStar,
  type IDrawEntry,
} from './filterRules';
import type { IDrawingRestrictionsSettings } from './settings';

const STAR_CENTER = 'p3';

const ENTRIES: IDrawEntry[] = [
  { p: 'a1', a: 1, d: 300 },
  { p: 'a2', a: 3, d: 900 },
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
    maxDistanceMeters: 0,
    ...partial,
  };
}

function run(
  current: IDrawingRestrictionsSettings,
  options: {
    starCenterGuid?: string | null;
    currentPopupGuid?: string | null;
  } = {},
): string[] {
  const predicates = buildPredicates({
    settings: current,
    starCenterGuid: options.starCenterGuid ?? null,
    currentPopupGuid: options.currentPopupGuid ?? null,
  });
  return applyPredicates(ENTRIES, predicates)
    .map((entry) => entry.p)
    .filter((value): value is string => typeof value === 'string');
}

describe('buildPredicates', () => {
  test('без лимита и без звезды — все записи остаются', () => {
    expect(run(settings())).toEqual(['a1', 'a2', 'n1', 'n2', 'p3', 'noD']);
  });

  test('distance=500 — скрывает записи дальше порога, отсутствие d оставляет', () => {
    expect(run(settings({ maxDistanceMeters: 500 }))).toEqual(['a1', 'n1', 'p3', 'noD']);
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

  test('композиция звезды и дистанции, открыт попап другой точки — остаётся только центр', () => {
    expect(
      run(settings({ maxDistanceMeters: 500 }), {
        starCenterGuid: STAR_CENTER,
        currentPopupGuid: 'n1',
      }),
    ).toEqual(['p3']);
  });
});

describe('countHiddenByStar', () => {
  test('центр не назначен — 0', () => {
    expect(countHiddenByStar(ENTRIES, null, 'n1')).toBe(0);
  });

  test('открыт попап центра — 0 (фильтр отключён)', () => {
    expect(countHiddenByStar(ENTRIES, STAR_CENTER, STAR_CENTER)).toBe(0);
  });

  test('центр назначен, попап другой точки — считает всё кроме центра', () => {
    expect(countHiddenByStar(ENTRIES, STAR_CENTER, 'n1')).toBe(5);
  });

  test('центр назначен, попап null — считает всё кроме центра', () => {
    expect(countHiddenByStar(ENTRIES, STAR_CENTER, null)).toBe(5);
  });

  test('entry без поля p не считается скрытым', () => {
    const entries: IDrawEntry[] = [{ a: 1 }, { p: 'p3', a: 5 }, { p: 'other', a: 2 }];
    expect(countHiddenByStar(entries, STAR_CENTER, 'n1')).toBe(1);
  });

  test('все точки равны центру — 0', () => {
    const entries: IDrawEntry[] = [{ p: STAR_CENTER, a: 1 }];
    expect(countHiddenByStar(entries, STAR_CENTER, 'n1')).toBe(0);
  });
});

describe('countHiddenByDistance', () => {
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

  test('entry без поля d не считается скрытым', () => {
    const entries: IDrawEntry[] = [{ p: 'a', d: 600 }, { p: 'b' }];
    expect(countHiddenByDistance(entries, 500)).toBe(1);
  });

  test('max = 500 — считает записи с d > 500', () => {
    // ENTRIES: d=300, 900, 300, 900, 500 (центр), noD. Скрыто: 2 (a2=900, n2=900).
    expect(countHiddenByDistance(ENTRIES, 500)).toBe(2);
  });

  test('запись с d равным порогу не считается скрытой (строгое >)', () => {
    const entries: IDrawEntry[] = [{ p: 'a', d: 500 }];
    expect(countHiddenByDistance(entries, 500)).toBe(0);
  });
});
