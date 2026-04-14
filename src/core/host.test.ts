import { isModuleDisallowedInCurrentHost, isSbgScout } from './host';

const SCOUT_UA = 'Mozilla/5.0 (Linux; Android 13) SbgScout/1.2.3';
const BROWSER_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0';

describe('host', () => {
  const originalUserAgent = navigator.userAgent;

  afterEach(() => {
    Object.defineProperty(navigator, 'userAgent', {
      value: originalUserAgent,
      configurable: true,
    });
  });

  function setUserAgent(value: string): void {
    Object.defineProperty(navigator, 'userAgent', { value, configurable: true });
  }

  describe('isSbgScout', () => {
    test('возвращает true, если userAgent содержит SbgScout/', () => {
      setUserAgent(SCOUT_UA);
      expect(isSbgScout()).toBe(true);
    });

    test('возвращает false для обычного браузера', () => {
      setUserAgent(BROWSER_UA);
      expect(isSbgScout()).toBe(false);
    });

    test('возвращает false, если подстрока без слэша (SbgScout без версии)', () => {
      setUserAgent('Mozilla/5.0 SbgScout');
      expect(isSbgScout()).toBe(false);
    });
  });

  describe('isModuleDisallowedInCurrentHost', () => {
    test('keepScreenOn в Scout — запрещён', () => {
      setUserAgent(SCOUT_UA);
      expect(isModuleDisallowedInCurrentHost('keepScreenOn')).toBe(true);
    });

    test('keepScreenOn в браузере — разрешён', () => {
      setUserAgent(BROWSER_UA);
      expect(isModuleDisallowedInCurrentHost('keepScreenOn')).toBe(false);
    });

    test('другой модуль в Scout — разрешён', () => {
      setUserAgent(SCOUT_UA);
      expect(isModuleDisallowedInCurrentHost('enhancedMainScreen')).toBe(false);
    });

    test('другой модуль в браузере — разрешён', () => {
      setUserAgent(BROWSER_UA);
      expect(isModuleDisallowedInCurrentHost('enhancedMainScreen')).toBe(false);
    });
  });
});
