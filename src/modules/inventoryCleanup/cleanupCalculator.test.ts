import { ITEM_TYPE_CORE, ITEM_TYPE_CATALYSER, ITEM_TYPE_REFERENCE } from '../../core/gameConstants';
import type { IInventoryItem } from '../../core/inventoryTypes';
import {
  buildLockedPointGuids,
  buildProtectedPointGuids,
  isProtectionFlagSupportAvailable,
} from '../../core/inventoryCache';
import { calculateDeletions } from './cleanupCalculator';
import type { ICleanupLimits } from './cleanupSettings';

const FAST_LIMIT_2: ICleanupLimits = {
  cores: {},
  catalysers: {},
  referencesMode: 'fast',
  referencesFastLimit: 2,
  referencesAlliedLimit: -1,
  referencesNotAlliedLimit: -1,
};

function ref(g: string, point: string, amount: number, f?: number): IInventoryItem {
  // 0.6.1: поле f присутствует у рефов, может отсутствовать на 0.6.0.
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
  // Сокращённый набор: функция используется только в favoritesMigration для
  // определения, какие точки УЖЕ помечены lock-битом (миграция legacy
  // SVP/CUI-избранных). Семантика «защита от удаления» теперь живёт в
  // buildProtectedPointGuids (lock OR favorite). Здесь покрываем только
  // ключевые инварианты функции lock-only.

  test('lock-флаг (бит 1) добавляет точку', () => {
    const items = [ref('s1', 'p1', 5, 0b10)];
    expect([...buildLockedPointGuids(items)]).toEqual(['p1']);
  });

  test('favorite-флаг (бит 0) сам по себе НЕ добавляет точку (lock-only семантика)', () => {
    const items = [ref('s1', 'p1', 5, 0b01)];
    expect(buildLockedPointGuids(items).size).toBe(0);
  });

  test('per-point агрегация: одна стопка locked ⇒ вся точка locked', () => {
    const items = [ref('stack-a', 'p1', 3, 0b10), ref('stack-b', 'p1', 2, 0)];
    expect([...buildLockedPointGuids(items)]).toEqual(['p1']);
  });

  test('игнорирует записи без поля f (0.6.0 совместимость)', () => {
    const items = [ref('s1', 'p1', 5)];
    expect(buildLockedPointGuids(items).size).toBe(0);
  });
});

describe('buildProtectedPointGuids', () => {
  // Семантика «защита от удаления»: lock (бит 1) ИЛИ favorite (бит 0).
  // Используется во всех местах массового удаления: cleanupCalculator (fast),
  // slowRefsDelete (slow), inventoryApi (final guard), refsOnMap (viewer).

  test('пустой инвентарь: пустой Set', () => {
    expect(buildProtectedPointGuids([]).size).toBe(0);
  });

  test('игнорирует записи без поля f (0.6.0 совместимость)', () => {
    const items = [ref('s1', 'p1', 5)];
    expect(buildProtectedPointGuids(items).size).toBe(0);
  });

  test('lock-флаг (бит 1) защищает', () => {
    const items = [ref('s1', 'p1', 5, 0b10)];
    expect([...buildProtectedPointGuids(items)]).toEqual(['p1']);
  });

  test('favorite-флаг (бит 0) защищает', () => {
    const items = [ref('s1', 'p1', 5, 0b01)];
    expect([...buildProtectedPointGuids(items)]).toEqual(['p1']);
  });

  test('lock + favorite (биты 0 и 1) — точка защищена', () => {
    const items = [ref('s1', 'p1', 5, 0b11)];
    expect([...buildProtectedPointGuids(items)]).toEqual(['p1']);
  });

  test('per-point агрегация: одна locked-стопка ⇒ вся точка защищена', () => {
    const items = [ref('stack-a', 'p1', 3, 0b10), ref('stack-b', 'p1', 2, 0)];
    expect([...buildProtectedPointGuids(items)]).toEqual(['p1']);
  });

  test('per-point агрегация: одна favorite-стопка ⇒ вся точка защищена', () => {
    const items = [ref('stack-a', 'p1', 3, 0b01), ref('stack-b', 'p1', 2, 0)];
    expect([...buildProtectedPointGuids(items)]).toEqual(['p1']);
  });

  test('per-point агрегация: смешанные стопки (одна favorite, одна lock) — точка защищена один раз', () => {
    const items = [ref('stack-a', 'p1', 3, 0b01), ref('stack-b', 'p1', 2, 0b10)];
    expect([...buildProtectedPointGuids(items)]).toEqual(['p1']);
  });

  test('разные точки защищаются независимо', () => {
    const items = [
      ref('s1', 'p-lock', 3, 0b10),
      ref('s2', 'p-fav', 2, 0b01),
      ref('s3', 'p-open', 4, 0),
    ];
    expect(buildProtectedPointGuids(items)).toEqual(new Set(['p-lock', 'p-fav']));
  });

  test('f=0 не защищает', () => {
    const items = [ref('s1', 'p1', 5, 0)];
    expect(buildProtectedPointGuids(items).size).toBe(0);
  });

  test('игнорирует не-рефы (cores/cats), даже если у них есть похожее поле', () => {
    const core = { g: 'c1', t: ITEM_TYPE_CORE, l: 5, a: 10, f: 0b11 };
    expect(buildProtectedPointGuids([core]).size).toBe(0);
  });
});

