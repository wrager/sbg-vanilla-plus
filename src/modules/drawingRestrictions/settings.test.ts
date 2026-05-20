import {
  defaultDrawingRestrictionsSettings,
  loadDrawingRestrictionsSettings,
  saveDrawingRestrictionsSettings,
} from './settings';

const STORAGE_KEY = 'svp_drawingRestrictions';

beforeEach(() => {
  localStorage.clear();
});

describe('loadDrawingRestrictionsSettings', () => {
  test('defaults при отсутствии данных', () => {
    const loaded = loadDrawingRestrictionsSettings();
    expect(loaded).toEqual(defaultDrawingRestrictionsSettings());
  });

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
    expect(localStorage.getItem(STORAGE_KEY)).toBe('{broken');
  });

  test('defaults при невалидной структуре', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1 }));
    expect(loadDrawingRestrictionsSettings()).toEqual(defaultDrawingRestrictionsSettings());
  });

  test('defaults если parsed — строка (typeof !== object)', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify('just-a-string'));
    expect(loadDrawingRestrictionsSettings()).toEqual(defaultDrawingRestrictionsSettings());
  });

  test('defaults если parsed — null', () => {
    localStorage.setItem(STORAGE_KEY, 'null');
    expect(loadDrawingRestrictionsSettings()).toEqual(defaultDrawingRestrictionsSettings());
  });

  test('defaults если нет поля version', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ maxDistanceMeters: 0 }));
    expect(loadDrawingRestrictionsSettings()).toEqual(defaultDrawingRestrictionsSettings());
  });

  test('defaults если version — не число', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: '1', maxDistanceMeters: 0 }));
    expect(loadDrawingRestrictionsSettings()).toEqual(defaultDrawingRestrictionsSettings());
  });

  test('defaults если нет поля maxDistanceMeters', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1 }));
    expect(loadDrawingRestrictionsSettings()).toEqual(defaultDrawingRestrictionsSettings());
  });

  test('defaults если maxDistanceMeters — строка', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, maxDistanceMeters: '500' }));
    expect(loadDrawingRestrictionsSettings()).toEqual(defaultDrawingRestrictionsSettings());
  });

  test('лишние поля в сохранённом JSON игнорируются при load', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: 1, maxDistanceMeters: 500, lockProtectionMode: 'protectLastKey' }),
    );
    expect(loadDrawingRestrictionsSettings()).toEqual({ version: 1, maxDistanceMeters: 500 });
  });

  test('round-trip: save → load сохраняет значения', () => {
    const custom = { version: 1, maxDistanceMeters: 750 };
    saveDrawingRestrictionsSettings(custom);
    expect(loadDrawingRestrictionsSettings()).toEqual(custom);
  });
});
