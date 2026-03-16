import { getGameLocale, t } from './l10n';

describe('l10n', () => {
  afterEach(() => {
    localStorage.clear();
  });

  describe('getGameLocale', () => {
    test('returns "en" when no settings in localStorage', () => {
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
      const originalLanguage = navigator.language;
      Object.defineProperty(navigator, 'language', { value: 'ru-RU', configurable: true });
      expect(getGameLocale()).toBe('ru');
      Object.defineProperty(navigator, 'language', { value: originalLanguage, configurable: true });
    });

    test('returns "en" when lang is "sys" and browser locale is not Russian', () => {
      localStorage.setItem('settings', JSON.stringify({ lang: 'sys' }));
      const originalLanguage = navigator.language;
      Object.defineProperty(navigator, 'language', { value: 'en-US', configurable: true });
      expect(getGameLocale()).toBe('en');
      Object.defineProperty(navigator, 'language', { value: originalLanguage, configurable: true });
    });

    test('returns "en" when settings is invalid JSON', () => {
      localStorage.setItem('settings', 'not-json');
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
