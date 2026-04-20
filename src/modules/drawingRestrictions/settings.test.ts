import {
  defaultDrawingRestrictionsSettings,
  loadDrawingRestrictionsSettings,
  migrateDrawingRestrictionsSettings,
  saveDrawingRestrictionsSettings,
} from './settings';

const STORAGE_KEY = 'svp_drawingRestrictions';
const LEGACY_STORAGE_KEY = 'svp_favoritedPoints';

beforeEach(() => {
  localStorage.clear();
});

describe('loadDrawingRestrictionsSettings', () => {
  test('defaults при отсутствии данных и без legacy', () => {
    const loaded = loadDrawingRestrictionsSettings();
    expect(loaded).toEqual(defaultDrawingRestrictionsSettings());
  });

  // 10.F FALSE: load без svp_drawingRestrictions — чистый геттер, без записи.
  test('load без ключа НЕ пишет в localStorage (чистый геттер)', () => {
    loadDrawingRestrictionsSettings();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  test('defaults при невалидном JSON', () => {
    localStorage.setItem(STORAGE_KEY, '{broken');
    expect(loadDrawingRestrictionsSettings()).toEqual(defaultDrawingRestrictionsSettings());
  });

  test('load при невалидном JSON НЕ перезаписывает ключ', () => {
    localStorage.setItem(STORAGE_KEY, '{broken');
    loadDrawingRestrictionsSettings();
    // Значение в localStorage осталось как было (load не пишет).
    expect(localStorage.getItem(STORAGE_KEY)).toBe('{broken');
  });

  test('defaults при невалидной структуре', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1 }));
    expect(loadDrawingRestrictionsSettings()).toEqual(defaultDrawingRestrictionsSettings());
  });

  // isSettings narrowing: FALSE-ветки каждой атомарной проверки.
  test('defaults если parsed — строка (typeof !== object)', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify('just-a-string'));
    expect(loadDrawingRestrictionsSettings()).toEqual(defaultDrawingRestrictionsSettings());
  });

  test('defaults если parsed — null', () => {
    localStorage.setItem(STORAGE_KEY, 'null');
    expect(loadDrawingRestrictionsSettings()).toEqual(defaultDrawingRestrictionsSettings());
  });

  test('defaults если нет поля version', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ favProtectionMode: 'off', maxDistanceMeters: 0 }),
    );
    expect(loadDrawingRestrictionsSettings()).toEqual(defaultDrawingRestrictionsSettings());
  });

  test('defaults если version — не число', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: '1', favProtectionMode: 'off', maxDistanceMeters: 0 }),
    );
    expect(loadDrawingRestrictionsSettings()).toEqual(defaultDrawingRestrictionsSettings());
  });

  test('defaults если нет поля favProtectionMode', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, maxDistanceMeters: 0 }));
    expect(loadDrawingRestrictionsSettings()).toEqual(defaultDrawingRestrictionsSettings());
  });

  test('defaults если favProtectionMode — неизвестное значение', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: 1, favProtectionMode: 'invalid', maxDistanceMeters: 0 }),
    );
    expect(loadDrawingRestrictionsSettings()).toEqual(defaultDrawingRestrictionsSettings());
  });

  test('defaults если нет поля maxDistanceMeters', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, favProtectionMode: 'off' }));
    expect(loadDrawingRestrictionsSettings()).toEqual(defaultDrawingRestrictionsSettings());
  });

  test('defaults если maxDistanceMeters — строка', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: 1, favProtectionMode: 'off', maxDistanceMeters: '500' }),
    );
    expect(loadDrawingRestrictionsSettings()).toEqual(defaultDrawingRestrictionsSettings());
  });

  test('round-trip: save → load сохраняет значения', () => {
    const custom = {
      version: 1,
      favProtectionMode: 'hideAllFavorites' as const,
      maxDistanceMeters: 750,
    };
    saveDrawingRestrictionsSettings(custom);
    expect(loadDrawingRestrictionsSettings()).toEqual(custom);
  });
});

