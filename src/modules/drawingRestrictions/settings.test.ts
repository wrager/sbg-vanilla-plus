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
  });
});
