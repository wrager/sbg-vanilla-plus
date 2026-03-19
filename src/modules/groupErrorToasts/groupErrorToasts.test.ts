import { groupErrorToasts } from './groupErrorToasts';

interface IMockToastOptions {
  text: string;
  className: string;
  selector: Element | null;
  id: number;
  callback: (() => void) | null;
  duration: number;
}

interface IMockToast {
  options: IMockToastOptions;
  toastElement: HTMLElement | null;
  showToast: jest.Mock;
  hideToast: jest.Mock;
}

interface IMockToastifyOptions {
  text?: string;
  className?: string;
  selector?: Element | null;
}

function createMockToastify(): jest.Mock<IMockToast, [IMockToastifyOptions]> {
  return jest.fn((options: IMockToastifyOptions) => {
    const toast: IMockToast = {
      options: {
        text: options.text ?? '',
        className: options.className ?? 'interaction-toast',
        selector: options.selector ?? null,
        id: Math.round(Math.random() * 1e5),
        callback: null,
        duration: 3000,
      },
      toastElement: null,
      showToast: jest.fn(() => {
        const element = document.createElement('div');
        element.className = 'toastify on';
        element.innerHTML = toast.options.text;
        const container = (toast.options.selector as HTMLElement | null) ?? document.body;
        container.appendChild(element);
        toast.toastElement = element;
      }),
      hideToast: jest.fn(),
    };
    return toast;
  });
}

function asMock(toast: ReturnType<typeof window.Toastify>): IMockToast {
  return toast as unknown as IMockToast;
}

function fireCallback(toast: ReturnType<typeof window.Toastify>): void {
  asMock(toast).options.callback?.();
}

