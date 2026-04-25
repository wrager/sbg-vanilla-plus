import { showToast } from './toast';

describe('showToast', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('mounts a .svp-toast in body with the given message', () => {
    showToast('hello');
    const toast = document.querySelector('.svp-toast');
    expect(toast).not.toBeNull();
    expect(toast?.textContent).toBe('hello');
  });

  test('auto-hides after duration: adds svp-toast-hide, removes from DOM on transitionend', () => {
    showToast('bye', 3000);
    const toast = document.querySelector<HTMLDivElement>('.svp-toast');
    expect(toast?.classList.contains('svp-toast-hide')).toBe(false);

    jest.advanceTimersByTime(3000);
    expect(toast?.classList.contains('svp-toast-hide')).toBe(true);
    expect(document.querySelector('.svp-toast')).not.toBeNull(); // ещё в DOM до transitionend

    toast?.dispatchEvent(new Event('transitionend'));
    expect(document.querySelector('.svp-toast')).toBeNull();
  });

  test('click dismisses toast immediately (before timer fires)', () => {
    showToast('click me', 3000);
    const toast = document.querySelector<HTMLDivElement>('.svp-toast');
    expect(toast?.classList.contains('svp-toast-hide')).toBe(false);

    toast?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(toast?.classList.contains('svp-toast-hide')).toBe(true);

    toast?.dispatchEvent(new Event('transitionend'));
    expect(document.querySelector('.svp-toast')).toBeNull();
  });

  test('click after auto-hide started does not remove toast twice', () => {
    showToast('idempotent', 3000);
    const toast = document.querySelector<HTMLDivElement>('.svp-toast');

    jest.advanceTimersByTime(3000);
    expect(toast?.classList.contains('svp-toast-hide')).toBe(true);

    // Повторный клик после старта авто-скрытия — no-op (hide-класс уже стоит).
    toast?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(toast?.classList.contains('svp-toast-hide')).toBe(true);

    toast?.dispatchEvent(new Event('transitionend'));
    expect(document.querySelector('.svp-toast')).toBeNull();
  });
});
