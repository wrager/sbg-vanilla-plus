import { getGameLocale, t } from './l10n';

/** Подменяет navigator.language на время теста. Возвращает функцию восстановления. */
function setBrowserLanguage(language: string): () => void {
  const original = navigator.language;
  Object.defineProperty(navigator, 'language', { value: language, configurable: true });
  return () => {
    Object.defineProperty(navigator, 'language', { value: original, configurable: true });
  };
}

/** Делает чтение navigator.language бросающим. Возвращает функцию восстановления. */
function breakBrowserLanguage(): () => void {
  const original = navigator.language;
  Object.defineProperty(navigator, 'language', {
    get: (): string => {
      throw new Error('navigator.language is unavailable');
    },
    configurable: true,
  });
  return () => {
    Object.defineProperty(navigator, 'language', { value: original, configurable: true });
  };
}

describe('l10n', () => {
  afterEach(() => {
    localStorage.clear();
  });

  describe('getGameLocale', () => {
    // SBG 0.7.0 больше не создаёт ключ settings при первом запуске: у игрока,
    // ни разу не менявшего настройки, ключа нет, а игра показывает интерфейс
    // по системной локали (дефолт lang: 'sys'). Раньше мы в этом случае
    // отдавали 'en', и русский игрок видел англоязычный SVP поверх русской игры.
    test('no settings in localStorage: falls back to the game default lang "sys" (ru browser)', () => {
      const restore = setBrowserLanguage('ru-RU');
      expect(getGameLocale()).toBe('ru');
      restore();
    });

    test('no settings in localStorage: falls back to the game default lang "sys" (en browser)', () => {
      const restore = setBrowserLanguage('en-US');
      expect(getGameLocale()).toBe('en');
      restore();
    });

    test('returns "ru" when game language is ru', () => {
      localStorage.setItem('settings', JSON.stringify({ lang: 'ru' }));
      expect(getGameLocale()).toBe('ru');
    });

    test('returns "en" when game language is en', () => {
      localStorage.setItem('settings', JSON.stringify({ lang: 'en' }));
      expect(getGameLocale()).toBe('en');
    });

    test('returns "en" for unknown language', () => {
      localStorage.setItem('settings', JSON.stringify({ lang: 'de' }));
      expect(getGameLocale()).toBe('en');
    });

    test('returns "ru" when lang is "sys" and browser locale is Russian', () => {
      localStorage.setItem('settings', JSON.stringify({ lang: 'sys' }));
      const restore = setBrowserLanguage('ru-RU');
      expect(getGameLocale()).toBe('ru');
      restore();
    });

    test('returns "en" when lang is "sys" and browser locale is not Russian', () => {
      localStorage.setItem('settings', JSON.stringify({ lang: 'sys' }));
      const restore = setBrowserLanguage('en-US');
      expect(getGameLocale()).toBe('en');
      restore();
    });

    test('invalid JSON in settings: falls back to the game default lang "sys"', () => {
      localStorage.setItem('settings', 'not-json');
      const restore = setBrowserLanguage('ru-RU');
      expect(getGameLocale()).toBe('ru');
      restore();
    });

    test('settings without lang field: falls back to the game default lang "sys"', () => {
      localStorage.setItem('settings', JSON.stringify({ theme: 'dark' }));
      const restore = setBrowserLanguage('ru-RU');
      expect(getGameLocale()).toBe('ru');
      restore();
    });

    // Дефолт игры 'sys' приводит к чтению navigator.language всех, кто не
    // менял язык в настройках, поэтому отказ чтения не должен ронять t():
    // на ней держатся имена модулей, тосты и панель настроек.
    test('reading navigator.language throws: falls back to "en"', () => {
      localStorage.setItem('settings', JSON.stringify({ lang: 'sys' }));
      const restore = breakBrowserLanguage();
      expect(getGameLocale()).toBe('en');
      restore();
    });

    test('explicit non-Russian lang wins over Russian browser locale', () => {
      localStorage.setItem('settings', JSON.stringify({ lang: 'en' }));
      const restore = setBrowserLanguage('ru-RU');
      expect(getGameLocale()).toBe('en');
      restore();
    });
  });

  describe('t', () => {
    test('returns english string by default', () => {
      expect(t({ en: 'Hello', ru: 'Привет' })).toBe('Hello');
    });

    test('returns russian string when locale is ru', () => {
      localStorage.setItem('settings', JSON.stringify({ lang: 'ru' }));
      expect(t({ en: 'Hello', ru: 'Привет' })).toBe('Привет');
    });
  });
});
