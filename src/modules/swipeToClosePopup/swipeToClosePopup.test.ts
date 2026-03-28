// jsdom не реализует Touch/TouchEvent — полифилл с нужными свойствами
class TouchPolyfill {
  readonly clientX: number;
  readonly clientY: number;
  constructor(init: { clientX?: number; clientY?: number }) {
    this.clientX = init.clientX ?? 0;
    this.clientY = init.clientY ?? 0;
  }
}

class TouchEventPolyfill extends UIEvent {
  readonly targetTouches: readonly TouchPolyfill[];
  constructor(
    type: string,
    init: { cancelable?: boolean; targetTouches?: TouchPolyfill[]; timeStamp?: number } = {},
  ) {
    super(type, { bubbles: true, cancelable: init.cancelable });
    this.targetTouches = init.targetTouches ?? [];
    if (init.timeStamp !== undefined) {
      Object.defineProperty(this, 'timeStamp', { value: init.timeStamp });
    }
  }
}

if (typeof globalThis.TouchEvent === 'undefined') {
  (globalThis as Record<string, unknown>).TouchEvent = TouchEventPolyfill;
}

import { swipeToClosePopup } from './swipeToClosePopup';

let popup: HTMLDivElement;

/** Проверить что свайп-стили (translate/rotate) сброшены */
function expectNoSwipeStyles(): void {
  expect(popup.style.getPropertyValue('translate')).toBe('');
  expect(popup.style.getPropertyValue('rotate')).toBe('');
}

function createPopupDom(): HTMLDivElement {
  const div = document.createElement('div');
  div.className = 'info popup';
  div.innerHTML =
    '<h3 class="i-header popup-header"><span id="i-title">Test</span></h3>' +
    '<div class="i-stat">' +
    '<div class="deploy-slider-wrp"><div class="splide"></div></div>' +
    '<div class="i-buttons"><button id="discover">Discover</button></div>' +
    '</div>' +
    '<button class="popup-close">[x]</button>';
  return div;
}

function dispatchTouch(
  element: HTMLElement,
  type: 'touchstart' | 'touchmove' | 'touchend' | 'touchcancel',
  options: {
    clientX?: number;
    clientY?: number;
    targetTouches?: number;
    timeStamp?: number;
  } = {},
): TouchEventPolyfill {
  const touchCount =
    options.targetTouches ?? (type === 'touchend' || type === 'touchcancel' ? 0 : 1);
  const touch = new TouchPolyfill({ clientX: options.clientX, clientY: options.clientY });
  const touches = Array.from({ length: touchCount }, () => touch);

  const event = new TouchEventPolyfill(type, {
    cancelable: true,
    targetTouches: touches,
    timeStamp: options.timeStamp,
  });

  element.dispatchEvent(event);
  return event;
}

/**
 * Имитация горизонтального свайпа: touchstart → touchmove (направление) → touchmove (финал).
 * Timestamps расставлены так, чтобы velocity = deltaX / 200ms — предсказуемо для тестов.
 */
function swipeHorizontal(element: HTMLElement, startX: number, endX: number, y = 200): void {
  const baseTime = 1000;
  dispatchTouch(element, 'touchstart', { clientX: startX, clientY: y, timeStamp: baseTime });
  // Промежуточное движение для определения направления
  const midX = startX + Math.sign(endX - startX) * 15;
  dispatchTouch(element, 'touchmove', { clientX: midX, clientY: y, timeStamp: baseTime + 50 });
  // Финальная позиция
  dispatchTouch(element, 'touchmove', { clientX: endX, clientY: y, timeStamp: baseTime + 100 });
}

/** Timestamp для touchend после swipeHorizontal (baseTime + 200ms) */
const SWIPE_END_TIMESTAMP = 1200;

