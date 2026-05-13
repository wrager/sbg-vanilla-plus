import type { IOlFeature } from '../../core/olMap';
import type { IClassificationContext } from './classifyFeatures';
import { classifyFeatures } from './classifyFeatures';

function mockFeature(
  id: string,
  properties: {
    pointGuid?: string | null;
    amount?: number;
    team?: number | null;
    isSelected?: boolean;
  },
): IOlFeature {
  const props = { ...properties };
  return {
    getId: () => id,
    getProperties: () => props,
    set: (key: string, value: unknown) => {
      (props as Record<string, unknown>)[key] = value;
    },
  } as unknown as IOlFeature;
}

function ctx(overrides: Partial<IClassificationContext> = {}): IClassificationContext {
  return {
    mode: 'delete',
    playerTeam: 2,
    lockedPointGuids: new Set<string>(),
    favoritedPointGuids: new Set<string>(),
    inventoryTotals: new Map<string, number>(),
    ...overrides,
  };
}

describe('classifyFeatures: невыделенные', () => {
  test('невыделенная фича -> nothingToDelete, toSurvive=amount', () => {
    const f = mockFeature('r1', { pointGuid: 'p1', amount: 5, isSelected: false });
    const result = classifyFeatures([f], ctx());
    expect(result.get(f)).toEqual({
      isLocked: false,
      isFavorited: false,
      deletion: 'nothingToDelete',
      toDelete: 0,
      toSurvive: 5,
    });
  });

  test('isLocked/isFavorited читаются из контекста даже для невыделенной', () => {
    const f = mockFeature('r1', { pointGuid: 'p1', amount: 3, isSelected: false });
    const result = classifyFeatures(
      [f],
      ctx({
        lockedPointGuids: new Set(['p1']),
        favoritedPointGuids: new Set(['p1']),
      }),
    );
    expect(result.get(f)).toMatchObject({
      isLocked: true,
      isFavorited: true,
      deletion: 'nothingToDelete',
      toSurvive: 3,
    });
  });
});

describe('classifyFeatures: locked', () => {
  test('выделенная locked -> lockedProtected (любой mode)', () => {
    const f = mockFeature('r1', {
      pointGuid: 'p1',
      amount: 5,
      team: 2,
      isSelected: true,
    });
    for (const mode of ['delete', 'keep', 'keepOne'] as const) {
      const result = classifyFeatures([f], ctx({ mode, lockedPointGuids: new Set(['p1']) }));
      expect(result.get(f)?.deletion).toBe('lockedProtected');
      expect(result.get(f)?.toDelete).toBe(0);
      expect(result.get(f)?.toSurvive).toBe(5);
    }
  });

  test('locked + favorited - оба флага true, deletion=lockedProtected', () => {
    const f = mockFeature('r1', { pointGuid: 'p1', amount: 5, team: 1, isSelected: true });
    const result = classifyFeatures(
      [f],
      ctx({
        mode: 'delete',
        lockedPointGuids: new Set(['p1']),
        favoritedPointGuids: new Set(['p1']),
      }),
    );
    expect(result.get(f)).toMatchObject({
      isLocked: true,
      isFavorited: true,
      deletion: 'lockedProtected',
    });
  });
});

describe('classifyFeatures: mode=delete', () => {
  test('чужая -> fullyDeletable', () => {
    const f = mockFeature('r1', { pointGuid: 'p1', amount: 5, team: 1, isSelected: true });
    const result = classifyFeatures([f], ctx({ mode: 'delete' }));
    expect(result.get(f)).toMatchObject({
      deletion: 'fullyDeletable',
      toDelete: 5,
      toSurvive: 0,
    });
  });

  test('своя -> fullyDeletable (mode=delete)', () => {
    const f = mockFeature('r1', { pointGuid: 'p1', amount: 5, team: 2, isSelected: true });
    const result = classifyFeatures([f], ctx({ mode: 'delete' }));
    expect(result.get(f)).toMatchObject({
      deletion: 'fullyDeletable',
      toDelete: 5,
    });
  });

  test('team=undefined -> fullyDeletable (mode=delete, нет fail-safe)', () => {
    const f = mockFeature('r1', { pointGuid: 'p1', amount: 5, isSelected: true });
    const result = classifyFeatures([f], ctx({ mode: 'delete' }));
    expect(result.get(f)?.deletion).toBe('fullyDeletable');
  });

  test('team=null (нейтральная) -> fullyDeletable', () => {
    const f = mockFeature('r1', { pointGuid: 'p1', amount: 5, team: null, isSelected: true });
    const result = classifyFeatures([f], ctx({ mode: 'delete' }));
    expect(result.get(f)?.deletion).toBe('fullyDeletable');
  });
});

