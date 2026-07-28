import { stubPrefersColorSchemeDark } from '../__mocks__/jestPolyfills';
import { isGameCartoDbBaselayer, isGameDarkTheme, readGameSetting } from './gameSettings';

describe('readGameSetting', () => {
  afterEach(() => {
    localStorage.clear();
    jest.restoreAllMocks();
  });

  test('возвращает значение поля, когда ключ settings есть', () => {
    localStorage.setItem('settings', JSON.stringify({ lang: 'ru', theme: 'dark' }));
    expect(readGameSetting('lang')).toBe('ru');
    expect(readGameSetting('theme')).toBe('dark');
  });

  // SBG 0.7.0 создаёт ключ только при первом изменении настройки, поэтому его
  // отсутствие означает "игра работает по своим дефолтам", а не "настроек нет".
  test('ключа settings нет: отдаёт дефолты игры', () => {
    expect(readGameSetting('lang')).toBe('sys');
    expect(readGameSetting('theme')).toBe('auto');
    expect(readGameSetting('base')).toBe('cdb');
  });

  test('невалидный JSON: отдаёт дефолты игры', () => {
    localStorage.setItem('settings', 'not-json');
    expect(readGameSetting('lang')).toBe('sys');
    expect(readGameSetting('theme')).toBe('auto');
  });

  // Значение ключа - пустая строка: JSON.parse('') кидает исключение, и мы
  // приходим к дефолту через catch.
  test('в ключе settings пустая строка: отдаёт дефолты игры', () => {
    localStorage.setItem('settings', '');
    expect(readGameSetting('lang')).toBe('sys');
    expect(readGameSetting('theme')).toBe('auto');
  });

  // В Chrome с отключёнными cookies обращение к localStorage кидает
  // SecurityError; для нас это то же, что игра со своими дефолтами.
  test('localStorage недоступен: отдаёт дефолты игры', () => {
    jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError: access to localStorage is denied');
    });

    expect(readGameSetting('lang')).toBe('sys');
    expect(readGameSetting('theme')).toBe('auto');
  });

  // Дефолт подставляется на весь объект, а не по полю: игровой getSettings
  // читает разобранный объект напрямую и по отсутствующему полю отдаёт
  // undefined. Объекта без поля штатным путём не бывает - changeSettings
  // пишет его целиком, - но он появится, когда игра добавит новое поле в
  // дефолты: у существующих игроков этого поля в ключе не окажется.
  test('поля нет в объекте: отдаёт undefined, а не дефолт игры', () => {
    localStorage.setItem('settings', JSON.stringify({ theme: 'light' }));
    expect(readGameSetting('lang')).toBeUndefined();
    expect(readGameSetting('theme')).toBe('light');
  });

  // Набор значений темы задаёт игра, но своим значением она не ограничена:
  // сравнение с 'dark' в игре работает для любой строки. Подмена постороннего
  // значения дефолтом 'auto' увела бы нас в системную тему там, где игра
  // рисует светлую.
  test('тема вне набора значений игры: отдаёт значение как есть', () => {
    localStorage.setItem('settings', JSON.stringify({ theme: 'drak' }));
    expect(readGameSetting('theme')).toBe('drak');
  });

  test('поле лежит не строкой: отдаёт undefined', () => {
    localStorage.setItem('settings', JSON.stringify({ lang: 42, theme: null }));
    expect(readGameSetting('lang')).toBeUndefined();
    expect(readGameSetting('theme')).toBeUndefined();
  });

  // Игровой getJson подставляет дефолт только на null, поэтому массив и
  // строка доходят до чтения поля и дают undefined, а не дефолты.
  test('в settings лежит массив: отдаёт undefined', () => {
    localStorage.setItem('settings', JSON.stringify(['ru']));
    expect(readGameSetting('lang')).toBeUndefined();
  });

  test('в settings лежит строка: отдаёт undefined', () => {
    localStorage.setItem('settings', JSON.stringify('ru'));
    expect(readGameSetting('lang')).toBeUndefined();
  });

  test('в settings лежит null: отдаёт дефолты игры', () => {
    localStorage.setItem('settings', JSON.stringify(null));
    expect(readGameSetting('lang')).toBe('sys');
  });

  test('читает свежее значение при каждом вызове', () => {
    localStorage.setItem('settings', JSON.stringify({ lang: 'en' }));
    expect(readGameSetting('lang')).toBe('en');

    localStorage.setItem('settings', JSON.stringify({ lang: 'ru' }));
    expect(readGameSetting('lang')).toBe('ru');
  });
});

