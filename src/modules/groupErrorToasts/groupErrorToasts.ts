import type { IFeatureModule } from '../../core/moduleRegistry';

const MODULE_ID = 'groupErrorToasts';
const ERROR_TOAST_CLASS = 'error-toast';

interface IToastifyOptions {
  text: string;
  className: string;
  selector: Element | null;
  id: number;
  duration: number;
  callback: (() => void) | null;
  onClick: (() => void) | null;
  gravity: string;
  position: string;
  escapeMarkup: boolean;
}

interface IToastifyInstance {
  options: IToastifyOptions;
  toastElement: HTMLElement | null;
  showToast(): void;
  hideToast(): void;
}

type ToastifyFactory = (options: Partial<IToastifyOptions>) => IToastifyInstance;

interface ITrackedToast {
  instance: IToastifyInstance;
  count: number;
  originalText: string;
}

interface IToastElement extends HTMLElement {
  timeOutValue?: ReturnType<typeof setTimeout>;
}

declare global {
  interface Window {
    Toastify: ToastifyFactory;
  }
}

let originalToastify: ToastifyFactory | null = null;
let activeErrorToasts: Map<string, ITrackedToast> | null = null;

function getContainerIdentity(selector: Element | null): string {
  if (!selector) return 'body';
  return selector.className || 'unknown';
}

function getDeduplicationKey(text: string, selector: Element | null): string {
  return `${text}::${getContainerIdentity(selector)}`;
}

function removeToastElementImmediately(instance: IToastifyInstance): void {
  const element = instance.toastElement as IToastElement | null;
  if (!element) return;

  if (element.timeOutValue) {
    clearTimeout(element.timeOutValue);
  }
  element.remove();
}

function wrapCallback(
  toast: IToastifyInstance,
  key: string,
  tracked: Map<string, ITrackedToast>,
): void {
  const originalCallback = toast.options.callback;
  toast.options.callback = () => {
    if (tracked.get(key)?.instance === toast) {
      tracked.delete(key);
    }
    originalCallback?.();
  };
}

function createToastifyWrapper(
  original: ToastifyFactory,
  tracked: Map<string, ITrackedToast>,
): ToastifyFactory {
  const wrapper = function (options: Partial<IToastifyOptions>): IToastifyInstance {
    const toast = original(options);
    const originalShowToast = toast.showToast.bind(toast);

    toast.showToast = function () {
      if (toast.options.className !== ERROR_TOAST_CLASS) {
        originalShowToast();
        return;
      }

      const text = toast.options.text;
      const key = getDeduplicationKey(text, toast.options.selector);
      const existing = tracked.get(key);

      if (existing?.instance.toastElement?.parentNode) {
        const newCount = existing.count + 1;
        toast.options.text = `${existing.originalText} (×${newCount})`;

        // Update tracking before firing old callback
        tracked.set(key, {
          instance: toast,
          count: newCount,
          originalText: existing.originalText,
        });

        // Remove old element instantly (no fade-out animation)
        // and fire its callback for popup_toasts cleanup
        removeToastElementImmediately(existing.instance);
        existing.instance.options.callback?.();

        wrapCallback(toast, key, tracked);
        originalShowToast();
        return;
      }

      tracked.set(key, { instance: toast, count: 1, originalText: text });
      wrapCallback(toast, key, tracked);
      originalShowToast();
    };

    return toast;
  };

  Object.assign(wrapper, original);
  return wrapper;
}

export const groupErrorToasts: IFeatureModule = {
  id: MODULE_ID,
  name: { en: 'Group Error Toasts', ru: 'Группировка тостов ошибок' },
  description: {
    en: 'Groups identical error toasts into one with a counter instead of stacking',
    ru: 'Группирует одинаковые тосты ошибок в один со счётчиком вместо накопления',
  },
  defaultEnabled: true,
  category: 'ui',
  init() {},
  enable() {
    originalToastify = window.Toastify;
    activeErrorToasts = new Map();
    window.Toastify = createToastifyWrapper(originalToastify, activeErrorToasts);
  },
  disable() {
    if (originalToastify) {
      window.Toastify = originalToastify;
      originalToastify = null;
    }
    activeErrorToasts = null;
  },
};
