import { isSbgScout } from './host';

describe('isSbgScout', () => {
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

  test('возвращает true, если userAgent содержит SbgScout/', () => {
    setUserAgent('Mozilla/5.0 (Linux; Android 13) SbgScout/1.2.3');
    expect(isSbgScout()).toBe(true);
  });

  test('возвращает false для обычного браузера', () => {
    setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0');
    expect(isSbgScout()).toBe(false);
  });

  test('возвращает false, если подстрока без слэша (SbgScout без версии)', () => {
    setUserAgent('Mozilla/5.0 SbgScout');
    expect(isSbgScout()).toBe(false);
  });
});
