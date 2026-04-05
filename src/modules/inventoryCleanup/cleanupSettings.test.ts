import {
  defaultCleanupSettings,
  loadCleanupSettings,
  saveCleanupSettings,
  type ICleanupSettings,
} from './cleanupSettings';

const STORAGE_KEY = 'svp_inventoryCleanup';

afterEach(() => {
  localStorage.removeItem(STORAGE_KEY);
});

describe('cleanupSettings', () => {
  test('defaultCleanupSettings возвращает v2 с режимом off и лимитами -1', () => {
    const settings = defaultCleanupSettings();
    expect(settings.version).toBe(2);
    expect(settings.limits.referencesMode).toBe('off');
    expect(settings.limits.referencesFastLimit).toBe(-1);
    expect(settings.limits.referencesAlliedLimit).toBe(-1);
    expect(settings.limits.referencesHostileLimit).toBe(-1);
    expect(settings.minFreeSlots).toBe(100);
  });

  test('loadCleanupSettings на пустом хранилище возвращает дефолты', () => {
    const settings = loadCleanupSettings();
    expect(settings.version).toBe(2);
    expect(settings.limits.referencesMode).toBe('off');
  });

  test('loadCleanupSettings возвращает дефолты при невалидном JSON', () => {
    localStorage.setItem(STORAGE_KEY, 'not json');
    expect(loadCleanupSettings().version).toBe(2);
  });

  test('saveCleanupSettings + loadCleanupSettings (round-trip)', () => {
    const settings = defaultCleanupSettings();
    settings.limits.referencesMode = 'fast';
    settings.limits.referencesFastLimit = 100;
    saveCleanupSettings(settings);
    const loaded = loadCleanupSettings();
    expect(loaded.limits.referencesMode).toBe('fast');
    expect(loaded.limits.referencesFastLimit).toBe(100);
  });

  test('миграция v1 → v2: references=-1 становится mode=off', () => {
    const v1 = {
      version: 1,
      limits: {
        cores: levelLimits(),
        catalysers: levelLimits(),
        references: -1,
      },
      minFreeSlots: 100,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(v1));
    const loaded = loadCleanupSettings();
    expect(loaded.version).toBe(2);
    expect(loaded.limits.referencesMode).toBe('off');
    expect(loaded.limits.referencesFastLimit).toBe(-1);
  });

  test('миграция v1 → v2: references=N становится mode=fast с тем же лимитом', () => {
    const v1 = {
      version: 1,
      limits: {
        cores: levelLimits(),
        catalysers: levelLimits(),
        references: 150,
      },
      minFreeSlots: 100,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(v1));
    const loaded = loadCleanupSettings();
    expect(loaded.version).toBe(2);
    expect(loaded.limits.referencesMode).toBe('fast');
    expect(loaded.limits.referencesFastLimit).toBe(150);
  });

  test('миграция сохраняет мигрированную версию обратно в localStorage', () => {
    const v1 = {
      version: 1,
      limits: {
        cores: levelLimits(),
        catalysers: levelLimits(),
        references: 50,
      },
      minFreeSlots: 100,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(v1));
    loadCleanupSettings();
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = JSON.parse(raw ?? '{}') as { version: number };
    expect(parsed.version).toBe(2);
  });

  test('миграция сохраняет cores/catalysers лимиты', () => {
    const v1 = {
      version: 1,
      limits: {
        cores: levelLimits({ 5: 20, 6: 10 }),
        catalysers: levelLimits({ 1: 50 }),
        references: -1,
      },
      minFreeSlots: 100,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(v1));
    const loaded = loadCleanupSettings();
    expect(loaded.limits.cores[5]).toBe(20);
    expect(loaded.limits.cores[6]).toBe(10);
    expect(loaded.limits.catalysers[1]).toBe(50);
  });

  test('minFreeSlots клампится к полу 20', () => {
    const settings: ICleanupSettings = defaultCleanupSettings();
    settings.minFreeSlots = 5;
    saveCleanupSettings(settings);
    expect(loadCleanupSettings().minFreeSlots).toBe(20);
  });

  test('негативные лимиты (кроме -1) клампятся к 0', () => {
    const settings: ICleanupSettings = defaultCleanupSettings();
    settings.limits.referencesFastLimit = -5;
    settings.limits.referencesAlliedLimit = -10;
    saveCleanupSettings(settings);
    const loaded = loadCleanupSettings();
    expect(loaded.limits.referencesFastLimit).toBe(0);
    expect(loaded.limits.referencesAlliedLimit).toBe(0);
  });

  test('невалидная структура (только version) → дефолты', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 2 }));
    expect(loadCleanupSettings()).toEqual(defaultCleanupSettings());
  });

  test('defaultCleanupSettings имеет все уровни cores/catalysers -1', () => {
    const settings = defaultCleanupSettings();
    for (let level = 1; level <= 10; level++) {
      expect(settings.limits.cores[level]).toBe(-1);
      expect(settings.limits.catalysers[level]).toBe(-1);
    }
  });

  test('loadCleanupSettings сохраняет minFreeSlots >= 20', () => {
    const settings = defaultCleanupSettings();
    settings.minFreeSlots = 25;
    saveCleanupSettings(settings);
    expect(loadCleanupSettings().minFreeSlots).toBe(25);
  });

  test('loadCleanupSettings сохраняет -1 лимиты (unlimited)', () => {
    const settings = defaultCleanupSettings();
    settings.limits.cores[5] = -1;
    saveCleanupSettings(settings);
    expect(loadCleanupSettings().limits.cores[5]).toBe(-1);
  });

  test('невалидный referencesMode отклоняется → дефолты', () => {
    const corrupt = {
      version: 2,
      limits: {
        cores: levelLimits(),
        catalysers: levelLimits(),
        referencesMode: 'invalid',
        referencesFastLimit: -1,
        referencesAlliedLimit: -1,
        referencesHostileLimit: -1,
      },
      minFreeSlots: 100,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(corrupt));
    expect(loadCleanupSettings().limits.referencesMode).toBe('off');
  });
});

function levelLimits(overrides: Record<number, number> = {}): Record<number, number> {
  const result: Record<number, number> = {};
  for (let level = 1; level <= 10; level++) {
    result[level] = overrides[level] ?? -1;
  }
  return result;
}
