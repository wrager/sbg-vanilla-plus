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
  showToast(): void;
  hideToast: jest.Mock;
}

function setupMockToastify(): void {
  const proto = {
    showToast(this: IMockToast) {
      const element = document.createElement('div');
      element.className = 'toastify on';
      element.innerHTML = this.options.text;
      const container = (this.options.selector as HTMLElement | null) ?? document.body;
      container.appendChild(element);
      this.toastElement = element;
    },
    hideToast: jest.fn(),
  };

  const factory = function (options: Partial<IMockToastOptions>): IMockToast {
    const toast: IMockToast = Object.create(proto) as IMockToast;
    toast.options = {
      text: options.text ?? '',
      className: options.className ?? 'interaction-toast',
      selector: options.selector ?? null,
      id: Math.round(Math.random() * 1e5),
      callback: null,
      duration: 3000,
    };
    toast.toastElement = null;
    toast.hideToast = jest.fn();
    return toast;
  };
  factory.prototype = proto;

  window.Toastify = factory as unknown as typeof window.Toastify;
}

function fireCallback(toast: ReturnType<typeof window.Toastify>): void {
  (toast as unknown as IMockToast).options.callback?.();
}

describe('groupErrorToasts', () => {
  beforeEach(() => {
    setupMockToastify();
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

    fireCallback(toast1);

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

    expect(oldElement?.parentNode).toBeNull();
    expect((toast1 as unknown as IMockToast).hideToast).not.toHaveBeenCalled();
  });

  test('disable restores original showToast', async () => {
    const originalShowToast = window.Toastify.prototype.showToast;
    await groupErrorToasts.enable();

    expect(window.Toastify.prototype.showToast).not.toBe(originalShowToast);

    await groupErrorToasts.disable();

    expect(window.Toastify.prototype.showToast).toBe(originalShowToast);
  });

  test('original callback is preserved and called', async () => {
    await groupErrorToasts.enable();

    const toast = window.Toastify({ text: 'error' });
    toast.options.className = 'error-toast';
    const originalCallback = jest.fn();
    toast.options.callback = originalCallback;
    toast.showToast();

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

    expect(gameCallback).toHaveBeenCalled();
  });
});
