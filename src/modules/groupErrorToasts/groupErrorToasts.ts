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

      if (existing) {
        const newCount = existing.count + 1;
        existing.instance.hideToast();
        toast.options.text = `${existing.originalText} (×${newCount})`;
        tracked.set(key, {
          instance: toast,
          count: newCount,
          originalText: existing.originalText,
        });
      } else {
        tracked.set(key, { instance: toast, count: 1, originalText: text });
      }

      const originalCallback = toast.options.callback;
      toast.options.callback = () => {
        tracked.delete(key);
        originalCallback?.();
      };

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
  category: 'fix',
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
