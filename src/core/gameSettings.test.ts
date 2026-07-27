import { readGameSetting } from './gameSettings';

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

  test('поля нет в объекте: отдаёт дефолт игры для этого поля', () => {
    localStorage.setItem('settings', JSON.stringify({ theme: 'light' }));
    expect(readGameSetting('lang')).toBe('sys');
    expect(readGameSetting('theme')).toBe('light');
  });

  // Набор значений темы фиксирован игрой ('auto' / 'light' / 'dark'), поэтому
  // постороннее значение (правка ключа руками, смена набора в игре) для нас
  // равносильно отсутствию настройки.
  test('тема вне набора значений игры: отдаёт дефолт игры', () => {
    localStorage.setItem('settings', JSON.stringify({ theme: 'drak' }));
    expect(readGameSetting('theme')).toBe('auto');
  });

  test('поле лежит не строкой: отдаёт дефолт игры', () => {
    localStorage.setItem('settings', JSON.stringify({ lang: 42, theme: null }));
    expect(readGameSetting('lang')).toBe('sys');
    expect(readGameSetting('theme')).toBe('auto');
  });

  test('в settings лежит массив: отдаёт дефолты игры', () => {
    localStorage.setItem('settings', JSON.stringify(['ru']));
    expect(readGameSetting('lang')).toBe('sys');
  });

  test('в settings лежит строка: отдаёт дефолты игры', () => {
    localStorage.setItem('settings', JSON.stringify('ru'));
    expect(readGameSetting('lang')).toBe('sys');
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
