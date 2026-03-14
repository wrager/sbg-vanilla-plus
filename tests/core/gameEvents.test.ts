import { observeElement } from '../../src/core/gameEvents';

describe('observeElement', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('returns a MutationObserver', () => {
    const observer = observeElement('.target', jest.fn());
    expect(observer).toBeInstanceOf(MutationObserver);
    observer.disconnect();
  });

  test('calls callback when element appears in DOM', async () => {
    const callback = jest.fn();
    observeElement('.target', callback);

    const el = document.createElement('div');
    el.className = 'target';
    document.body.appendChild(el);

    await Promise.resolve();
    expect(callback).toHaveBeenCalledWith(el);
  });

  test('does not call callback when unrelated element appears', async () => {
    const callback = jest.fn();
    observeElement('.target', callback);

    const el = document.createElement('div');
    el.className = 'other';
    document.body.appendChild(el);

    await Promise.resolve();
    expect(callback).not.toHaveBeenCalled();
  });

  test('uses custom root when provided', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);

    const callback = jest.fn();
    observeElement('.target', callback, root);

    const el = document.createElement('div');
    el.className = 'target';
    root.appendChild(el);

    await Promise.resolve();
    expect(callback).toHaveBeenCalled();
  });
});