async function flushMutations(): Promise<void> {
  // MutationObserver callbacks в jsdom приходят в microtask очереди.
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(async () => {
  jest.useFakeTimers();
  jest.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    return setTimeout(callback, 0) as unknown as number;
  });

  popup = createPopupDom();
  document.body.appendChild(popup);

  Object.defineProperty(window, 'innerWidth', { value: 400, configurable: true });

  await swipeToClosePopup.enable();
});

afterEach(async () => {
  await swipeToClosePopup.disable();
  popup.remove();
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe('swipeToClosePopup', () => {
  test('has correct module metadata', () => {
    expect(swipeToClosePopup.id).toBe('swipeToClosePopup');
    expect(swipeToClosePopup.category).toBe('ui');
    expect(swipeToClosePopup.defaultEnabled).toBe(true);
  });

  test('swipe right beyond threshold dismisses popup', () => {
    const header = popup.querySelector('.i-header') as HTMLElement;
    swipeHorizontal(header, 100, 250);
    dispatchTouch(header, 'touchend', { timeStamp: SWIPE_END_TIMESTAMP });

    jest.advanceTimersByTime(SAFETY_TIMEOUT);

    expect(popup.classList.contains('hidden')).toBe(true);
  });

  test('swipe left beyond threshold dismisses popup', () => {
    const header = popup.querySelector('.i-header') as HTMLElement;
    swipeHorizontal(header, 250, 100);
    dispatchTouch(header, 'touchend', { timeStamp: SWIPE_END_TIMESTAMP });

    jest.advanceTimersByTime(SAFETY_TIMEOUT);

    expect(popup.classList.contains('hidden')).toBe(true);
  });

  test('short swipe returns popup to original position', () => {
    const header = popup.querySelector('.i-header') as HTMLElement;
    swipeHorizontal(header, 100, 140);
    dispatchTouch(header, 'touchend', { timeStamp: SWIPE_END_TIMESTAMP });

    jest.advanceTimersByTime(SAFETY_TIMEOUT);

    expect(popup.classList.contains('hidden')).toBe(false);
    expectNoSwipeStyles();
    expect(popup.style.opacity).toBe('');
  });

  test('vertical scroll does not trigger swipe', () => {
    const header = popup.querySelector('.i-header') as HTMLElement;
    dispatchTouch(header, 'touchstart', { clientX: 200, clientY: 200 });
    dispatchTouch(header, 'touchmove', { clientX: 202, clientY: 230 });

    expectNoSwipeStyles();
  });

  test('multi-touch cancels gesture', () => {
    const header = popup.querySelector('.i-header') as HTMLElement;
    dispatchTouch(header, 'touchstart', { clientX: 200, clientY: 200 });
    dispatchTouch(header, 'touchmove', { clientX: 220, clientY: 200 });
    // Мультитач — жест отменяется
    dispatchTouch(header, 'touchmove', { clientX: 220, clientY: 200, targetTouches: 2 });

    expectNoSwipeStyles();
  });

  test('touches on deploy carousel are excluded', () => {
    const carousel = popup.querySelector('.splide') as HTMLElement;
    dispatchTouch(carousel, 'touchstart', { clientX: 200, clientY: 200 });
    dispatchTouch(carousel, 'touchmove', { clientX: 350, clientY: 200 });

    expectNoSwipeStyles();
  });

  test('touchcancel resets gesture', () => {
    const header = popup.querySelector('.i-header') as HTMLElement;
    swipeHorizontal(header, 100, 250);
    dispatchTouch(header, 'touchcancel');

    expectNoSwipeStyles();
    expect(popup.classList.contains('hidden')).toBe(false);
  });

  test('applies swipe styles during gesture', () => {
    const header = popup.querySelector('.i-header') as HTMLElement;
    const spy = jest.spyOn(popup.style, 'setProperty');

    swipeHorizontal(header, 100, 200);

    // translate/rotate — CSS Transforms Level 2, не поддерживаются jsdom.
    // Проверяем через spy на setProperty и через opacity (поддерживается).
    expect(spy).toHaveBeenCalledWith('translate', expect.stringContaining('px'));
    expect(spy).toHaveBeenCalledWith('rotate', expect.stringContaining('deg'));
    expect(popup.style.opacity).not.toBe('');
    expect(popup.style.opacity).not.toBe('1');
  });

  test('disable during gesture resets styles', async () => {
    const header = popup.querySelector('.i-header') as HTMLElement;
    swipeHorizontal(header, 100, 200);

    await swipeToClosePopup.disable();

    expectNoSwipeStyles();
    expect(popup.style.opacity).toBe('');
    expect(popup.style.willChange).toBe('');
  });

  test('preventDefault called during horizontal swipe', () => {
    const header = popup.querySelector('.i-header') as HTMLElement;
    dispatchTouch(header, 'touchstart', { clientX: 200, clientY: 200 });
    // Определить направление как горизонтальное
    dispatchTouch(header, 'touchmove', { clientX: 215, clientY: 200 });

    // Следующий touchmove должен вызвать preventDefault
    const touch = new TouchPolyfill({ clientX: 250, clientY: 200 });
    const event = new TouchEventPolyfill('touchmove', {
      cancelable: true,
      targetTouches: [touch],
    });
    const spy = jest.spyOn(event, 'preventDefault');
    header.dispatchEvent(event);

    expect(spy).toHaveBeenCalled();
  });

  test('popup has no lingering styles after dismiss', () => {
    const header = popup.querySelector('.i-header') as HTMLElement;
    swipeHorizontal(header, 100, 250);
    dispatchTouch(header, 'touchend', { timeStamp: SWIPE_END_TIMESTAMP });

    jest.advanceTimersByTime(SAFETY_TIMEOUT);

    expect(popup.classList.contains('hidden')).toBe(true);
    expectNoSwipeStyles();
    expect(popup.style.opacity).toBe('');
    expect(popup.style.willChange).toBe('');
    expect(popup.classList.contains('svp-swipe-animating')).toBe(false);
  });

  test('transitionend from child element does not finish dismiss early', () => {
    const header = popup.querySelector('.i-header') as HTMLElement;
    const title = popup.querySelector('#i-title') as HTMLElement;
    swipeHorizontal(header, 100, 250);
    dispatchTouch(header, 'touchend', { timeStamp: SWIPE_END_TIMESTAMP });

    title.dispatchEvent(new Event('transitionend', { bubbles: true }));
    expect(popup.classList.contains('hidden')).toBe(false);

    jest.advanceTimersByTime(SAFETY_TIMEOUT);
    expect(popup.classList.contains('hidden')).toBe(true);
  });

  test('dismiss clicks popup-close button', () => {
    const closeButton = popup.querySelector('.popup-close') as HTMLButtonElement;
    const clickSpy = jest.spyOn(closeButton, 'click');
    const header = popup.querySelector('.i-header') as HTMLElement;

    swipeHorizontal(header, 100, 250);
    dispatchTouch(header, 'touchend', { timeStamp: SWIPE_END_TIMESTAMP });
    jest.advanceTimersByTime(SAFETY_TIMEOUT);

    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  test('fast velocity swipe dismisses even with short distance', () => {
    const header = popup.querySelector('.i-header') as HTMLElement;
    const startTime = 1000;
    // Быстрый короткий свайп: 60px за 50ms = 1.2 px/ms (порог 0.5)
    dispatchTouch(header, 'touchstart', { clientX: 200, clientY: 200, timeStamp: startTime });
    dispatchTouch(header, 'touchmove', {
      clientX: 215,
      clientY: 200,
      timeStamp: startTime + 20,
    });
    dispatchTouch(header, 'touchmove', {
      clientX: 260,
      clientY: 200,
      timeStamp: startTime + 40,
    });
    dispatchTouch(header, 'touchend', { timeStamp: startTime + 50 });

    jest.advanceTimersByTime(SAFETY_TIMEOUT);

    expect(popup.classList.contains('hidden')).toBe(true);
  });

  test('toastify elements are removed on dismiss', () => {
    const toast = document.createElement('div');
    toast.className = 'toastify';
    popup.appendChild(toast);

    const header = popup.querySelector('.i-header') as HTMLElement;
    swipeHorizontal(header, 100, 250);
    dispatchTouch(header, 'touchend', { timeStamp: SWIPE_END_TIMESTAMP });

    jest.advanceTimersByTime(SAFETY_TIMEOUT);

    expect(popup.querySelector('.toastify')).toBeNull();
  });

  test('tap without movement does not affect popup', () => {
    const header = popup.querySelector('.i-header') as HTMLElement;
    dispatchTouch(header, 'touchstart', { clientX: 200, clientY: 200 });
    dispatchTouch(header, 'touchend');

    expectNoSwipeStyles();
    expect(popup.classList.contains('hidden')).toBe(false);
  });

  test('observer resets stale styles when hidden is removed', async () => {
    popup.classList.add('hidden');
    await flushMutations();

    popup.style.setProperty('translate', '120px');
    popup.style.setProperty('rotate', '6deg');
    popup.style.opacity = '0';
    popup.classList.add('svp-swipe-animating');

    popup.classList.remove('hidden');
    await flushMutations();

    expectNoSwipeStyles();
    expect(popup.style.opacity).toBe('');
    expect(popup.classList.contains('svp-swipe-animating')).toBe(false);
  });

  test('observer resets stale styles when data-guid changes on visible popup', async () => {
    popup.dataset.guid = 'point-1';
    await flushMutations();

    popup.style.setProperty('translate', '80px');
    popup.style.setProperty('rotate', '-4deg');
    popup.style.opacity = '0';
    popup.classList.add('svp-swipe-animating');

    popup.dataset.guid = 'point-2';
    await flushMutations();

    expectNoSwipeStyles();
    expect(popup.style.opacity).toBe('');
    expect(popup.classList.contains('svp-swipe-animating')).toBe(false);
  });

  test('touchstart sanitizes stale swipe styles before tracking', () => {
    popup.style.setProperty('translate', '60px');
    popup.style.setProperty('rotate', '3deg');
    popup.style.opacity = '0';
    popup.classList.add('svp-swipe-animating');

    const header = popup.querySelector('.i-header') as HTMLElement;
    dispatchTouch(header, 'touchstart', { clientX: 200, clientY: 200 });

    expectNoSwipeStyles();
    expect(popup.style.opacity).toBe('');
    expect(popup.classList.contains('svp-swipe-animating')).toBe(false);
    expect(popup.style.willChange).toBe('translate, rotate, opacity');
  });

  test('fallback dismisses when popup-close button is missing', () => {
    popup.querySelector('.popup-close')?.remove();
    const header = popup.querySelector('.i-header') as HTMLElement;

    swipeHorizontal(header, 100, 250);
    dispatchTouch(header, 'touchend', { timeStamp: SWIPE_END_TIMESTAMP });
    jest.advanceTimersByTime(SAFETY_TIMEOUT);

    expect(popup.classList.contains('hidden')).toBe(true);
  });

  test('no stale styles after dismiss and reopen cycle', async () => {
    const header = popup.querySelector('.i-header') as HTMLElement;
    swipeHorizontal(header, 100, 250);
    dispatchTouch(header, 'touchend', { timeStamp: SWIPE_END_TIMESTAMP });
    jest.advanceTimersByTime(SAFETY_TIMEOUT);

    popup.classList.remove('hidden');
    await flushMutations();

    expectNoSwipeStyles();
    expect(popup.style.opacity).toBe('');
    expect(popup.classList.contains('svp-swipe-animating')).toBe(false);
  });

  test('enable without popup element does not throw', async () => {
    await swipeToClosePopup.disable();
    popup.remove();

    // enable() возвращает void когда попап не найден — Promise.resolve оборачивает
    await Promise.resolve(swipeToClosePopup.enable());
  });
});

/** Суммарный таймаут для rAF + safety margin в тестах */
const SAFETY_TIMEOUT = 400;
