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

  test('defaultRefsOnMapSettings: ownTeamMode=keepOne', () => {
    expect(defaultRefsOnMapSettings()).toEqual({ ownTeamMode: 'keepOne' });
  });

  test('load при отсутствии записи возвращает дефолт', () => {
    expect(loadRefsOnMapSettings()).toEqual({ ownTeamMode: 'keepOne' });
  });

  test('load при невалидном JSON возвращает дефолт', () => {
    localStorage.setItem(STORAGE_KEY, 'not-json');
    expect(loadRefsOnMapSettings()).toEqual({ ownTeamMode: 'keepOne' });
  });

  test('load при невалидной структуре (не объект) возвращает дефолт', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(42));
    expect(loadRefsOnMapSettings()).toEqual({ ownTeamMode: 'keepOne' });
  });

  test('load при невалидной структуре (null) возвращает дефолт', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(null));
    expect(loadRefsOnMapSettings()).toEqual({ ownTeamMode: 'keepOne' });
  });

  test('load старого формата { keepOwnTeam, keepOneKey } возвращает дефолт', () => {
    // Миграции нет: старый формат не имеет поля ownTeamMode, отдаётся дефолт.
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ keepOwnTeam: true, keepOneKey: false }));
    expect(loadRefsOnMapSettings()).toEqual({ ownTeamMode: 'keepOne' });
  });

  test('load с ownTeamMode не из допустимого набора возвращает дефолт', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ownTeamMode: 'unknown' }));
    expect(loadRefsOnMapSettings()).toEqual({ ownTeamMode: 'keepOne' });
  });

  test('load: ownTeamMode=delete читается корректно', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ownTeamMode: 'delete' }));
    expect(loadRefsOnMapSettings()).toEqual({ ownTeamMode: 'delete' });
  });

  test('load: ownTeamMode=keep читается корректно', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ownTeamMode: 'keep' }));
    expect(loadRefsOnMapSettings()).toEqual({ ownTeamMode: 'keep' });
  });

  test('round-trip: save -> load возвращает то же значение', () => {
    saveRefsOnMapSettings({ ownTeamMode: 'delete' });
    expect(loadRefsOnMapSettings()).toEqual({ ownTeamMode: 'delete' });
  });

  test('save перезаписывает предыдущее значение', () => {
    saveRefsOnMapSettings({ ownTeamMode: 'keep' });
    saveRefsOnMapSettings({ ownTeamMode: 'delete' });
    expect(loadRefsOnMapSettings()).toEqual({ ownTeamMode: 'delete' });
  });
});
