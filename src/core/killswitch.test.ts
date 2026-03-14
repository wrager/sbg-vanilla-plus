import { isDisabled } from './killswitch';

describe('killswitch', () => {
  beforeEach(() => {
    sessionStorage.clear();
    Object.defineProperty(window, 'location', {
      writable: true,
      value: { hash: '' },
    });
  });

  test('returns false when no hash and no sessionStorage', () => {
    expect(isDisabled()).toBe(false);
  });

  test('hash #svp-disabled=1 sets sessionStorage and returns true', () => {
    window.location.hash = '#svp-disabled=1';
    expect(isDisabled()).toBe(true);
    expect(sessionStorage.getItem('svp_disabled')).toBe('1');
  });

  test('hash #svp-disabled=0 clears sessionStorage and returns false', () => {
    sessionStorage.setItem('svp_disabled', '1');
    window.location.hash = '#svp-disabled=0';
    expect(isDisabled()).toBe(false);
    expect(sessionStorage.getItem('svp_disabled')).toBeNull();
  });

  test('returns true from sessionStorage after redirect (no hash)', () => {
    sessionStorage.setItem('svp_disabled', '1');
    expect(isDisabled()).toBe(true);
  });

  test('works with svp-disabled as non-first hash param', () => {
    window.location.hash = '#other=foo&svp-disabled=1';
    expect(isDisabled()).toBe(true);
  });
});
