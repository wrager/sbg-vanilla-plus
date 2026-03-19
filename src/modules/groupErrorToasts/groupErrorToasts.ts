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

interface IToastifyPrototype {
  showToast(this: IToastifyInstance): void;
  [key: string]: unknown;
}

interface IToastifyFactory {
  (options: Partial<IToastifyOptions>): IToastifyInstance;
  prototype: IToastifyPrototype;
}

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
    Toastify: IToastifyFactory;
  }
}

let restorePatch: (() => void) | null = null;

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
  const previousCallback = toast.options.callback;
  toast.options.callback = () => {
    if (tracked.get(key)?.instance === toast) {
      tracked.delete(key);
    }
    previousCallback?.();
  };
}

function installPatch(proto: IToastifyPrototype): () => void {
  const tracked = new Map<string, ITrackedToast>();
  // eslint-disable-next-line @typescript-eslint/unbound-method -- called via .call(this)
  const original = proto.showToast;

  proto.showToast = function (this: IToastifyInstance) {
    if (this.options.className !== ERROR_TOAST_CLASS) {
      original.call(this);
      return;
    }

    const text = this.options.text;
    const key = getDeduplicationKey(text, this.options.selector);
    const existing = tracked.get(key);

    if (existing?.instance.toastElement?.parentNode) {
      const newCount = existing.count + 1;
      this.options.text = `${existing.originalText} (×${newCount})`;

      tracked.set(key, {
        instance: this,
        count: newCount,
        originalText: existing.originalText,
      });

      removeToastElementImmediately(existing.instance);
      existing.instance.options.callback?.();
    } else {
      tracked.set(key, { instance: this, count: 1, originalText: text });
    }

    wrapCallback(this, key, tracked);
    original.call(this);
  };

  return () => {
    proto.showToast = original;
    tracked.clear();
  };
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
    restorePatch = installPatch(window.Toastify.prototype);
  },
  disable() {
    restorePatch?.();
    restorePatch = null;
  },
};