describe('migrateDrawingRestrictionsSettings', () => {
  // 10.E FALSE (legacy=true): protectLastKey.
  test('legacy hideLastFavRef=true → сохраняет svp_drawingRestrictions с protectLastKey', () => {
    localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify({ hideLastFavRef: true }));
    migrateDrawingRestrictionsSettings();
    expect(loadDrawingRestrictionsSettings().favProtectionMode).toBe('protectLastKey');
    expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull();
  });

  // 10.E FALSE (legacy=false): off.
  test('legacy hideLastFavRef=false → off', () => {
    localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify({ hideLastFavRef: false }));
    migrateDrawingRestrictionsSettings();
    expect(loadDrawingRestrictionsSettings().favProtectionMode).toBe('off');
  });

  // 10.A TRUE: ключ уже есть — не перезаписывает.
  test('не перезаписывает существующий svp_drawingRestrictions', () => {
    const current = {
      version: 1,
      favProtectionMode: 'hideAllFavorites' as const,
      maxDistanceMeters: 500,
    };
    saveDrawingRestrictionsSettings(current);
    localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify({ hideLastFavRef: true }));
    migrateDrawingRestrictionsSettings();
    expect(loadDrawingRestrictionsSettings()).toEqual(current);
  });

  // 10.E TRUE (legacy=null) — defaults.
  test('новый пользователь без legacy → defaults с protectLastKey', () => {
    migrateDrawingRestrictionsSettings();
    const loaded = loadDrawingRestrictionsSettings();
    expect(loaded).toEqual(defaultDrawingRestrictionsSettings());
    expect(loaded.favProtectionMode).toBe('protectLastKey');
  });

  // readLegacyFavMode FALSE-ветки → legacy=null → default protectLastKey.
  test('битый legacy JSON → default protectLastKey', () => {
    localStorage.setItem(LEGACY_STORAGE_KEY, '{broken');
    migrateDrawingRestrictionsSettings();
    expect(loadDrawingRestrictionsSettings().favProtectionMode).toBe('protectLastKey');
  });

  test('legacy без поля hideLastFavRef → default protectLastKey', () => {
    localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify({ version: 1 }));
    migrateDrawingRestrictionsSettings();
    expect(loadDrawingRestrictionsSettings().favProtectionMode).toBe('protectLastKey');
  });

  test('legacy — строка (typeof !== object) → default protectLastKey', () => {
    localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify('just-a-string'));
    migrateDrawingRestrictionsSettings();
    expect(loadDrawingRestrictionsSettings().favProtectionMode).toBe('protectLastKey');
  });

  test('legacy — null → default protectLastKey', () => {
    localStorage.setItem(LEGACY_STORAGE_KEY, 'null');
    migrateDrawingRestrictionsSettings();
    expect(loadDrawingRestrictionsSettings().favProtectionMode).toBe('protectLastKey');
  });

  test('legacy hideLastFavRef — строка (не boolean) → default protectLastKey', () => {
    localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify({ hideLastFavRef: 'true' }));
    migrateDrawingRestrictionsSettings();
    expect(loadDrawingRestrictionsSettings().favProtectionMode).toBe('protectLastKey');
  });

  // Идемпотентность: повторный вызов не меняет.
  test('повторный migrate — не перезаписывает', () => {
    localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify({ hideLastFavRef: true }));
    migrateDrawingRestrictionsSettings();
    // Пользователь сохранил кастомную настройку.
    saveDrawingRestrictionsSettings({
      version: 1,
      favProtectionMode: 'off',
      maxDistanceMeters: 0,
    });
    // Второй вызов migrate не должен вернуть protectLastKey.
    migrateDrawingRestrictionsSettings();
    expect(loadDrawingRestrictionsSettings().favProtectionMode).toBe('off');
  });
});
