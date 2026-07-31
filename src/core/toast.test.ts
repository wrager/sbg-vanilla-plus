import { showToast } from './toast';
import type { IToastifyInstance, IToastifyOptions } from './toastify';

/**
 * Мок Toastify: реальную библиотеку в тесты не подключаем. При
 * `escapeMarkup: true` она пишет текст через `innerText`
 * (refs/toastify/toastify.js:66), а jsdom его не реализует - проверять на ней
 * было бы нечего.
 */
interface IMockToastify {
  factory: jest.Mock<IToastifyInstance, [Partial<IToastifyOptions>]>;
  instances: IToastifyInstance[];
}

function setupMockToastify(): IMockToastify {
  const instances: IToastifyInstance[] = [];

  const factory = jest.fn((options: Partial<IToastifyOptions>): IToastifyInstance => {
    const instance = {
      options: options as IToastifyOptions,
      toastElement: null,
      showToast: jest.fn(),
      hideToast: jest.fn(),
    };
    instances.push(instance);
    return instance;
  });

  window.Toastify = factory as unknown as typeof window.Toastify;
  return { factory, instances };
}

function lastCallOptions(mock: IMockToastify): Partial<IToastifyOptions> {
  return mock.factory.mock.calls[0][0];
}

describe('showToast через Toastify игры', () => {
  let toastify: IMockToastify;

  beforeEach(() => {
    document.body.innerHTML = '';
    toastify = setupMockToastify();
  });

  afterEach(() => {
    delete window.Toastify;
  });

  test('передаёт в Toastify текст и игровые значения по умолчанию', () => {
    showToast('hello');

    expect(toastify.factory).toHaveBeenCalledTimes(1);
    expect(lastCallOptions(toastify)).toMatchObject({
      text: 'hello',
      duration: 3000,
      gravity: 'top',
      position: 'center',
      className: 'interaction-toast',
      selector: null,
      escapeMarkup: true,
    });
    expect(toastify.instances[0].showToast).toHaveBeenCalledTimes(1);
  });

  test('не создаёт собственный узел, пока Toastify доступен', () => {
    showToast('hello');
    expect(document.querySelector('.svp-toast')).toBeNull();
  });

  test('тип ошибки даёт игровой класс error-toast', () => {
    showToast('boom', { type: 'error' });
    expect(lastCallOptions(toastify).className).toBe('error-toast');
  });

  test('явный нейтральный тип даёт класс interaction-toast', () => {
    showToast('fine', { type: 'neutral' });
    expect(lastCallOptions(toastify).className).toBe('interaction-toast');
  });

  test('позиция разбирается на gravity и выравнивание: top left', () => {
    showToast('hello', { position: 'top left' });
    expect(lastCallOptions(toastify)).toMatchObject({ gravity: 'top', position: 'left' });
  });

  test('позиция разбирается на gravity и выравнивание: bottom right', () => {
    showToast('hello', { position: 'bottom right' });
    expect(lastCallOptions(toastify)).toMatchObject({ gravity: 'bottom', position: 'right' });
  });

  test('контейнер уходит в selector', () => {
    const container = document.createElement('div');
    showToast('hello', { container });
    expect(lastCallOptions(toastify).selector).toBe(container);
  });

  test('длительность пробрасывается как есть', () => {
    showToast('hello', { duration: 5000 });
    expect(lastCallOptions(toastify).duration).toBe(5000);
  });

  test('нулевая длительность не подменяется дефолтом', () => {
    showToast('hello', { duration: 0 });
    expect(lastCallOptions(toastify).duration).toBe(0);
  });

  test('клик закрывает тост', () => {
    showToast('hello');
    const instance = toastify.instances[0];

    instance.options.onClick?.();

    expect(instance.hideToast).toHaveBeenCalledTimes(1);
  });

  test('разметка в сообщении не рендерится: escapeMarkup включён', () => {
    showToast('<b>hi</b>');
    expect(lastCallOptions(toastify)).toMatchObject({
      text: '<b>hi</b>',
      escapeMarkup: true,
    });
  });
});

describe('showToast без Toastify (запасной путь)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    document.body.innerHTML = '';
    delete window.Toastify;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('mounts a .svp-toast in body with the given message', () => {
    showToast('hello');
    const toast = document.querySelector('.svp-toast');
    expect(toast).not.toBeNull();
    expect(toast?.textContent).toBe('hello');
  });

  test('auto-hides after duration: adds svp-toast-hide, removes from DOM on transitionend', () => {
    showToast('bye', { duration: 3000 });
    const toast = document.querySelector<HTMLDivElement>('.svp-toast');
    expect(toast?.classList.contains('svp-toast-hide')).toBe(false);

    jest.advanceTimersByTime(3000);
    expect(toast?.classList.contains('svp-toast-hide')).toBe(true);
    expect(document.querySelector('.svp-toast')).not.toBeNull(); // ещё в DOM до transitionend

    toast?.dispatchEvent(new Event('transitionend'));
    expect(document.querySelector('.svp-toast')).toBeNull();
  });

  test('click dismisses toast immediately (before timer fires)', () => {
    showToast('click me', { duration: 3000 });
    const toast = document.querySelector<HTMLDivElement>('.svp-toast');
    expect(toast?.classList.contains('svp-toast-hide')).toBe(false);

    toast?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(toast?.classList.contains('svp-toast-hide')).toBe(true);

    toast?.dispatchEvent(new Event('transitionend'));
    expect(document.querySelector('.svp-toast')).toBeNull();
  });

  test('click after auto-hide started does not remove toast twice', () => {
    showToast('idempotent', { duration: 3000 });
    const toast = document.querySelector<HTMLDivElement>('.svp-toast');

    jest.advanceTimersByTime(3000);
    expect(toast?.classList.contains('svp-toast-hide')).toBe(true);

    // Повторный клик после старта авто-скрытия — no-op (hide-класс уже стоит).
    toast?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(toast?.classList.contains('svp-toast-hide')).toBe(true);

    toast?.dispatchEvent(new Event('transitionend'));
    expect(document.querySelector('.svp-toast')).toBeNull();
  });

  test('длительность по умолчанию - 3000', () => {
    showToast('default');
    const toast = document.querySelector<HTMLDivElement>('.svp-toast');

    jest.advanceTimersByTime(2999);
    expect(toast?.classList.contains('svp-toast-hide')).toBe(false);

    jest.advanceTimersByTime(1);
    expect(toast?.classList.contains('svp-toast-hide')).toBe(true);
  });

  test('тип и позиция на запасном пути не меняют разметку', () => {
    showToast('styled', { type: 'error', position: 'top left' });
    const toast = document.querySelector<HTMLDivElement>('.svp-toast');

    expect(toast?.className).toBe('svp-toast');
    expect(toast?.getAttribute('style')).toBeNull();
  });

  test('не функция в window.Toastify уводит на запасной путь', () => {
    window.Toastify = null as unknown as typeof window.Toastify;

    showToast('fallback');

    expect(document.querySelector('.svp-toast')?.textContent).toBe('fallback');
  });

  test('разметка в сообщении не рендерится', () => {
    showToast('<b>hi</b>');
    const toast = document.querySelector<HTMLDivElement>('.svp-toast');

    expect(toast?.textContent).toBe('<b>hi</b>');
    expect(toast?.querySelector('b')).toBeNull();
  });
});
