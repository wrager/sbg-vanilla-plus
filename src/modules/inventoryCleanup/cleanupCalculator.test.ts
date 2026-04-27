import { ITEM_TYPE_CORE, ITEM_TYPE_CATALYSER, ITEM_TYPE_REFERENCE } from '../../core/gameConstants';
import type { IInventoryItem } from '../../core/inventoryTypes';
import { buildLockedPointGuids, calculateDeletions } from './cleanupCalculator';
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
  test('пустой инвентарь: пустой Set', () => {
    expect(buildLockedPointGuids([]).size).toBe(0);
  });

  test('игнорирует записи без поля f (0.6.0 совместимость)', () => {
    const items = [ref('s1', 'p1', 5)];
    expect(buildLockedPointGuids(items).size).toBe(0);
  });

  test('lock-флаг (бит 1) добавляет точку', () => {
    const items = [ref('s1', 'p1', 5, 0b10)];
    expect([...buildLockedPointGuids(items)]).toEqual(['p1']);
  });

  test('favorite-флаг (бит 0) сам по себе НЕ добавляет точку', () => {
    const items = [ref('s1', 'p1', 5, 0b01)];
    expect(buildLockedPointGuids(items).size).toBe(0);
  });

  test('комбинация lock+favorite (биты 0 и 1) — точка locked', () => {
    const items = [ref('s1', 'p1', 5, 0b11)];
    expect([...buildLockedPointGuids(items)]).toEqual(['p1']);
  });

  test('per-point агрегация: одна стопка locked ⇒ вся точка locked', () => {
    const items = [ref('stack-a', 'p1', 3, 0b10), ref('stack-b', 'p1', 2, 0)];
    expect([...buildLockedPointGuids(items)]).toEqual(['p1']);
  });

  test('игнорирует не-рефы (cores/cats), даже если у них есть похожее поле', () => {
    // У cores нет поля f в нашем типе, но если кто-то по ошибке передаст —
    // фильтр isInventoryReference отсеет.
    const core = { g: 'c1', t: ITEM_TYPE_CORE, l: 5, a: 10, f: 0b10 };
    expect(buildLockedPointGuids([core]).size).toBe(0);
  });
});

describe('calculateDeletions — lock-aware фильтрация рефов', () => {
  test('locked-точка с одной стопкой (бит 1) не попадает в deletions', () => {
    // 5 ключей одной точки, лимит 2, locked. Без lock-фильтра было бы 3 на удаление.
    const items: IInventoryItem[] = [ref('s1', 'p1', 5, 0b10)];
    const deletions = calculateDeletions(items, FAST_LIMIT_2);
    expect(deletions).toHaveLength(0);
  });

  test('locked-точка с 2 стопками (одна с lock, другая без) — обе защищены (per-point)', () => {
    // Стопки в реальности — деталь хранения. UI агрегирует, lock per-point.
    const items: IInventoryItem[] = [ref('stack-a', 'p1', 3, 0b10), ref('stack-b', 'p1', 2, 0)];
    const deletions = calculateDeletions(items, FAST_LIMIT_2);
    expect(deletions).toHaveLength(0);
  });

  test('не-locked точка с превышением лимита — удаляется, lock-точка рядом не страдает', () => {
    const items: IInventoryItem[] = [
      ref('locked-stack', 'locked-point', 5, 0b10),
      ref('normal-stack', 'normal-point', 5, 0),
    ];
    const deletions = calculateDeletions(items, FAST_LIMIT_2);
    expect(deletions).toHaveLength(1);
    expect(deletions[0].pointGuid).toBe('normal-point');
    expect(deletions[0].amount).toBe(3);
  });

  test('favorite-флаг (бит 0) НЕ защищает: точка идёт под лимит', () => {
    // По постановке: «избранные ключи не защищаются от удаления» (только lock).
    const items: IInventoryItem[] = [ref('s1', 'p1', 5, 0b01)];
    const deletions = calculateDeletions(items, FAST_LIMIT_2);
    expect(deletions).toHaveLength(1);
    expect(deletions[0].amount).toBe(3);
  });

  test('lock-фильтр работает БЕЗ legacy SVP-избранных (0.6.1+ кейс)', () => {
    // Legacy список в логике защиты не участвует — полагаемся только на lock.
    const items: IInventoryItem[] = [
      ref('locked-stack', 'p-locked', 5, 0b10),
      ref('normal-stack', 'p-normal', 5, 0),
    ];
    const deletions = calculateDeletions(items, FAST_LIMIT_2);
    expect(deletions.map((d) => d.pointGuid)).toEqual(['p-normal']);
  });

  test('cores/catalysers продолжают работать независимо от lock-фильтра (lock — только для рефов)', () => {
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

describe('calculateDeletions — условие запуска (только lock-поддержка)', () => {
  test('кэш без поля f во всех стопках: ключи не трогаются (0.6.0 / lock недоступен)', () => {
    // Поле f отсутствует во всех записях — lockSupportAvailable=false. Удаление
    // ключей блокируется, чтобы не задеть locked-точки вслепую.
    const items: IInventoryItem[] = [ref('s1', 'p1', 5)];
    const deletions = calculateDeletions(items, FAST_LIMIT_2);
    expect(deletions).toHaveLength(0);
  });

  test('хотя бы одна стопка с f=0: lockSupportAvailable=true → cleanup идёт', () => {
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
});