describe('classifyFeatures: mode=keep', () => {
  test('своя -> ownProtected', () => {
    const f = mockFeature('r1', { pointGuid: 'p1', amount: 5, team: 2, isSelected: true });
    const result = classifyFeatures([f], ctx({ mode: 'keep' }));
    expect(result.get(f)).toMatchObject({
      deletion: 'ownProtected',
      toDelete: 0,
      toSurvive: 5,
    });
  });

  test('чужая -> fullyDeletable', () => {
    const f = mockFeature('r1', { pointGuid: 'p1', amount: 5, team: 1, isSelected: true });
    const result = classifyFeatures([f], ctx({ mode: 'keep' }));
    expect(result.get(f)?.deletion).toBe('fullyDeletable');
  });

  test('team=undefined -> unknownProtected (fail-safe)', () => {
    const f = mockFeature('r1', { pointGuid: 'p1', amount: 5, isSelected: true });
    const result = classifyFeatures([f], ctx({ mode: 'keep' }));
    expect(result.get(f)?.deletion).toBe('unknownProtected');
  });

  test('team=null (нейтральная) -> fullyDeletable (не считается своей)', () => {
    const f = mockFeature('r1', { pointGuid: 'p1', amount: 5, team: null, isSelected: true });
    const result = classifyFeatures([f], ctx({ mode: 'keep' }));
    expect(result.get(f)?.deletion).toBe('fullyDeletable');
  });

  test('playerTeam=null - своя не определяется, чужие удаляются (но team=undefined -> unknownProtected)', () => {
    const own = mockFeature('r1', { pointGuid: 'p1', amount: 5, team: 2, isSelected: true });
    const unknown = mockFeature('r2', { pointGuid: 'p2', amount: 5, isSelected: true });
    const result = classifyFeatures([own, unknown], ctx({ mode: 'keep', playerTeam: null }));
    expect(result.get(own)?.deletion).toBe('fullyDeletable');
    expect(result.get(unknown)?.deletion).toBe('unknownProtected');
  });
});

describe('classifyFeatures: mode=keepOne', () => {
  test('чужая с 5 ключами -> fullyDeletable полностью', () => {
    const f = mockFeature('r1', { pointGuid: 'p1', amount: 5, team: 1, isSelected: true });
    const result = classifyFeatures(
      [f],
      ctx({ mode: 'keepOne', inventoryTotals: new Map([['p1', 5]]) }),
    );
    expect(result.get(f)).toMatchObject({
      deletion: 'fullyDeletable',
      toDelete: 5,
    });
  });

  test('своя с 5 ключами, все выделены -> keepOneTrimmed (toDelete=4, toSurvive=1)', () => {
    const f = mockFeature('r1', { pointGuid: 'p1', amount: 5, team: 2, isSelected: true });
    const result = classifyFeatures(
      [f],
      ctx({ mode: 'keepOne', inventoryTotals: new Map([['p1', 5]]) }),
    );
    expect(result.get(f)).toMatchObject({
      deletion: 'keepOneTrimmed',
      toDelete: 4,
      toSurvive: 1,
    });
  });

  test('своя с 1 ключом -> keepOneTrimmed (toDelete=0, toSurvive=1, нечего удалять)', () => {
    const f = mockFeature('r1', { pointGuid: 'p1', amount: 1, team: 2, isSelected: true });
    const result = classifyFeatures(
      [f],
      ctx({ mode: 'keepOne', inventoryTotals: new Map([['p1', 1]]) }),
    );
    expect(result.get(f)).toMatchObject({
      deletion: 'keepOneTrimmed',
      toDelete: 0,
      toSurvive: 1,
    });
  });

  test('своя с 5 ключами + невыделенная стопка той же точки 3 -> fullyDeletable (защита уже есть)', () => {
    const selected = mockFeature('r1', { pointGuid: 'p1', amount: 5, team: 2, isSelected: true });
    const result = classifyFeatures(
      [selected],
      ctx({ mode: 'keepOne', inventoryTotals: new Map([['p1', 8]]) }),
    );
    expect(result.get(selected)).toMatchObject({
      deletion: 'fullyDeletable',
      toDelete: 5,
    });
  });

  test('своя 2 стопки 3+2 (всего 5), distribute: r1=3 fully, r2=keepOneTrimmed 1/1', () => {
    const r1 = mockFeature('r1', { pointGuid: 'p1', amount: 3, team: 2, isSelected: true });
    const r2 = mockFeature('r2', { pointGuid: 'p1', amount: 2, team: 2, isSelected: true });
    const result = classifyFeatures(
      [r1, r2],
      ctx({ mode: 'keepOne', inventoryTotals: new Map([['p1', 5]]) }),
    );
    expect(result.get(r1)).toMatchObject({
      deletion: 'fullyDeletable',
      toDelete: 3,
      toSurvive: 0,
    });
    expect(result.get(r2)).toMatchObject({
      deletion: 'keepOneTrimmed',
      toDelete: 1,
      toSurvive: 1,
    });
  });

  test('mode=keepOne, своя 1 ключ - не должна попасть в payload (toDelete=0)', () => {
    const f = mockFeature('r1', { pointGuid: 'p1', amount: 1, team: 2, isSelected: true });
    const result = classifyFeatures(
      [f],
      ctx({ mode: 'keepOne', inventoryTotals: new Map([['p1', 1]]) }),
    );
    expect(result.get(f)?.toDelete).toBe(0);
  });
});

describe('classifyFeatures: edge cases', () => {
  test('amount=0 для выделенной -> nothingToDelete', () => {
    const f = mockFeature('r1', { pointGuid: 'p1', amount: 0, team: 1, isSelected: true });
    const result = classifyFeatures([f], ctx({ mode: 'delete' }));
    expect(result.get(f)).toMatchObject({
      deletion: 'nothingToDelete',
      toDelete: 0,
      toSurvive: 0,
    });
  });

  test('выделенная без pointGuid -> nothingToDelete (safe default)', () => {
    const f = mockFeature('r1', { amount: 5, team: 1, isSelected: true });
    const result = classifyFeatures([f], ctx({ mode: 'delete' }));
    expect(result.get(f)?.deletion).toBe('nothingToDelete');
  });

  test('пустой массив -> пустая Map', () => {
    expect(classifyFeatures([], ctx())).toEqual(new Map());
  });
});
