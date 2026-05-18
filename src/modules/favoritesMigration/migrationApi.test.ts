import {
  buildCandidates,
  inferAndPersistLockMigrationDone,
  runMigration,
  type IMigrationItem,
  type MigrationFlag,
} from './migrationApi';

// Мок favoritesStore.getFavoritedGuids — возвращаем заданный Set GUID'ов точек.
let favoritedGuidsMock: Set<string>;
let lockMigrationDoneMock = false;
const setLockMigrationDoneSpy = jest.fn(() => {
  lockMigrationDoneMock = true;
});

jest.mock('../../core/favoritesStore', () => ({
  getFavoritedGuids: () => favoritedGuidsMock,
  // Не вызывается в migrationApi.ts напрямую, но импортируется типом — прокидываем заглушку.
  loadFavorites: jest.fn(),
  isLockMigrationDone: () => lockMigrationDoneMock,
  setLockMigrationDone: (): void => {
    setLockMigrationDoneSpy();
  },
}));

const AUTH_TOKEN = 'auth-test';

let originalFetch: typeof window.fetch;
let mockFetch: jest.Mock;

beforeEach(() => {
  favoritedGuidsMock = new Set<string>();
  lockMigrationDoneMock = false;
  setLockMigrationDoneSpy.mockClear();
  localStorage.clear();
  localStorage.setItem('auth', AUTH_TOKEN);

  mockFetch = jest.fn();
  originalFetch = window.fetch;
  Object.defineProperty(window, 'fetch', { value: mockFetch, writable: true });
});

afterEach(() => {
  window.fetch = originalFetch;
  localStorage.clear();
});

function setInventory(items: { g: string; t: number; l: string; a: number; f?: number }[]): void {
  localStorage.setItem('inventory-cache', JSON.stringify(items));
}

function ok(result: boolean): void {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: () => Promise.resolve({ result }),
  });
}

function networkError(): void {
  mockFetch.mockRejectedValueOnce(new Error('network'));
}

describe('buildCandidates', () => {
  test('пустой favoritedGuids — пустой результат', () => {
    setInventory([{ g: 's1', t: 3, l: 'p-other', a: 1, f: 0 }]);
    const candidates = buildCandidates('favorite');
    expect(candidates.toSend).toHaveLength(0);
    expect(candidates.withoutKeysGuids).toEqual([]);
    expect(candidates.alreadyApplied).toBe(0);
  });

  test('точка из избранных без ключей в инвентаре попадает в withoutKeysGuids', () => {
    favoritedGuidsMock = new Set(['p-fav']);
    setInventory([]);
    const candidates = buildCandidates('favorite');
    expect(candidates.toSend).toHaveLength(0);
    expect(candidates.withoutKeysGuids).toEqual(['p-fav']);
  });

  test('две стопки одной точки — обе попадают в toSend (per-stack обработка)', () => {
    favoritedGuidsMock = new Set(['p-fav']);
    setInventory([
      { g: 'stack-a', t: 3, l: 'p-fav', a: 3, f: 0 },
      { g: 'stack-b', t: 3, l: 'p-fav', a: 2, f: 0 },
    ]);
    const candidates = buildCandidates('favorite');
    expect(candidates.toSend).toHaveLength(2);
    expect(candidates.toSend.map((i) => i.itemGuid).sort()).toEqual(['stack-a', 'stack-b']);
  });

  test('стопка с уже выставленным favorite-битом (f=0b01) идёт в alreadyApplied при flag=favorite', () => {
    favoritedGuidsMock = new Set(['p-fav']);
    setInventory([
      { g: 's-already', t: 3, l: 'p-fav', a: 3, f: 0b01 },
      { g: 's-needs', t: 3, l: 'p-fav', a: 2, f: 0 },
    ]);
    const candidates = buildCandidates('favorite');
    expect(candidates.toSend.map((i) => i.itemGuid)).toEqual(['s-needs']);
    expect(candidates.alreadyApplied).toBe(1);
  });

  test('тот же кэш для flag=locked даёт другой результат (бит 0b10)', () => {
    favoritedGuidsMock = new Set(['p-fav']);
    setInventory([
      { g: 's-already-fav', t: 3, l: 'p-fav', a: 3, f: 0b01 }, // только favorite
      { g: 's-already-lock', t: 3, l: 'p-fav', a: 2, f: 0b10 }, // только locked
    ]);
    const candidates = buildCandidates('locked');
    expect(candidates.toSend.map((i) => i.itemGuid)).toEqual(['s-already-fav']);
    expect(candidates.alreadyApplied).toBe(1);
  });

  test('игнорирует точки, не входящие в favoritedGuids', () => {
    favoritedGuidsMock = new Set(['p-fav']);
    setInventory([
      { g: 's1', t: 3, l: 'p-fav', a: 1, f: 0 },
      { g: 's2', t: 3, l: 'p-other', a: 1, f: 0 },
    ]);
    const candidates = buildCandidates('favorite');
    expect(candidates.toSend.map((i) => i.itemGuid)).toEqual(['s1']);
  });
});

