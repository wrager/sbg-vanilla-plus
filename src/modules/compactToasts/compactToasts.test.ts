import { compactToasts } from './compactToasts';
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
    /** Повторяет Toastify: узел с таймером автоснятия на нём (toastify.js:105). */
    showToast(this: IMockToast) {
      const element = document.createElement('div') as HTMLElement & {
        timeOutValue?: ReturnType<typeof setTimeout>;
      };
      element.className = 'toastify on';
      element.innerHTML = this.options.text;
      const container = (this.options.selector as HTMLElement | null) ?? document.body;
      container.appendChild(element);
      this.toastElement = element;
      element.timeOutValue = setTimeout(() => {
        element.remove();
        this.options.callback?.();
      }, this.options.duration);
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
      duration: options.duration ?? 3000,
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

/**
 * Текст живого блока в контейнере (по умолчанию - на уровне экрана). Только
 * прямые дети: контейнеры вложены в body, и обычный поиск нашёл бы чужой узел.
 */
function blockText(container: HTMLElement = document.body): string {
  return container.querySelector(':scope > .toastify')?.innerHTML ?? '';
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
    jest.useFakeTimers();
    setupMockToastify();
  });

  afterEach(async () => {
    await compactToasts.disable();
    document.body.innerHTML = '';
    jest.useRealTimers();
  });

  describe('охват', () => {
    test('нейтральные сообщения не группируются', async () => {
      await compactToasts.enable();

      showNeutral('draw plan copied');
      showNeutral('draw plan copied');

      expect(document.querySelectorAll('.toastify').length).toBe(2);
    });

    test('нейтральное сообщение не меняет позицию и разметку', async () => {
      await compactToasts.enable();

      const toast = showNeutral('import successful');

      expect(toast.options.text).toBe('import successful');
      expect(toast.options.position).toBe('center');
    });

    test('ошибки в попапе точки группируются, а не проходят мимо', async () => {
      await compactToasts.enable();
      const popup = document.createElement('div');
      popup.className = 'info';
      document.body.appendChild(popup);

      showError('Point is out of range', { selector: popup });
      showError('Point is out of range', { selector: popup });
      showError('Point is out of range', { selector: popup });

      expect(popup.querySelectorAll('.toastify').length).toBe(1);
      expect(blockText(popup)).toBe('Point is out of range (×3)');
    });

    test('ошибки в разных контейнерах собираются в разные блоки', async () => {
      await compactToasts.enable();
      const popup = document.createElement('div');
      popup.className = 'info';
      document.body.appendChild(popup);

      showError('screen error');
      showError('popup error', { selector: popup });

      expect(blockText()).toBe('screen error');
      expect(blockText(popup)).toBe('popup error');
    });

    test('позиция, заданная игрой, не меняется', async () => {
      await compactToasts.enable();

      const toast = showError('network error', { position: 'right' });

      expect(toast.options.position).toBe('right');
    });
  });

  describe('сборка строк', () => {
    test('первая ошибка показывается как есть', async () => {
      await compactToasts.enable();

      showError('network error');

      expect(blockText()).toBe('network error');
      expect(document.querySelectorAll('.toastify').length).toBe(1);
    });

    test('две разные ошибки собираются в один блок', async () => {
      await compactToasts.enable();

      showError('network error');
      showError('out of range');

      expect(blockText()).toBe('network error<br>out of range');
      expect(document.querySelectorAll('.toastify').length).toBe(1);
    });

    test('повтор даёт счётчик и снимает прежний узел', async () => {
      await compactToasts.enable();

      const toast1 = showError('network error');
      showError('network error');

      expect(toast1.toastElement?.parentNode).toBeNull();
      expect(blockText()).toBe('network error (×2)');
      expect(document.querySelectorAll('.toastify').length).toBe(1);
    });

    test('третий повтор даёт счётчик ×3', async () => {
      await compactToasts.enable();

      showError('out of range');
      showError('out of range');
      showError('out of range');

      expect(blockText()).toBe('out of range (×3)');
    });

    test('повтор не двигает строку с её места', async () => {
      await compactToasts.enable();

      showError('first');
      showError('second');
      showError('first');

      expect(blockText()).toBe('first (×2)<br>second');
    });

    test('в блоке не больше пяти строк, самая старая вытесняется', async () => {
      await compactToasts.enable();

      ['one', 'two', 'three', 'four', 'five', 'six'].forEach((text) => showError(text));

      expect(blockText()).toBe('two<br>three<br>four<br>five<br>six');
    });

    test('разметка в тексте ошибки не рендерится', async () => {
      await compactToasts.enable();

      showError('<b>boom</b>');

      expect(blockText()).toBe('&lt;b&gt;boom&lt;/b&gt;');
      expect(document.querySelector('.toastify b')).toBeNull();
    });

    test('прежний узел снимается мгновенно, без анимации hideToast', async () => {
      await compactToasts.enable();

      const toast1 = showError('error');
      const oldElement = toast1.toastElement;

      showError('error');

      expect(oldElement?.parentNode).toBeNull();
      expect(toast1.hideToast).not.toHaveBeenCalled();
    });

    test('класс ошибки опознаётся среди нескольких классов', async () => {
      await compactToasts.enable();

      const toast1 = createToast({ text: 'network error' });
      toast1.options.className = 'error-toast toastify-custom';
      toast1.showToast();
      const toast2 = createToast({ text: 'network error' });
      toast2.options.className = 'error-toast toastify-custom';
      toast2.showToast();

      expect(blockText()).toBe('network error (×2)');
    });
  });

  describe('срок жизни строк', () => {
    test('истёкшая строка уходит из блока, свежая остаётся', async () => {
      await compactToasts.enable();

      showError('early');
      jest.advanceTimersByTime(2000);
      showError('late');

      expect(blockText()).toBe('early<br>late');

      // Через 3 с после первой строки её срок истёк, у второй остаётся ещё 2 с.
      jest.advanceTimersByTime(1000);

      expect(blockText()).toBe('late');
    });

    test('строки не копятся до конца серии', async () => {
      await compactToasts.enable();

      showError('X');
      jest.advanceTimersByTime(3500);
      showError('Y');

      expect(blockText()).toBe('Y');
    });

    test('повтор продлевает срок своей строки', async () => {
      await compactToasts.enable();

      showError('X');
      jest.advanceTimersByTime(2000);
      showError('X');

      jest.advanceTimersByTime(1500);

      expect(blockText()).toBe('X (×2)');
    });

    test('узел живёт до самой поздней строки', async () => {
      await compactToasts.enable();

      showError('long', { duration: 5000 });
      const toast2 = showError('short', { duration: 3000 });

      expect(toast2.options.duration).toBe(5000);
    });

    test('после ухода блока следующая ошибка начинает его заново', async () => {
      await compactToasts.enable();

      const toast1 = showError('error');
      fireCallback(toast1);

      showError('error');

      expect(blockText()).toBe('error');
    });

    test('поздний callback снятого тоста не сбрасывает блок', async () => {
      await compactToasts.enable();

      const toast1 = showError('error');
      showError('error');

      fireCallback(toast1);
      showError('error');

      expect(blockText()).toBe('error (×3)');
      expect(document.querySelectorAll('.toastify').length).toBe(1);
    });
  });

  describe('короткая строка регионов', () => {
    beforeEach(() => {
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
    });

    afterEach(() => {
      const globals = window as unknown as Record<string, unknown>;
      delete globals['i18next'];
    });

    test('тост про регионы сворачивается, оставаясь отдельным', async () => {
      await compactToasts.enable();

      const toast = showNeutral(
        'Новые регионы: 2<br>Общая площадь: 1.4 км²<br>Макс. площадь: 0.7 км²',
      );

      expect(toast.options.text).toBe('Регионы: +2 (1.4 км²)');
    });

    test('свёрнутый тост регионов не попадает в блок ошибок', async () => {
      await compactToasts.enable();

      showNeutral('Новые регионы: 2<br>Общая площадь: 1.4 км²<br>Макс. площадь: 0.7 км²');
      showError('Недостаточно ключей');

      expect(document.querySelectorAll('.toastify').length).toBe(2);
      expect(blockText()).toBe('Регионы: +2 (1.4 км²)');
    });
  });

  describe('жизненный цикл модуля', () => {
    test('enable без Toastify не бросает', () => {
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
      delete window.Toastify;

      expect(() => compactToasts.enable()).not.toThrow();
      expect(() => compactToasts.disable()).not.toThrow();

      expect(warn).toHaveBeenCalled();
      warn.mockRestore();
    });

    test('disable возвращает оригинальный showToast', async () => {
      const prototype = getToastifyPrototype();
      const originalShowToast = prototype.showToast;
      await compactToasts.enable();

      expect(prototype.showToast).not.toBe(originalShowToast);

      await compactToasts.disable();

      expect(prototype.showToast).toBe(originalShowToast);
    });

    test('disable сбрасывает накопленные строки', async () => {
      await compactToasts.enable();
      showError('error');

      await compactToasts.disable();
      document.body.innerHTML = '';
      await compactToasts.enable();

      showError('error');

      expect(blockText()).toBe('error');
    });

    test('исходный callback игры сохраняется и вызывается', async () => {
      await compactToasts.enable();

      const toast = createToast({ text: 'error' });
      toast.options.className = 'error-toast';
      const originalCallback = jest.fn();
      toast.options.callback = originalCallback;
      toast.showToast();

      fireCallback(toast);

      expect(originalCallback).toHaveBeenCalled();
    });

    test('callback снятого тоста вызывается для уборки popup_toasts игры', async () => {
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

  describe('несовместимость с игрой', () => {
    test('ошибка в сборке снимает патч, а сообщение игры доходит до экрана', async () => {
      const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
      const originalShowToast = getToastifyPrototype().showToast;
      await compactToasts.enable();
      const prototype = getToastifyPrototype();

      const broken = createToast({ text: 'boom' });
      // Игра новой версии может отдать в опциях что угодно: читаем их первыми,
      // поэтому падение здесь эмулирует любую несовместимость.
      Object.defineProperty(broken.options, 'className', {
        get() {
          throw new Error('game changed');
        },
      });

      expect(() => {
        broken.showToast();
      }).not.toThrow();
      expect(document.querySelectorAll('.toastify').length).toBe(1);
      expect(prototype.showToast).toBe(originalShowToast);
      expect(consoleError).toHaveBeenCalled();

      consoleError.mockRestore();
    });

    test('после снятия патча ошибки показываются игрой по одной', async () => {
      const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
      await compactToasts.enable();

      const broken = createToast({ text: 'boom' });
      Object.defineProperty(broken.options, 'className', {
        get() {
          throw new Error('game changed');
        },
      });
      broken.showToast();

      showError('network error');
      showError('network error');

      expect(document.querySelectorAll('.toastify').length).toBe(3);

      consoleError.mockRestore();
    });

    test('сообщение без автоснятия не собирается в блок', async () => {
      await compactToasts.enable();

      showError('sticky error', { duration: 0 });
      showError('sticky error', { duration: 0 });

      expect(document.querySelectorAll('.toastify').length).toBe(2);
    });

    test('пустое сообщение не собирается в блок: игра дописывает его после показа', async () => {
      await compactToasts.enable();

      const toast = showError('');
      const element = toast.toastElement;
      if (element === null) throw new Error('тост не показан');
      element.innerHTML = 'добыча';

      showError('');

      expect(document.querySelectorAll('.toastify').length).toBe(2);
      expect(element.innerHTML).toBe('добыча');
    });
  });
});
