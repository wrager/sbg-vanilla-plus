import {
  loadFavoritedPointsSettings,
  saveFavoritedPointsSettings,
  defaultFavoritedPointsSettings,
} from './settings';

const STORAGE_KEY = 'svp_favoritedPoints';

beforeEach(() => {
  localStorage.clear();
});

describe('loadFavoritedPointsSettings', () => {
  test('возвращает defaults при отсутствии данных', () => {
    expect(loadFavoritedPointsSettings()).toEqual(defaultFavoritedPointsSettings());
  });

  test('возвращает defaults при невалидном JSON', () => {
    localStorage.setItem(STORAGE_KEY, '{broken');
    expect(loadFavoritedPointsSettings()).toEqual(defaultFavoritedPointsSettings());
  });

  test('возвращает defaults при невалидной структуре', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1 }));
    expect(loadFavoritedPointsSettings()).toEqual(defaultFavoritedPointsSettings());
  });

  test('round-trip: save → load сохраняет значения', () => {
    const custom = { version: 1, hideLastFavRef: false };
    saveFavoritedPointsSettings(custom);
    expect(loadFavoritedPointsSettings()).toEqual(custom);
  });
});