function items(...guids: string[]): IMigrationItem[] {
  return guids.map((g) => ({ itemGuid: g, pointGuid: `p-${g}` }));
}

describe('runMigration — retry-механизм', () => {
  test('все стопки result=true: все в succeeded, пустые списки failed', async () => {
    ok(true);
    ok(true);
    const result = await runMigration(items('s1', 's2'), {
      flag: 'favorite',
      requestDelayMs: 0,
      networkRetryDelaysMs: [],
      toggleRetryDelayMs: 0,
    });
    expect(result.succeeded.map((i) => i.itemGuid).sort()).toEqual(['s1', 's2']);
    expect(result.networkFailed).toHaveLength(0);
    expect(result.toggleStuck).toHaveLength(0);
  });

  test('toggleOff (result=false) → один retry; во второй раз true → succeeded', async () => {
    ok(false); // первая попытка: toggle off
    ok(true); // retry: toggle on
    const result = await runMigration(items('s1'), {
      flag: 'favorite',
      requestDelayMs: 0,
      networkRetryDelaysMs: [],
      toggleRetryDelayMs: 0,
    });
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(result.succeeded.map((i) => i.itemGuid)).toEqual(['s1']);
    expect(result.toggleStuck).toHaveLength(0);
  });

  test('toggleOff после retry снова false → toggleStuck', async () => {
    ok(false); // первая
    ok(false); // retry
    const result = await runMigration(items('s1'), {
      flag: 'favorite',
      requestDelayMs: 0,
      networkRetryDelaysMs: [],
      toggleRetryDelayMs: 0,
    });
    expect(result.succeeded).toHaveLength(0);
    expect(result.toggleStuck.map((i) => i.itemGuid)).toEqual(['s1']);
  });

  test('сетевая ошибка без retry: networkRetryDelaysMs=[] → networkFailed', async () => {
    networkError();
    const result = await runMigration(items('s1'), {
      flag: 'favorite',
      requestDelayMs: 0,
      networkRetryDelaysMs: [],
      toggleRetryDelayMs: 0,
    });
    expect(result.networkFailed.map((i) => i.itemGuid)).toEqual(['s1']);
    expect(result.succeeded).toHaveLength(0);
  });

  test('сетевая ошибка + auto-retry с одной попыткой → retry успешен → succeeded', async () => {
    networkError();
    ok(true);
    const result = await runMigration(items('s1'), {
      flag: 'favorite',
      requestDelayMs: 0,
      networkRetryDelaysMs: [0],
      toggleRetryDelayMs: 0,
    });
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(result.succeeded.map((i) => i.itemGuid)).toEqual(['s1']);
    expect(result.networkFailed).toHaveLength(0);
  });

  test('многоступенчатый auto-retry: первые две попытки сеть, третья успех', async () => {
    networkError(); // initial
    networkError(); // retry 1
    ok(true); // retry 2
    const result = await runMigration(items('s1'), {
      flag: 'favorite',
      requestDelayMs: 0,
      networkRetryDelaysMs: [0, 0],
      toggleRetryDelayMs: 0,
    });
    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(result.succeeded.map((i) => i.itemGuid)).toEqual(['s1']);
  });

  test('auto-retry исчерпан: все попытки сеть → стопка в networkFailed', async () => {
    networkError(); // initial
    networkError(); // retry 1
    networkError(); // retry 2
    const result = await runMigration(items('s1'), {
      flag: 'favorite',
      requestDelayMs: 0,
      networkRetryDelaysMs: [0, 0],
      toggleRetryDelayMs: 0,
    });
    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(result.networkFailed.map((i) => i.itemGuid)).toEqual(['s1']);
    expect(result.succeeded).toHaveLength(0);
  });

  test('onProgress вызывается с актуальными числами', async () => {
    ok(true);
    ok(true);
    const onProgress = jest.fn();
    await runMigration(items('s1', 's2'), {
      flag: 'favorite',
      onProgress,
      requestDelayMs: 0,
      networkRetryDelaysMs: [],
      toggleRetryDelayMs: 0,
    });
    expect(onProgress).toHaveBeenCalled();
    const lastCall = onProgress.mock.calls[onProgress.mock.calls.length - 1] as [
      { done: number; total: number; succeeded: number },
    ];
    expect(lastCall[0]).toEqual({ done: 2, total: 2, succeeded: 2 });
  });

  test('пустой массив items → пустой результат, fetch не вызывается', async () => {
    const result = await runMigration([], {
      flag: 'favorite',
      requestDelayMs: 0,
      networkRetryDelaysMs: [],
      toggleRetryDelayMs: 0,
    });
    expect(mockFetch).not.toHaveBeenCalled();
    expect(result.succeeded).toHaveLength(0);
  });

  test('flag=locked прокидывается в payload', async () => {
    ok(true);
    await runMigration(items('s-lock'), {
      flag: 'locked' satisfies MigrationFlag,
      requestDelayMs: 0,
      networkRetryDelaysMs: [],
      toggleRetryDelayMs: 0,
    });
    const body = (mockFetch.mock.calls[0] as [string, { body: string }])[1].body;
    expect(JSON.parse(body)).toEqual({ guid: 's-lock', flag: 'locked' });
  });
});

