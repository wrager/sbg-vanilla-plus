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

  test('defaultRefsOnMapSettings: keepOwnTeam=false, keepOneKey=true', () => {
    expect(defaultRefsOnMapSettings()).toEqual({ keepOwnTeam: false, keepOneKey: true });
  });

  test('load при отсутствии записи возвращает дефолт', () => {
    expect(loadRefsOnMapSettings()).toEqual({ keepOwnTeam: false, keepOneKey: true });
  });

  test('load при невалидном JSON возвращает дефолт', () => {
    localStorage.setItem(STORAGE_KEY, 'not-json');
    expect(loadRefsOnMapSettings()).toEqual({ keepOwnTeam: false, keepOneKey: true });
  });

  test('load при невалидной структуре (не объект) возвращает дефолт', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(42));
    expect(loadRefsOnMapSettings()).toEqual({ keepOwnTeam: false, keepOneKey: true });
  });

  test('load при невалидной структуре (null) возвращает дефолт', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(null));
    expect(loadRefsOnMapSettings()).toEqual({ keepOwnTeam: false, keepOneKey: true });
  });

  test('load старой записи без keepOneKey возвращает keepOneKey=true (fail-safe)', () => {
    // Записи у пользователей до добавления флага содержат только keepOwnTeam.
    // Чтение должно вернуть keepOneKey=true, иначе пользователь, не знающий
    // о новой фиче, при следующем DELETE может потерять все ключи точки.
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ keepOwnTeam: true }));
    expect(loadRefsOnMapSettings()).toEqual({ keepOwnTeam: true, keepOneKey: true });
  });

  test('load записи с keepOneKey=false читается как false (явный opt-out)', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ keepOwnTeam: false, keepOneKey: false }));
    expect(loadRefsOnMapSettings()).toEqual({ keepOwnTeam: false, keepOneKey: false });
  });

  test('load записи с keepOneKey не-boolean возвращает default true (fail-safe)', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ keepOwnTeam: false, keepOneKey: 'broken' }));
    expect(loadRefsOnMapSettings()).toEqual({ keepOwnTeam: false, keepOneKey: true });
  });

  test('load записи без keepOwnTeam возвращает keepOwnTeam=false (default)', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ keepOneKey: true }));
    expect(loadRefsOnMapSettings()).toEqual({ keepOwnTeam: false, keepOneKey: true });
  });

  test('round-trip: save -> load возвращает то же значение', () => {
    saveRefsOnMapSettings({ keepOwnTeam: true, keepOneKey: false });
    expect(loadRefsOnMapSettings()).toEqual({ keepOwnTeam: true, keepOneKey: false });
  });

  test('save перезаписывает предыдущее значение', () => {
    saveRefsOnMapSettings({ keepOwnTeam: true, keepOneKey: true });
    saveRefsOnMapSettings({ keepOwnTeam: false, keepOneKey: false });
    expect(loadRefsOnMapSettings()).toEqual({ keepOwnTeam: false, keepOneKey: false });
  });
});
