import { groupErrorToasts } from './groupErrorToasts';

interface IMockToast {
  options: {
    text: string;
    className: string;
    selector: Element | null;
    id: number;
    callback: (() => void) | null;
  };
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
      },
      showToast: jest.fn(),
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
  });

  test('non-error toasts pass through without deduplication', async () => {
    await groupErrorToasts.enable();
    const toast = window.Toastify({ text: 'loot acquired' });
    toast.options.className = 'interaction-toast';
    toast.showToast();

    const toast2 = window.Toastify({ text: 'loot acquired' });
    toast2.options.className = 'interaction-toast';
    toast2.showToast();

    expect(asMock(toast).hideToast).not.toHaveBeenCalled();
  });

  test('first error toast shows normally', async () => {
    await groupErrorToasts.enable();
    const toast = window.Toastify({ text: 'network error' });
    toast.options.className = 'error-toast';
    toast.showToast();

    expect(toast.options.text).toBe('network error');
  });

  test('duplicate error toast hides previous and shows new with counter', async () => {
    await groupErrorToasts.enable();

    const toast1 = window.Toastify({ text: 'network error' });
    toast1.options.className = 'error-toast';
    toast1.showToast();

    const toast2 = window.Toastify({ text: 'network error' });
    toast2.options.className = 'error-toast';
    toast2.showToast();

    expect(asMock(toast1).hideToast).toHaveBeenCalled();
    expect(toast2.options.text).toBe('network error (×2)');
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

    expect(asMock(toast1).hideToast).toHaveBeenCalled();
    expect(asMock(toast2).hideToast).toHaveBeenCalled();
    expect(toast3.options.text).toBe('out of range (×3)');
  });

  test('different error texts are not deduplicated', async () => {
    await groupErrorToasts.enable();

    const toast1 = window.Toastify({ text: 'network error' });
    toast1.options.className = 'error-toast';
    toast1.showToast();

    const toast2 = window.Toastify({ text: 'out of range' });
    toast2.options.className = 'error-toast';
    toast2.showToast();

    expect(asMock(toast1).hideToast).not.toHaveBeenCalled();
    expect(toast2.options.text).toBe('out of range');
  });

  test('same text in different containers are not deduplicated', async () => {
    await groupErrorToasts.enable();
    const container1 = document.createElement('div');
    container1.className = 'info';
    const container2 = document.createElement('div');
    container2.className = 'inventory';

    const toast1 = window.Toastify({ text: 'error', selector: container1 });
    toast1.options.className = 'error-toast';
    toast1.showToast();

    const toast2 = window.Toastify({ text: 'error', selector: container2 });
    toast2.options.className = 'error-toast';
    toast2.showToast();

    expect(asMock(toast1).hideToast).not.toHaveBeenCalled();
    expect(toast2.options.text).toBe('error');
  });

  test('after toast expires, next one shows without hiding', async () => {
    await groupErrorToasts.enable();

    const toast1 = window.Toastify({ text: 'error' });
    toast1.options.className = 'error-toast';
    toast1.showToast();

    // Simulate toast expiration via callback
    fireCallback(toast1);

    const toast2 = window.Toastify({ text: 'error' });
    toast2.options.className = 'error-toast';
    toast2.showToast();

    expect(asMock(toast1).hideToast).not.toHaveBeenCalled();
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

    // Simulate toast1's callback firing asynchronously after hideToast animation
    fireCallback(toast1);

    // Toast3 should still group with toast2 despite toast1's late callback
    const toast3 = window.Toastify({ text: 'error' });
    toast3.options.className = 'error-toast';
    toast3.showToast();

    expect(asMock(toast2).hideToast).toHaveBeenCalled();
    expect(toast3.options.text).toBe('error (×3)');
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
});
