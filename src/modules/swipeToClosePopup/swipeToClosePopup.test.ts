import {
  ANIMATION_DURATION,
  DIRECTION_THRESHOLD,
  DISMISS_THRESHOLD,
  OPACITY_DISTANCE,
  dispatchTouchEndForTest,
  dispatchTouchMoveForTest,
  dispatchTouchStartForTest,
  getStateForTest,
  isWithinCoresSlider,
  resetTrackingForTest,
  setPopupForTest,
  swipeToClosePopup,
} from './swipeToClosePopup';

function setupPopupDom(): HTMLElement {
  document.body.innerHTML = `
    <div class="info popup">
      <button class="popup-close">x</button>
      <div class="i-stat">
        <span class="content-text">Owner info</span>
        <div class="deploy-slider-wrp">
          <div class="splide" id="deploy-slider">
            <ul class="splide__list" id="cores-list">
              <li class="splide__slide">core1</li>
            </ul>
          </div>
        </div>
        <div class="i-buttons">
          <button id="discover">Discover</button>
        </div>
      </div>
    </div>
  `;
  return document.querySelector('.info') as HTMLElement;
}

afterEach(async () => {
  await swipeToClosePopup.disable();
  setPopupForTest(null);
  resetTrackingForTest();
  document.body.innerHTML = '';
});

// ── isWithinCoresSlider ──────────────────────────────────────────────────────

describe('isWithinCoresSlider', () => {
  beforeEach(() => {
    setupPopupDom();
  });

  test('true для элемента внутри #cores-list', () => {
    expect(isWithinCoresSlider(document.querySelector('.splide__slide'))).toBe(true);
  });

  test('true для элемента внутри .deploy-slider-wrp', () => {
    expect(isWithinCoresSlider(document.querySelector('.deploy-slider-wrp'))).toBe(true);
  });

  test('false для контента попапа вне слайдера', () => {
    expect(isWithinCoresSlider(document.querySelector('.content-text'))).toBe(false);
  });

  test('false для null/не-Element', () => {
    expect(isWithinCoresSlider(null)).toBe(false);
  });
});

// ── live-стили во время свайпа ───────────────────────────────────────────────

describe('live-стили на touchmove', () => {
  let popup: HTMLElement;

  beforeEach(() => {
    popup = setupPopupDom();
    setPopupForTest(popup);
  });

  test('после превышения direction-threshold вверх state переходит в swiping и применяются стили', () => {
    const setSpy = jest.spyOn(popup.style, 'setProperty');
    const target = popup.querySelector('.content-text') as HTMLElement;
    dispatchTouchStartForTest({ clientX: 100, clientY: 500, target }, 0);
    expect(getStateForTest()).toBe('tracking');

    // Маленькое движение - state остаётся tracking, стили не применяются.
    dispatchTouchMoveForTest({ clientX: 100, clientY: 500 - DIRECTION_THRESHOLD + 1, target }, 50);
    expect(getStateForTest()).toBe('tracking');
    expect(setSpy).not.toHaveBeenCalledWith('translate', expect.any(String));

    // Превышение порога вверх + вертикаль доминирует - state swiping, рендер.
    dispatchTouchMoveForTest({ clientX: 105, clientY: 500 - 60, target }, 100);
    expect(getStateForTest()).toBe('swiping');
    expect(setSpy).toHaveBeenCalledWith('translate', '0 -60px');
    expect(parseFloat(popup.style.opacity)).toBeGreaterThan(0);
    expect(parseFloat(popup.style.opacity)).toBeLessThan(1);
  });

  test('горизонтальный жест переводит state в idle', () => {
    const target = popup.querySelector('.content-text') as HTMLElement;
    dispatchTouchStartForTest({ clientX: 100, clientY: 500, target }, 0);
    // deltaX=100, deltaY=15 - оба превышают threshold, но deltaX доминирует.
    dispatchTouchMoveForTest({ clientX: 200, clientY: 515, target }, 50);
    expect(getStateForTest()).toBe('idle');
  });

  test('свайп вниз - не наш жест (тоже idle)', () => {
    const target = popup.querySelector('.content-text') as HTMLElement;
    dispatchTouchStartForTest({ clientX: 100, clientY: 500, target }, 0);
    // deltaY=+60 (вниз) - не свайп вверх.
    dispatchTouchMoveForTest({ clientX: 100, clientY: 560, target }, 50);
    expect(getStateForTest()).toBe('idle');
  });

  test('opacity достигает 0 при OPACITY_DISTANCE смещении', () => {
    const target = popup.querySelector('.content-text') as HTMLElement;
    dispatchTouchStartForTest({ clientX: 100, clientY: 500, target }, 0);
    dispatchTouchMoveForTest({ clientX: 100, clientY: 500 - OPACITY_DISTANCE, target }, 100);
    expect(parseFloat(popup.style.opacity)).toBeCloseTo(0);
  });
});