describe('groupErrorToasts', () => {
  let mockToastify: jest.Mock<IMockToast, [IMockToastifyOptions]>;

  beforeEach(() => {
    mockToastify = createMockToastify();
    window.Toastify = mockToastify as unknown as typeof window.Toastify;
  });

  afterEach(async () => {
    await groupErrorToasts.disable();
    document.body.innerHTML = '';
  });

  test('non-error toasts pass through without deduplication', async () => {
    await groupErrorToasts.enable();
    const toast = window.Toastify({ text: 'loot acquired' });
    toast.options.className = 'interaction-toast';
    toast.showToast();

    const toast2 = window.Toastify({ text: 'loot acquired' });
    toast2.options.className = 'interaction-toast';
    toast2.showToast();

    expect(document.querySelectorAll('.toastify').length).toBe(2);
  });

  test('first error toast shows normally', async () => {
    await groupErrorToasts.enable();
    const toast = window.Toastify({ text: 'network error' });
    toast.options.className = 'error-toast';
    toast.showToast();

    expect(toast.options.text).toBe('network error');
    expect(document.querySelectorAll('.toastify').length).toBe(1);
  });

  test('duplicate error toast removes old element and shows new with counter', async () => {
    await groupErrorToasts.enable();

    const toast1 = window.Toastify({ text: 'network error' });
    toast1.options.className = 'error-toast';
    toast1.showToast();

    const toast2 = window.Toastify({ text: 'network error' });
    toast2.options.className = 'error-toast';
    toast2.showToast();

    expect(toast1.toastElement?.parentNode).toBeNull();
    expect(toast2.options.text).toBe('network error (×2)');
    expect(document.querySelectorAll('.toastify').length).toBe(1);
  });

  test('triple duplicate shows counter ×3', async () => {
    await groupErrorToasts.enable();

    const toast1 = window.Toastify({ text: 'out of range' });
    toast1.options.className = 'error-toast';
    toast1.showToast();

    const toast2 = window.Toastify({ text: 'out of range' });
    toast2.options.className = 'error-toast';
    toast2.showToast();

    const toast3 = window.Toastify({ text: 'out of range' });
    toast3.options.className = 'error-toast';
    toast3.showToast();

    expect(toast3.options.text).toBe('out of range (×3)');
    expect(document.querySelectorAll('.toastify').length).toBe(1);
  });

  test('different error texts are not deduplicated', async () => {
    await groupErrorToasts.enable();

    const toast1 = window.Toastify({ text: 'network error' });
    toast1.options.className = 'error-toast';
    toast1.showToast();

    const toast2 = window.Toastify({ text: 'out of range' });
    toast2.options.className = 'error-toast';
    toast2.showToast();

    expect(toast1.toastElement?.parentNode).toBe(document.body);
    expect(toast2.options.text).toBe('out of range');
    expect(document.querySelectorAll('.toastify').length).toBe(2);
  });

  test('same text in different containers are not deduplicated', async () => {
    await groupErrorToasts.enable();
    const container1 = document.createElement('div');
    container1.className = 'info';
    document.body.appendChild(container1);
    const container2 = document.createElement('div');
    container2.className = 'inventory';
    document.body.appendChild(container2);

    const toast1 = window.Toastify({ text: 'error', selector: container1 });
    toast1.options.className = 'error-toast';
    toast1.showToast();

    const toast2 = window.Toastify({ text: 'error', selector: container2 });
    toast2.options.className = 'error-toast';
    toast2.showToast();

    expect(toast1.toastElement?.parentNode).toBe(container1);
    expect(toast2.options.text).toBe('error');
  });

  test('after toast expires, next one shows without counter', async () => {
    await groupErrorToasts.enable();

    const toast1 = window.Toastify({ text: 'error' });
    toast1.options.className = 'error-toast';
    toast1.showToast();

    // Simulate toast expiration via callback
    fireCallback(toast1);

    const toast2 = window.Toastify({ text: 'error' });
    toast2.options.className = 'error-toast';
    toast2.showToast();

    expect(toast2.options.text).toBe('error');
  });

  test('async callback from old toast does not remove new toast from tracking', async () => {
    await groupErrorToasts.enable();

    const toast1 = window.Toastify({ text: 'error' });
    toast1.options.className = 'error-toast';
    toast1.showToast();

    const toast2 = window.Toastify({ text: 'error' });
    toast2.options.className = 'error-toast';
    toast2.showToast();

    expect(toast2.options.text).toBe('error (×2)');

    // Simulate toast1's callback firing asynchronously (after hideToast animation)
    fireCallback(toast1);

    // Toast3 should still group with toast2
    const toast3 = window.Toastify({ text: 'error' });
    toast3.options.className = 'error-toast';
    toast3.showToast();

    expect(toast3.options.text).toBe('error (×3)');
    expect(document.querySelectorAll('.toastify').length).toBe(1);
  });

  test('old element is removed instantly without hideToast animation', async () => {
    await groupErrorToasts.enable();

    const toast1 = window.Toastify({ text: 'error' });
    toast1.options.className = 'error-toast';
    toast1.showToast();

    const oldElement = toast1.toastElement;
    expect(oldElement?.parentNode).toBe(document.body);

    const toast2 = window.Toastify({ text: 'error' });
    toast2.options.className = 'error-toast';
    toast2.showToast();

    // Old element removed from DOM immediately (no hideToast call)
    expect(oldElement?.parentNode).toBeNull();
    expect(asMock(toast1).hideToast).not.toHaveBeenCalled();
  });

  test('disable restores original Toastify', async () => {
    await groupErrorToasts.enable();
    await groupErrorToasts.disable();

    expect(window.Toastify).toBe(mockToastify);
  });

  test('original callback is preserved and called', async () => {
    await groupErrorToasts.enable();

    const toast = window.Toastify({ text: 'error' });
    toast.options.className = 'error-toast';
    const originalCallback = jest.fn();
    toast.options.callback = originalCallback;
    toast.showToast();

    // Simulate toast expiration
    fireCallback(toast);

    expect(originalCallback).toHaveBeenCalled();
  });

  test('old toast callback fires on deduplication for popup_toasts cleanup', async () => {
    await groupErrorToasts.enable();

    const toast1 = window.Toastify({ text: 'error' });
    toast1.options.className = 'error-toast';
    const gameCallback = jest.fn();
    toast1.options.callback = gameCallback;
    toast1.showToast();

    const toast2 = window.Toastify({ text: 'error' });
    toast2.options.className = 'error-toast';
    toast2.showToast();

    // Old toast's callback should have been called for cleanup
    expect(gameCallback).toHaveBeenCalled();
  });
});
