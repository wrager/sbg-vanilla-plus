import { injectStyles, observeText, removeStyles, $, $$, waitForElement } from './dom';

describe('dom', () => {
  afterEach(() => {
    // Стиль ложится в head или, пока тот не распарсен, в documentElement -
    // чистка одного head оставляла бы стили второго случая следующим тестам.
    for (const style of $$('style[id^="svp-"]')) style.remove();
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

  test('injectStyles falls back to documentElement when head is not parsed yet', () => {
    const head = document.head;
    head.remove();

    injectStyles('body { color: red; }', 'test');

    const style = document.getElementById('svp-test');
    expect(style?.parentElement).toBe(document.documentElement);

    document.documentElement.prepend(head);
  });

  describe('injectStyles before the root element exists', () => {
    const flushMutations = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

    // Самый ранний document-start: парсер ещё не создал <html>, вставлять
    // стиль некуда. detachRoot воспроизводит это состояние, restoreRoot
    // возвращает корневой элемент так же, как это делает парсер.
    let detachedRoot: HTMLElement | null = null;

    const detachRoot = (): void => {
      detachedRoot = document.documentElement;
      detachedRoot.remove();
    };

    const restoreRoot = async (): Promise<void> => {
      if (!detachedRoot) return;
      document.appendChild(detachedRoot);
      detachedRoot = null;
      await flushMutations();
    };

    // Возврат корня и в afterEach: упавший тест иначе оставит документ без
    // <html>, и следующие тесты падают каскадом на не связанном с ними коде.
    afterEach(async () => {
      await restoreRoot();
    });

    test('injects the style once the root element appears', async () => {
      detachRoot();

      injectStyles('body { color: red; }', 'test');
      expect(document.getElementById('svp-test')).toBeNull();

      await restoreRoot();

      const style = document.getElementById('svp-test');
      expect(style?.textContent).toBe('body { color: red; }');
      expect(style?.isConnected).toBe(true);
    });

    test('does not duplicate the style on repeated call', async () => {
      detachRoot();

      injectStyles('body { color: red; }', 'test');
      injectStyles('body { color: blue; }', 'test');

      await restoreRoot();

      const styles = document.querySelectorAll('#svp-test');
      expect(styles.length).toBe(1);
      expect(styles[0].textContent).toBe('body { color: blue; }');
    });

    test('removeStyles cancels the pending injection', async () => {
      detachRoot();

      injectStyles('body { color: red; }', 'test');
      removeStyles('test');

      await restoreRoot();

      expect(document.getElementById('svp-test')).toBeNull();
    });
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

  describe('observeText', () => {
    const flushMutations = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

    test('callback срабатывает при смене textContent у единичной цели', async () => {
      const span = document.createElement('span');
      span.textContent = 'before';
      document.body.appendChild(span);

      const callback = jest.fn();
      const observer = observeText(span, callback);

      span.textContent = 'after';
      await flushMutations();

      expect(callback).toHaveBeenCalled();
      observer.disconnect();
    });

    test('callback срабатывает при смене текста у любой из целей в массиве', async () => {
      const a = document.createElement('span');
      const b = document.createElement('span');
      document.body.append(a, b);

      const callback = jest.fn();
      const observer = observeText([a, b], callback);

      a.textContent = 'x';
      await flushMutations();
      const callsAfterA = callback.mock.calls.length;
      expect(callsAfterA).toBeGreaterThan(0);

      b.textContent = 'y';
      await flushMutations();
      expect(callback.mock.calls.length).toBeGreaterThan(callsAfterA);

      observer.disconnect();
    });

    test('disconnect() останавливает наблюдение', async () => {
      const span = document.createElement('span');
      document.body.appendChild(span);

      const callback = jest.fn();
      const observer = observeText(span, callback);
      observer.disconnect();

      span.textContent = 'after';
      await flushMutations();

      expect(callback).not.toHaveBeenCalled();
    });
  });
});