// ── touchend ────────────────────────────────────────────────────────────────

describe('touchend - dismiss vs return', () => {
  let popup: HTMLElement;

  beforeEach(() => {
    popup = setupPopupDom();
    setPopupForTest(popup);
  });

  test('свайп с превышением DISMISS_THRESHOLD по смещению - animate-out', () => {
    const target = popup.querySelector('.content-text') as HTMLElement;
    dispatchTouchStartForTest({ clientX: 100, clientY: 500, target }, 0);
    dispatchTouchMoveForTest(
      { clientX: 100, clientY: 500 - (DISMISS_THRESHOLD + 10), target },
      300,
    );
    dispatchTouchEndForTest(400);
    expect(getStateForTest()).toBe('animating');
    expect(popup.classList.contains('svp-swipe-animating')).toBe(true);
  });

  test('flick-свайп (быстрый, малое смещение) - animate-out по velocity', () => {
    const target = popup.querySelector('.content-text') as HTMLElement;
    dispatchTouchStartForTest({ clientX: 100, clientY: 500, target }, 0);
    // Смещение 50px (меньше DISMISS_THRESHOLD=100) за 50мс -> velocity = 1.0
    // (больше VELOCITY_THRESHOLD=0.5).
    dispatchTouchMoveForTest({ clientX: 100, clientY: 450, target }, 30);
    dispatchTouchEndForTest(50);
    expect(getStateForTest()).toBe('animating');
  });

  test('недотянутый свайп - animate-back', () => {
    const target = popup.querySelector('.content-text') as HTMLElement;
    dispatchTouchStartForTest({ clientX: 100, clientY: 500, target }, 0);
    dispatchTouchMoveForTest({ clientX: 100, clientY: 480, target }, 200);
    dispatchTouchEndForTest(400);
    expect(getStateForTest()).toBe('animating');
    expect(popup.classList.contains('svp-swipe-animating')).toBe(true);
  });

  test('тап без движения - state idle (без анимации)', () => {
    const target = popup.querySelector('.content-text') as HTMLElement;
    dispatchTouchStartForTest({ clientX: 100, clientY: 500, target }, 0);
    dispatchTouchEndForTest(50);
    expect(getStateForTest()).toBe('idle');
  });

  test('animate-out -> transitionend -> клик .popup-close', async () => {
    const target = popup.querySelector('.content-text') as HTMLElement;
    const closeButton = popup.querySelector('.popup-close') as HTMLElement;
    const clickSpy = jest.spyOn(closeButton, 'click');
    dispatchTouchStartForTest({ clientX: 100, clientY: 500, target }, 0);
    dispatchTouchMoveForTest(
      { clientX: 100, clientY: 500 - (DISMISS_THRESHOLD + 20), target },
      300,
    );
    dispatchTouchEndForTest(400);
    // requestAnimationFrame ставит translate на следующем тике; в jsdom rAF
    // вызывается через setTimeout(0).
    await new Promise((resolve) => setTimeout(resolve, 0));
    // Эмулируем transitionend на самом popup-элементе.
    const evt = new Event('transitionend', { bubbles: false });
    Object.defineProperty(evt, 'target', { value: popup });
    popup.dispatchEvent(evt);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(getStateForTest()).toBe('idle');
  });

  test('safety-таймер закрывает попап если transitionend не пришёл', () => {
    jest.useFakeTimers();
    try {
      const target = popup.querySelector('.content-text') as HTMLElement;
      const closeButton = popup.querySelector('.popup-close') as HTMLElement;
      const clickSpy = jest.spyOn(closeButton, 'click');
      dispatchTouchStartForTest({ clientX: 100, clientY: 500, target }, 0);
      dispatchTouchMoveForTest(
        { clientX: 100, clientY: 500 - (DISMISS_THRESHOLD + 20), target },
        300,
      );
      dispatchTouchEndForTest(400);
      jest.advanceTimersByTime(ANIMATION_DURATION + 100);
      expect(clickSpy).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  test('тач, начавшийся в слайдере ядер, игнорируется', () => {
    const slide = popup.querySelector('.splide__slide') as HTMLElement;
    const closeButton = popup.querySelector('.popup-close') as HTMLElement;
    const clickSpy = jest.spyOn(closeButton, 'click');
    dispatchTouchStartForTest({ clientX: 100, clientY: 500, target: slide }, 0);
    expect(getStateForTest()).toBe('idle');
    dispatchTouchMoveForTest({ clientX: 100, clientY: 380, target: slide }, 100);
    dispatchTouchEndForTest(200);
    expect(clickSpy).not.toHaveBeenCalled();
  });
});

// ── enable / disable ─────────────────────────────────────────────────────────

describe('swipeToClosePopup enable/disable', () => {
  test('после enable popup получает 4 touch-listener', async () => {
    setupPopupDom();
    const popup = document.querySelector('.info') as HTMLElement;
    const addSpy = jest.spyOn(popup, 'addEventListener');
    await swipeToClosePopup.enable();
    const types = addSpy.mock.calls.map((call) => call[0]);
    expect(types).toContain('touchstart');
    expect(types).toContain('touchmove');
    expect(types).toContain('touchend');
    expect(types).toContain('touchcancel');
  });

  test('enable перетирает inline touch-action на pan-x', async () => {
    setupPopupDom();
    const popup = document.querySelector('.info') as HTMLElement;
    popup.style.touchAction = 'pan-y';
    await swipeToClosePopup.enable();
    expect(popup.style.touchAction).toBe('pan-x');
  });

  test('disable восстанавливает оригинальный touch-action', async () => {
    setupPopupDom();
    const popup = document.querySelector('.info') as HTMLElement;
    popup.style.touchAction = 'pan-y';
    await swipeToClosePopup.enable();
    await swipeToClosePopup.disable();
    expect(popup.style.touchAction).toBe('pan-y');
  });

  test('disable снимает все 4 touch-listener', async () => {
    setupPopupDom();
    const popup = document.querySelector('.info') as HTMLElement;
    const removeSpy = jest.spyOn(popup, 'removeEventListener');
    await swipeToClosePopup.enable();
    await swipeToClosePopup.disable();
    const types = removeSpy.mock.calls.map((call) => call[0]);
    expect(types).toContain('touchstart');
    expect(types).toContain('touchmove');
    expect(types).toContain('touchend');
    expect(types).toContain('touchcancel');
  });
});

// ── module metadata ──────────────────────────────────────────────────────────

describe('swipeToClosePopup metadata', () => {
  test('has correct id', () => {
    expect(swipeToClosePopup.id).toBe('swipeToClosePopup');
  });

  test('is enabled by default', () => {
    expect(swipeToClosePopup.defaultEnabled).toBe(true);
  });

  test('has localized name and description', () => {
    expect(swipeToClosePopup.name.ru).toBeTruthy();
    expect(swipeToClosePopup.name.en).toBeTruthy();
    expect(swipeToClosePopup.description.ru).toBeTruthy();
    expect(swipeToClosePopup.description.en).toBeTruthy();
  });
});
