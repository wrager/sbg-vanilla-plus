import { compactToasts } from './compactToasts';
import { resetRegionsTemplateCacheForTest } from './regionsLine';
import { getToastifyFactory } from '../../core/toastify';
import type { IToastifyPrototype } from '../../core/toastify';

interface IMockToastOptions {
  text: string;
  className: string;
  selector: Element | null;
  id: number;
  callback: (() => void) | null;
  duration: number;
  position: string;
  escapeMarkup: boolean;
}

interface IMockToast {
  options: IMockToastOptions;
  toastElement: HTMLElement | null;
  showToast(): void;
  hideToast: jest.Mock;
}

/**
 * Фабрика установленного мока. Тесты зовут её напрямую, а не через
 * `window.Toastify`: поле опционально (игра может не загрузить пакет), и в
 * каждом тесте пришлось бы гасить проверку на undefined.
 */
let createToast: (options: Partial<IMockToastOptions>) => IMockToast;

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
      position: options.position ?? 'center',
      escapeMarkup: options.escapeMarkup ?? false,
    };
    toast.toastElement = null;
    toast.hideToast = jest.fn();
    return toast;
  };
  factory.prototype = proto;

  window.Toastify = factory as unknown as typeof window.Toastify;
  createToast = factory;
}

function showError(text: string, options: Partial<IMockToastOptions> = {}): IMockToast {
  const toast = createToast({ text, ...options });
  toast.options.className = 'error-toast';
  toast.showToast();
  return toast;
}

function showNeutral(text: string, options: Partial<IMockToastOptions> = {}): IMockToast {
  const toast = createToast({ text, ...options });
  toast.options.className = 'interaction-toast';
  toast.showToast();
  return toast;
}

function fireCallback(toast: IMockToast): void {
  toast.options.callback?.();
}

function getToastifyPrototype(): IToastifyPrototype {
  const factory = getToastifyFactory();
  if (factory === null) throw new Error('Мок Toastify не установлен');
  return factory.prototype;
}