describe('runMigration — onPhaseChange', () => {
  test('initial фаза вызывается в начале с total = items.length', async () => {
    ok(true);
    ok(true);
    const phaseChanges: { name: string; total: number }[] = [];
    await runMigration(items('s1', 's2'), {
      flag: 'favorite',
      onPhaseChange: (phase) => phaseChanges.push({ name: phase.name, total: phase.total }),
      requestDelayMs: 0,
      networkRetryDelaysMs: [],
      toggleRetryDelayMs: 0,
    });
    expect(phaseChanges).toEqual([{ name: 'initial', total: 2 }]);
  });

  test('retry-toggle фаза стартует с total = toggleOff.length, не с накопленным total', async () => {
    ok(true); // s1 ok
    ok(false); // s2 toggle-off
    ok(true); // s2 retry success
    const phaseChanges: { name: string; total: number }[] = [];
    await runMigration(items('s1', 's2'), {
      flag: 'favorite',
      onPhaseChange: (phase) => phaseChanges.push({ name: phase.name, total: phase.total }),
      requestDelayMs: 0,
      networkRetryDelaysMs: [],
      toggleRetryDelayMs: 0,
    });
    expect(phaseChanges).toEqual([
      { name: 'initial', total: 2 },
      { name: 'retry-toggle', total: 1 },
    ]);
  });

  test('retry-network фаза вызывается на каждую auto-retry попытку с total = pending.length', async () => {
    networkError();
    networkError();
    ok(true);
    const phaseChanges: { name: string; total: number }[] = [];
    await runMigration(items('s1'), {
      flag: 'favorite',
      onPhaseChange: (phase) => phaseChanges.push({ name: phase.name, total: phase.total }),
      requestDelayMs: 0,
      networkRetryDelaysMs: [0, 0],
      toggleRetryDelayMs: 0,
    });
    expect(phaseChanges).toEqual([
      { name: 'initial', total: 1 },
      { name: 'retry-network', total: 1 },
      { name: 'retry-network', total: 1 },
    ]);
  });

  test('onProgress в retry-фазе считает done с 0, не накапливает с предыдущей фазы', async () => {
    ok(false); // s1 toggle-off
    ok(true); // s1 retry success
    const progressEvents: { done: number; total: number }[] = [];
    let phase = 'initial';
    await runMigration(items('s1'), {
      flag: 'favorite',
      onPhaseChange: (p) => {
        phase = p.name;
      },
      onProgress: (p) => {
        progressEvents.push({ done: p.done, total: p.total });
      },
      requestDelayMs: 0,
      networkRetryDelaysMs: [],
      toggleRetryDelayMs: 0,
    });
    expect(phase).toBe('retry-toggle');
    // Финальный progress retry-фазы: done=1, total=1 (свой бар, не 2/2 от старого).
    const last = progressEvents[progressEvents.length - 1];
    expect(last).toEqual({ done: 1, total: 1 });
  });
});

