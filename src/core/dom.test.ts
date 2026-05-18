import { injectStyles, removeStyles, $, $$, waitForElement } from './dom';

describe('dom', () => {
  afterEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '';
  });

  test('injectStyles adds a style element to head', () => {
    injectStyles('body { color: red; }', 'test');

    const style = document.getElementById('svp-test');
    expect(style).not.toBeNull();
    expect(style?.tagName).toBe('STYLE');
    expect(style?.textContent).toBe('body { color: red; }');
  });

  test('injectStyles replaces existing style with same id', () => {
    injectStyles('body { color: red; }', 'test');
    injectStyles('body { color: blue; }', 'test');

    const styles = document.querySelectorAll('#svp-test');
    expect(styles.length).toBe(1);
    expect(styles[0].textContent).toBe('body { color: blue; }');
  });

  test('removeStyles removes the style element', () => {
    injectStyles('body { color: red; }', 'test');
    removeStyles('test');

    expect(document.getElementById('svp-test')).toBeNull();
  });

  test('$ returns first matching element', () => {
    document.body.innerHTML = '<div class="a"></div><div class="a"></div>';
    expect($('.a')).toBe(document.body.querySelector('.a'));
  });

  test('$$ returns all matching elements', () => {
    document.body.innerHTML = '<div class="a"></div><div class="a"></div>';
    expect($$('.a').length).toBe(2);
  });

  describe('waitForElement', () => {
    test('resolves immediately when element already exists', async () => {
      document.body.innerHTML = '<div class="target"></div>';
      const el = await waitForElement('.target');
      expect(el.className).toBe('target');
    });

    test('resolves when element appears after call', async () => {
      const promise = waitForElement('.late');
      const el = document.createElement('div');
      el.className = 'late';
      document.body.appendChild(el);
      expect(await promise).toBe(el);
    });

    test('rejects after timeout if element never appears', async () => {
      jest.useFakeTimers();
      const promise = waitForElement('.never', 1000);
      jest.advanceTimersByTime(1001);
      await expect(promise).rejects.toThrow();
      jest.useRealTimers();
    });

    test('rejects immediately when signal is already aborted', async () => {
      const controller = new AbortController();
      controller.abort();
      await expect(waitForElement('.late', 10_000, controller.signal)).rejects.toThrow(/aborted/i);
    });

    test('rejects with AbortError when signal aborts before element appears', async () => {
      const controller = new AbortController();
      const promise = waitForElement('.never-appears', 10_000, controller.signal);
      controller.abort();
      await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    });

    test('после abort появление элемента не вызывает resolve', async () => {
      const controller = new AbortController();
      const promise = waitForElement('.late-after-abort', 10_000, controller.signal);
      controller.abort();
      await expect(promise).rejects.toThrow();

      const el = document.createElement('div');
      el.className = 'late-after-abort';
      document.body.appendChild(el);
      // Микротасков для MutationObserver достаточно, чтобы убедиться: повторного
      // resolve не происходит (это бы привело к unhandled rejection / двойному
      // settle Promise).
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  });
});