describe('isProtectionFlagSupportAvailable', () => {
  test('пустой набор рефов: false (нет evidence)', () => {
    expect(isProtectionFlagSupportAvailable([])).toBe(false);
  });

  test('все стопки без поля f (0.6.0): false', () => {
    const items = [ref('s1', 'p1', 5), ref('s2', 'p2', 3)];
    expect(isProtectionFlagSupportAvailable(items)).toBe(false);
  });

  test('все стопки с полем f (0.6.1+): true', () => {
    const items = [ref('s1', 'p1', 5, 0), ref('s2', 'p2', 3, 0b10)];
    expect(isProtectionFlagSupportAvailable(items)).toBe(true);
  });

  test('mix-кэш (часть с f, часть без): false - блокировка целиком', () => {
    const items = [ref('s1', 'p1', 5, 0), ref('s2', 'p2', 3)];
    expect(isProtectionFlagSupportAvailable(items)).toBe(false);
  });

  test('игнорирует не-рефы при подсчёте: набор без реф-стопок -> false', () => {
    const core = { g: 'c1', t: ITEM_TYPE_CORE, l: 1, a: 10, f: 0b11 };
    expect(isProtectionFlagSupportAvailable([core])).toBe(false);
  });
});

describe('calculateDeletions — lock/favorite-aware фильтрация рефов', () => {
  test('locked-точка с одной стопкой (бит 1) не попадает в deletions', () => {
    // 5 ключей одной точки, лимит 2, locked. Без protect-фильтра было бы 3 на удаление.
    const items: IInventoryItem[] = [ref('s1', 'p1', 5, 0b10)];
    const deletions = calculateDeletions(items, FAST_LIMIT_2);
    expect(deletions).toHaveLength(0);
  });

  test('locked-точка с 2 стопками (одна с lock, другая без) — обе защищены (per-point)', () => {
    // Стопки в реальности — деталь хранения. UI агрегирует, защита per-point.
    const items: IInventoryItem[] = [ref('stack-a', 'p1', 3, 0b10), ref('stack-b', 'p1', 2, 0)];
    const deletions = calculateDeletions(items, FAST_LIMIT_2);
    expect(deletions).toHaveLength(0);
  });

  test('не-защищённая точка с превышением лимита — удаляется, защищённая точка рядом не страдает', () => {
    const items: IInventoryItem[] = [
      ref('locked-stack', 'locked-point', 5, 0b10),
      ref('normal-stack', 'normal-point', 5, 0),
    ];
    const deletions = calculateDeletions(items, FAST_LIMIT_2);
    expect(deletions).toHaveLength(1);
    expect(deletions[0].pointGuid).toBe('normal-point');
    expect(deletions[0].amount).toBe(3);
  });

  test('favorite-флаг (бит 0) защищает: точка не попадает в deletions', () => {
    // Постановка обновлена: и lock, и favorite защищают от удаления.
    const items: IInventoryItem[] = [ref('s1', 'p1', 5, 0b01)];
    const deletions = calculateDeletions(items, FAST_LIMIT_2);
    expect(deletions).toHaveLength(0);
  });

  test('favorite-точка с 2 стопками (одна с favorite, другая без) — обе защищены (per-point)', () => {
    const items: IInventoryItem[] = [ref('stack-a', 'p1', 3, 0b01), ref('stack-b', 'p1', 2, 0)];
    const deletions = calculateDeletions(items, FAST_LIMIT_2);
    expect(deletions).toHaveLength(0);
  });

  test('lock + favorite (бит 0 и 1) — точка защищена', () => {
    const items: IInventoryItem[] = [ref('s1', 'p1', 5, 0b11)];
    const deletions = calculateDeletions(items, FAST_LIMIT_2);
    expect(deletions).toHaveLength(0);
  });

  test('mix трёх точек: locked, favorite, open — удаляется только open', () => {
    const items: IInventoryItem[] = [
      ref('s-lock', 'p-locked', 5, 0b10),
      ref('s-fav', 'p-fav', 5, 0b01),
      ref('s-open', 'p-open', 5, 0),
    ];
    const deletions = calculateDeletions(items, FAST_LIMIT_2);
    expect(deletions).toHaveLength(1);
    expect(deletions[0].pointGuid).toBe('p-open');
    expect(deletions[0].amount).toBe(3);
  });

  test('protect-фильтр работает БЕЗ legacy SVP-избранных (0.6.1+ кейс)', () => {
    // Legacy список в логике защиты не участвует — полагаемся только на lock/favorite.
    const items: IInventoryItem[] = [
      ref('locked-stack', 'p-locked', 5, 0b10),
      ref('normal-stack', 'p-normal', 5, 0),
    ];
    const deletions = calculateDeletions(items, FAST_LIMIT_2);
    expect(deletions.map((d) => d.pointGuid)).toEqual(['p-normal']);
  });

  test('cores/catalysers продолжают работать независимо от protect-фильтра (только для рефов)', () => {
    const items: IInventoryItem[] = [
      { g: 'c1', t: ITEM_TYPE_CORE, l: 1, a: 10 },
      { g: 'cat1', t: ITEM_TYPE_CATALYSER, l: 1, a: 10 },
    ];
    const limits: ICleanupLimits = {
      cores: { 1: 5 },
      catalysers: { 1: 5 },
      referencesMode: 'off',
      referencesFastLimit: -1,
      referencesAlliedLimit: -1,
      referencesNotAlliedLimit: -1,
    };
    const deletions = calculateDeletions(items, limits);
    expect(deletions).toHaveLength(2);
    expect(deletions.every((d) => d.amount === 5)).toBe(true);
  });
});

