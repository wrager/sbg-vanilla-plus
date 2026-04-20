import {
  defaultDrawingRestrictionsSettings,
  loadDrawingRestrictionsSettings,
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

  test('defaults при невалидном JSON', () => {
    localStorage.setItem(STORAGE_KEY, '{broken');
    expect(loadDrawingRestrictionsSettings()).toEqual(defaultDrawingRestrictionsSettings());
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

  describe('миграция hideLastFavRef', () => {
    test('true → protectLastKey и сохраняет результат', () => {
      localStorage.setItem(
        LEGACY_STORAGE_KEY,
        JSON.stringify({ version: 1, hideLastFavRef: true }),
      );
      const loaded = loadDrawingRestrictionsSettings();
      expect(loaded.favProtectionMode).toBe('protectLastKey');
      // Миграция закрыта: повторный load читает из основного ключа, не из legacy.
      expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull();
    });

    test('false → off', () => {
      localStorage.setItem(
        LEGACY_STORAGE_KEY,
        JSON.stringify({ version: 1, hideLastFavRef: false }),
      );
      const loaded = loadDrawingRestrictionsSettings();
      expect(loaded.favProtectionMode).toBe('off');
    });

    test('не перезаписывает существующий svp_drawingRestrictions', () => {
      const current = {
        version: 1,
        favProtectionMode: 'hideAllFavorites' as const,
        maxDistanceMeters: 500,
      };
      saveDrawingRestrictionsSettings(current);
      localStorage.setItem(
        LEGACY_STORAGE_KEY,
        JSON.stringify({ version: 1, hideLastFavRef: true }),
      );
      const loaded = loadDrawingRestrictionsSettings();
      expect(loaded).toEqual(current);
    });

    test('битый legacy JSON → default protectLastKey', () => {
      localStorage.setItem(LEGACY_STORAGE_KEY, '{broken');
      const loaded = loadDrawingRestrictionsSettings();
      expect(loaded.favProtectionMode).toBe('protectLastKey');
    });

    test('legacy без поля hideLastFavRef → default protectLastKey', () => {
      localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify({ version: 1 }));
      const loaded = loadDrawingRestrictionsSettings();
      expect(loaded.favProtectionMode).toBe('protectLastKey');
    });

    // readLegacyFavMode narrowing: FALSE-ветки атомарных проверок.
    test('legacy — строка (typeof !== object) → default protectLastKey', () => {
      localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify('just-a-string'));
      expect(loadDrawingRestrictionsSettings().favProtectionMode).toBe('protectLastKey');
    });

    test('legacy — null → default protectLastKey', () => {
      localStorage.setItem(LEGACY_STORAGE_KEY, 'null');
      expect(loadDrawingRestrictionsSettings().favProtectionMode).toBe('protectLastKey');
    });

    test('legacy hideLastFavRef — строка (не boolean) → default protectLastKey', () => {
      localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify({ hideLastFavRef: 'true' }));
      expect(loadDrawingRestrictionsSettings().favProtectionMode).toBe('protectLastKey');
    });
  });
});