describe('isGameDarkTheme', () => {
  afterEach(() => {
    localStorage.clear();
    jest.restoreAllMocks();
  });

  // Игра разворачивает 'auto' через prefers-color-scheme, а дефолт темы -
  // именно 'auto', поэтому у игрока с тёмной системной темой игра тёмная,
  // хотя в настройках 'dark' не выбран.
  test('тема auto и тёмная системная: тёмная', () => {
    localStorage.setItem('settings', JSON.stringify({ theme: 'auto' }));
    stubPrefersColorSchemeDark(true);
    expect(isGameDarkTheme()).toBe(true);
  });

  test('тема auto и светлая системная: светлая', () => {
    localStorage.setItem('settings', JSON.stringify({ theme: 'auto' }));
    stubPrefersColorSchemeDark(false);
    expect(isGameDarkTheme()).toBe(false);
  });

  test('ключа settings нет и системная тёмная: тёмная (дефолт игры auto)', () => {
    stubPrefersColorSchemeDark(true);
    expect(isGameDarkTheme()).toBe(true);
  });

  test('явная тема dark: тёмная независимо от системной', () => {
    localStorage.setItem('settings', JSON.stringify({ theme: 'dark' }));
    stubPrefersColorSchemeDark(false);
    expect(isGameDarkTheme()).toBe(true);
  });

  test('явная тема light: светлая независимо от системной', () => {
    localStorage.setItem('settings', JSON.stringify({ theme: 'light' }));
    stubPrefersColorSchemeDark(true);
    expect(isGameDarkTheme()).toBe(false);
  });

  // Формула игры сравнивает с 'dark' любое значение, кроме 'auto', поэтому
  // посторонняя тема даёт светлый интерфейс, а не системный.
  test('тема вне набора значений игры и тёмная системная: светлая', () => {
    localStorage.setItem('settings', JSON.stringify({ theme: 'sepia' }));
    stubPrefersColorSchemeDark(true);
    expect(isGameDarkTheme()).toBe(false);
  });

  // Ключ есть, поля theme в нём нет: игровой getSettings отдаёт undefined,
  // сравнение с 'auto' и 'dark' не проходит, интерфейс светлый.
  test('поля theme нет в ключе и тёмная системная: светлая', () => {
    localStorage.setItem('settings', JSON.stringify({ lang: 'ru' }));
    stubPrefersColorSchemeDark(true);
    expect(isGameDarkTheme()).toBe(false);
  });

  // Функцию зовут из обработчика апгрейда базы избранного: исключение оттуда
  // убило бы транзакцию вместе с загрузкой избранного.
  test('отказ matchMedia: светлая, без исключения наружу', () => {
    jest.spyOn(window, 'matchMedia').mockImplementation(() => {
      throw new Error('SecurityError: matchMedia is not available');
    });

    expect(isGameDarkTheme()).toBe(false);
  });
});

describe('isGameCartoDbBaselayer', () => {
  afterEach(() => {
    localStorage.clear();
  });

  test('явная база cdb: CartoDB', () => {
    localStorage.setItem('settings', JSON.stringify({ base: 'cdb' }));
    expect(isGameCartoDbBaselayer()).toBe(true);
  });

  // Дефолт базы в игре - 'cdb', и у игрока, ни разу не заходившего в
  // настройки, ключа нет: подложка при этом всё равно CartoDB.
  test('ключа settings нет: CartoDB (дефолт игры)', () => {
    expect(isGameCartoDbBaselayer()).toBe(true);
  });

  test('явная база osm: не CartoDB', () => {
    localStorage.setItem('settings', JSON.stringify({ base: 'osm' }));
    expect(isGameCartoDbBaselayer()).toBe(false);
  });

  // Ключ есть, поля base в нём нет: игра берёт 'osm' (getSettings('base') ||
  // 'osm'), а не свой дефолт 'cdb'.
  test('поля base нет в ключе: не CartoDB', () => {
    localStorage.setItem('settings', JSON.stringify({ theme: 'dark' }));
    expect(isGameCartoDbBaselayer()).toBe(false);
  });
});