describe('calculateDeletions — условие запуска (lock/favorite-поддержка)', () => {
  test('кэш без поля f во всех стопках: ключи не трогаются (0.6.0 / защита недоступна)', () => {
    // Поле f отсутствует во всех записях — isProtectionFlagSupportAvailable=false.
    // Удаление ключей блокируется, чтобы не задеть защищённые точки вслепую.
    const items: IInventoryItem[] = [ref('s1', 'p1', 5)];
    const deletions = calculateDeletions(items, FAST_LIMIT_2);
    expect(deletions).toHaveLength(0);
  });

  test('хотя бы одна стопка с f=0: isProtectionFlagSupportAvailable=true → cleanup идёт', () => {
    const items: IInventoryItem[] = [ref('s-other', 'p-other', 5, 0)];
    const deletions = calculateDeletions(items, FAST_LIMIT_2);
    expect(deletions.map((d) => d.pointGuid)).toEqual(['p-other']);
    expect(deletions[0].amount).toBe(3);
  });

  test('кэш с f-полем: cleanup идёт, locked-точка защищена', () => {
    const items: IInventoryItem[] = [
      ref('s-locked', 'p-locked', 5, 0b10),
      ref('s-other', 'p-other', 5, 0),
    ];
    const deletions = calculateDeletions(items, FAST_LIMIT_2);
    expect(deletions.map((d) => d.pointGuid)).toEqual(['p-other']);
    expect(deletions[0].amount).toBe(3);
  });

  test('кэш с f-полем: cleanup идёт, favorite-точка защищена', () => {
    const items: IInventoryItem[] = [
      ref('s-fav', 'p-fav', 5, 0b01),
      ref('s-other', 'p-other', 5, 0),
    ];
    const deletions = calculateDeletions(items, FAST_LIMIT_2);
    expect(deletions.map((d) => d.pointGuid)).toEqual(['p-other']);
    expect(deletions[0].amount).toBe(3);
  });
});
