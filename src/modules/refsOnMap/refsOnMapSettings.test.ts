import {
  defaultRefsOnMapSettings,
  loadRefsOnMapSettings,
  saveRefsOnMapSettings,
} from './refsOnMapSettings';

const STORAGE_KEY = 'svp_refsOnMap';

describe('refsOnMapSettings', () => {
  afterEach(() => {
    localStorage.removeItem(STORAGE_KEY);
  });

  test('defaultRefsOnMapSettings: keepOwnTeam=false', () => {
    expect(defaultRefsOnMapSettings()).toEqual({ keepOwnTeam: false });
  });

  test('load при отсутствии записи возвращает дефолт', () => {
    expect(loadRefsOnMapSettings()).toEqual({ keepOwnTeam: false });
  });

  test('load при невалидном JSON возвращает дефолт', () => {
    localStorage.setItem(STORAGE_KEY, 'not-json');
    expect(loadRefsOnMapSettings()).toEqual({ keepOwnTeam: false });
  });

  test('load при невалидной структуре возвращает дефолт', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ unrelated: 1 }));
    expect(loadRefsOnMapSettings()).toEqual({ keepOwnTeam: false });
  });

  test('round-trip: save -> load возвращает то же значение', () => {
    saveRefsOnMapSettings({ keepOwnTeam: true });
    expect(loadRefsOnMapSettings()).toEqual({ keepOwnTeam: true });
  });

  test('save перезаписывает предыдущее значение', () => {
    saveRefsOnMapSettings({ keepOwnTeam: true });
    saveRefsOnMapSettings({ keepOwnTeam: false });
    expect(loadRefsOnMapSettings()).toEqual({ keepOwnTeam: false });
  });
});