describe('inferAndPersistLockMigrationDone', () => {
  test('legacy-список пуст: флаг не выставляется', () => {
    favoritedGuidsMock = new Set<string>();
    setInventory([]);
    inferAndPersistLockMigrationDone();
    expect(setLockMigrationDoneSpy).not.toHaveBeenCalled();
  });

  test('флаг уже выставлен: ничего не делает', () => {
    favoritedGuidsMock = new Set<string>(['p1']);
    lockMigrationDoneMock = true;
    setInventory([{ g: 'r1', t: 3, l: 'p1', a: 5 }]); // даже без lock
    inferAndPersistLockMigrationDone();
    expect(setLockMigrationDoneSpy).not.toHaveBeenCalled();
  });

  test('legacy непустой, ВСЕ legacy-точки имеют locked-стопку: флаг выставляется', () => {
    favoritedGuidsMock = new Set<string>(['p1', 'p2']);
    setInventory([
      { g: 'r1', t: 3, l: 'p1', a: 5, f: 0b10 },
      { g: 'r2', t: 3, l: 'p2', a: 3, f: 0b10 },
    ]);
    inferAndPersistLockMigrationDone();
    expect(setLockMigrationDoneSpy).toHaveBeenCalledTimes(1);
  });

  test('legacy непустой, у legacy-точки нет стопок ключей: с другой подтверждённой legacy флаг ставится', () => {
    // p1 имеет stacks+lock - подтверждение, что миграция была фактически
    // проведена. p-no-keys без стопок и без lock сама по себе не доказывает
    // и не опровергает - проходит как нейтральная.
    favoritedGuidsMock = new Set<string>(['p1', 'p-no-keys']);
    setInventory([{ g: 'r1', t: 3, l: 'p1', a: 5, f: 0b10 }]);
    inferAndPersistLockMigrationDone();
    expect(setLockMigrationDoneSpy).toHaveBeenCalledTimes(1);
  });

  test('legacy непустой, есть legacy-точка с ключами без lock: флаг НЕ выставляется', () => {
    favoritedGuidsMock = new Set<string>(['p1', 'p2']);
    setInventory([
      { g: 'r1', t: 3, l: 'p1', a: 5, f: 0b10 },
      { g: 'r2', t: 3, l: 'p2', a: 3, f: 0 }, // не locked
    ]);
    inferAndPersistLockMigrationDone();
    expect(setLockMigrationDoneSpy).not.toHaveBeenCalled();
  });

  test('legacy непустой, ни одна legacy-точка не locked: флаг НЕ выставляется', () => {
    favoritedGuidsMock = new Set<string>(['p1']);
    setInventory([{ g: 'r1', t: 3, l: 'p1', a: 5, f: 0 }]);
    inferAndPersistLockMigrationDone();
    expect(setLockMigrationDoneSpy).not.toHaveBeenCalled();
  });

  test('свежеустановленный пользователь: legacy есть, но в инвентаре нет ни ключей, ни lock - флаг НЕ выставляется', () => {
    // Регрессионный сценарий: пользователь установил скрипт впервые на
    // 0.6.1+, добавил точку через CUI/чужую установку SVP, ключей этой
    // точки в инвентаре сейчас нет. Старая логика ставила флаг (потому что
    // hasStacks=false для всех legacy и точка не "блокировала" решение); в
    // итоге автоочистка снимала блок ещё до того как пользователь начнёт
    // мигрировать, и при наборе ключей этой точки они удалялись без
    // защиты. Новая логика требует positive evidence (legacy И stacks И
    // lock одновременно) - без него флаг остаётся false.
    favoritedGuidsMock = new Set<string>(['p1']);
    setInventory([]);
    inferAndPersistLockMigrationDone();
    expect(setLockMigrationDoneSpy).not.toHaveBeenCalled();
  });

  test('inventory-cache отсутствует: флаг НЕ выставляется', () => {
    // Кэш не загружен - не можем верифицировать что миграция была
    // проведена. Безопаснее оставить блок и попросить пользователя пройти
    // миграцию через UI, чем снять блок на основе пустого свидетельства.
    favoritedGuidsMock = new Set<string>(['p1']);
    localStorage.removeItem('inventory-cache');
    inferAndPersistLockMigrationDone();
    expect(setLockMigrationDoneSpy).not.toHaveBeenCalled();
  });

  test('legacy-точка с amount=0 (раздал ключи): без других подтверждений флаг НЕ выставляется', () => {
    // a=0 трактуется как hasStacks=false (стопка не считается активной).
    // Без дополнительных подтверждений (другая legacy с stacks+lock)
    // hasMigrationEvidence остаётся false.
    favoritedGuidsMock = new Set<string>(['p1']);
    setInventory([{ g: 'r1', t: 3, l: 'p1', a: 0, f: 0 }]);
    inferAndPersistLockMigrationDone();
    expect(setLockMigrationDoneSpy).not.toHaveBeenCalled();
  });

  test('legacy непустой, все стопки legacy с lock но a=0: флаг НЕ выставляется', () => {
    // Edge: пользователь мигрировал, потом раздал/удалил все ключи.
    // a=0 не считается positive evidence (стопка не активна). Пользователь
    // увидит блок автоочистки и пройдёт миграцию через UI - там lockComplete
    // проставит флаг через явное действие.
    favoritedGuidsMock = new Set<string>(['p1']);
    setInventory([{ g: 'r1', t: 3, l: 'p1', a: 0, f: 0b10 }]);
    inferAndPersistLockMigrationDone();
    expect(setLockMigrationDoneSpy).not.toHaveBeenCalled();
  });
});