describe('compactToasts', () => {
  beforeEach(() => {
    setupMockToastify();
  });

  afterEach(async () => {
    await compactToasts.disable();
    document.body.innerHTML = '';
  });

  test('toast anchored to a container is passed through untouched', async () => {
    await compactToasts.enable();
    const container = document.createElement('div');
    container.className = 'info';
    document.body.appendChild(container);

    const toast = showNeutral('loot acquired', { selector: container });

    expect(toast.options.text).toBe('loot acquired');
    expect(toast.options.position).toBe('center');
    expect(toast.toastElement?.parentNode).toBe(container);
  });

  test('toasts in different containers stay separate', async () => {
    await compactToasts.enable();
    const container1 = document.createElement('div');
    container1.className = 'info';
    const container2 = document.createElement('div');
    container2.className = 'inventory';
    document.body.append(container1, container2);

    const toast1 = showError('error', { selector: container1 });
    const toast2 = showError('error', { selector: container2 });

    expect(toast1.toastElement?.parentNode).toBe(container1);
    expect(toast2.toastElement?.parentNode).toBe(container2);
    expect(toast2.options.text).toBe('error');
  });

  test('first screen toast shows as is and moves to the corner', async () => {
    await compactToasts.enable();

    const toast = showError('network error');

    expect(toast.options.text).toBe('network error');
    expect(toast.options.position).toBe('left');
    expect(document.querySelectorAll('.toastify').length).toBe(1);
  });

  test('two different messages merge into one block with two lines', async () => {
    await compactToasts.enable();

    showError('network error');
    const toast2 = showError('out of range');

    expect(toast2.options.text).toBe('network error<br>out of range');
    expect(document.querySelectorAll('.toastify').length).toBe(1);
  });

  test('repeated message removes old element and gets a counter', async () => {
    await compactToasts.enable();

    const toast1 = showError('network error');
    const toast2 = showError('network error');

    expect(toast1.toastElement?.parentNode).toBeNull();
    expect(toast2.options.text).toBe('network error (×2)');
    expect(document.querySelectorAll('.toastify').length).toBe(1);
  });

  test('third repeat shows counter ×3', async () => {
    await compactToasts.enable();

    showError('out of range');
    showError('out of range');
    const toast3 = showError('out of range');

    expect(toast3.options.text).toBe('out of range (×3)');
    expect(document.querySelectorAll('.toastify').length).toBe(1);
  });

  test('repeat does not move the line it belongs to', async () => {
    await compactToasts.enable();

    showError('first');
    showError('second');
    const toast3 = showError('first');

    expect(toast3.options.text).toBe('first (×2)<br>second');
  });

  test('neutral toasts also merge into the block', async () => {
    await compactToasts.enable();

    showNeutral('draw plan copied');
    const toast2 = showNeutral('import successful');

    expect(toast2.options.text).toBe('draw plan copied<br>import successful');
    expect(toast2.options.className).toBe('interaction-toast');
    expect(document.querySelectorAll('.toastify').length).toBe(1);
  });

  test('an error line makes the whole block an error', async () => {
    await compactToasts.enable();

    showNeutral('new regions');
    const toast2 = showError('not enough keys');

    expect(toast2.options.className).toBe('error-toast');
  });

  test('block stays an error even when a neutral message comes last', async () => {
    await compactToasts.enable();

    showError('not enough keys');
    const toast2 = showNeutral('new regions');

    expect(toast2.options.className).toBe('error-toast');
  });

  test('block keeps at most five lines, the oldest is dropped', async () => {
    await compactToasts.enable();

    ['one', 'two', 'three', 'four', 'five'].forEach((text) => showError(text));
    const toast6 = showError('six');

    expect(toast6.options.text).toBe('two<br>three<br>four<br>five<br>six');
  });

  test('after the block expires, the next toast starts a new one', async () => {
    await compactToasts.enable();

    const toast1 = showError('error');
    fireCallback(toast1);

    const toast2 = showError('error');

    expect(toast2.options.text).toBe('error');
  });

  test('late callback of a replaced toast does not reset the block', async () => {
    await compactToasts.enable();

    const toast1 = showError('error');
    const toast2 = showError('error');

    expect(toast2.options.text).toBe('error (×2)');

    fireCallback(toast1);

    const toast3 = showError('error');

    expect(toast3.options.text).toBe('error (×3)');
    expect(document.querySelectorAll('.toastify').length).toBe(1);
  });

  test('old element is removed instantly without hideToast animation', async () => {
    await compactToasts.enable();

    const toast1 = showError('error');
    const oldElement = toast1.toastElement;
    expect(oldElement?.parentNode).toBe(document.body);

    showError('error');

    expect(oldElement?.parentNode).toBeNull();
    expect(toast1.hideToast).not.toHaveBeenCalled();
  });

  test('error class is recognised among several classes', async () => {
    await compactToasts.enable();

    const toast = createToast({ text: 'network error' });
    toast.options.className = 'error-toast toastify-custom';
    toast.showToast();

    expect(toast.options.className).toBe('error-toast');
  });

  test('block markup is rendered, not escaped', async () => {
    await compactToasts.enable();

    showError('first');
    const toast2 = showError('second');

    expect(toast2.options.escapeMarkup).toBe(false);
    expect(document.querySelectorAll('.toastify br').length).toBe(1);
  });

  test('game regions toast is shortened inside the block', async () => {
    const globals = window as unknown as Record<string, unknown>;
    globals['i18next'] = {
      language: 'ru',
      resolvedLanguage: 'ru',
      t: (key: string) => (key === 'info.regions' ? 'Регионы' : key),
      getResource: (_lng: string, _namespace: string, key: string) =>
        key === 'popups.new-regions'
          ? 'Новые регионы: {{count}}<br>Общая площадь: {{area}}<br>Макс. площадь: {{max}}'
          : undefined,
    };
    resetRegionsTemplateCacheForTest();
    await compactToasts.enable();

    showNeutral('Новые регионы: 2<br>Общая площадь: 1.4 км²<br>Макс. площадь: 0.7 км²');
    const toast2 = showError('Недостаточно ключей');

    expect(toast2.options.text).toBe('Регионы: +2 (1.4 км²)<br>Недостаточно ключей');
    delete globals['i18next'];
    resetRegionsTemplateCacheForTest();
  });

  test('enable without Toastify does not throw', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    delete window.Toastify;

    expect(() => compactToasts.enable()).not.toThrow();
    expect(() => compactToasts.disable()).not.toThrow();

    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  test('disable restores original showToast', async () => {
    const prototype = getToastifyPrototype();
    const originalShowToast = prototype.showToast;
    await compactToasts.enable();

    expect(prototype.showToast).not.toBe(originalShowToast);

    await compactToasts.disable();

    expect(prototype.showToast).toBe(originalShowToast);
  });

  test('disable drops collected lines', async () => {
    await compactToasts.enable();
    showError('error');

    await compactToasts.disable();
    document.body.innerHTML = '';
    await compactToasts.enable();

    const toast = showError('error');

    expect(toast.options.text).toBe('error');
  });

  test('original callback is preserved and called', async () => {
    await compactToasts.enable();

    const toast = createToast({ text: 'error' });
    toast.options.className = 'error-toast';
    const originalCallback = jest.fn();
    toast.options.callback = originalCallback;
    toast.showToast();

    fireCallback(toast);

    expect(originalCallback).toHaveBeenCalled();
  });

  test('replaced toast callback fires for the game popup_toasts cleanup', async () => {
    await compactToasts.enable();

    const toast1 = createToast({ text: 'error' });
    toast1.options.className = 'error-toast';
    const gameCallback = jest.fn();
    toast1.options.callback = gameCallback;
    toast1.showToast();

    showError('error');

    expect(gameCallback).toHaveBeenCalled();
  });
});
