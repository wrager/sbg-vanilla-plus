import { getGameLocale, t } from './l10n';

// Подмены navigator.language снимаются в afterEach, а не последней строкой
// теста: упавший ассерт пропускает восстановление, подменённое значение течёт
// во все последующие тесты файла, и один настоящий провал даёт каскад
// посторонних.
let browserLanguageStubbed = false;

/**
 * Подменяет navigator.language на время теста. Значение кладётся собственным
 * property на navigator, поверх языка, зафиксированного на Navigator.prototype
 * в jestPolyfills.
 */
function stubBrowserLanguage(descriptor: PropertyDescriptor): void {
  Object.defineProperty(navigator, 'language', { ...descriptor, configurable: true });
  browserLanguageStubbed = true;
}

function setBrowserLanguage(language: string): void {
  stubBrowserLanguage({ value: language });
}

/** Делает чтение navigator.language бросающим. */
function breakBrowserLanguage(): void {
  stubBrowserLanguage({
    get: (): string => {
      throw new Error('navigator.language is unavailable');
    },
  });
}

/** Снимает подмену: собственное property удаляется, остаётся язык из jestPolyfills. */
function restoreBrowserLanguage(): void {
  if (!browserLanguageStubbed) return;
  Reflect.deleteProperty(navigator, 'language');
  browserLanguageStubbed = false;
}

describe('l10n', () => {
  afterEach(() => {
    localStorage.clear();
    restoreBrowserLanguage();
  });

  describe('getGameLocale', () => {
    // SBG 0.7.0 больше не создаёт ключ settings при первом запуске: у игрока,
    // ни разу не менявшего настройки, ключа нет, а игра показывает интерфейс
    // по системной локали (дефолт lang: 'sys'). Раньше мы в этом случае
    // отдавали 'en', и русский игрок видел англоязычный SVP поверх русской игры.
    test('no settings in localStorage: falls back to the game default lang "sys" (ru browser)', () => {
      setBrowserLanguage('ru-RU');
      expect(getGameLocale()).toBe('ru');
    });

    test('no settings in localStorage: falls back to the game default lang "sys" (en browser)', () => {
      setBrowserLanguage('en-US');
      expect(getGameLocale()).toBe('en');
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
      setBrowserLanguage('ru-RU');
      expect(getGameLocale()).toBe('ru');
    });

    test('returns "en" when lang is "sys" and browser locale is not Russian', () => {
      localStorage.setItem('settings', JSON.stringify({ lang: 'sys' }));
      setBrowserLanguage('en-US');
      expect(getGameLocale()).toBe('en');
    });

    test('invalid JSON in settings: falls back to the game default lang "sys"', () => {
      localStorage.setItem('settings', 'not-json');
      setBrowserLanguage('ru-RU');
      expect(getGameLocale()).toBe('ru');
    });

    // Ключ есть, поля lang в нём нет: игра в этом случае не берёт системную
    // локаль, а уходит в fallbackLng своего i18next. Системную локаль читаем
    // только при явном 'sys' и при отсутствующем ключе.
    test('settings without lang field: returns "en" even on a Russian browser', () => {
      localStorage.setItem('settings', JSON.stringify({ theme: 'dark' }));
      setBrowserLanguage('ru-RU');
      expect(getGameLocale()).toBe('en');
    });

    // Дефолт игры 'sys' приводит к чтению navigator.language всех, кто не
    // менял язык в настройках, поэтому отказ чтения не должен ронять t():
    // на ней держатся имена модулей, тосты и панель настроек.
    test('reading navigator.language throws: falls back to "en"', () => {
      localStorage.setItem('settings', JSON.stringify({ lang: 'sys' }));
      breakBrowserLanguage();
      expect(getGameLocale()).toBe('en');
    });

    test('explicit non-Russian lang wins over Russian browser locale', () => {
      localStorage.setItem('settings', JSON.stringify({ lang: 'en' }));
      setBrowserLanguage('ru-RU');
      expect(getGameLocale()).toBe('en');
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
