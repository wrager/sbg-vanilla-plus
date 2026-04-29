import {
  DIRECTION_THRESHOLD,
  DISMISS_THRESHOLD,
  dispatchTouchEndForTest,
  dispatchTouchMoveForTest,
  dispatchTouchStartForTest,
  getStateForTest,
  resetForTest,
  setPopupForTest,
} from '../../core/popupSwipe';
import { isWithinCoresSlider, swipeToClosePopup } from './swipeToClosePopup';

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
  resetForTest();
  setPopupForTest(null);
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

// ── интеграция модуля с core/popupSwipe ──────────────────────────────────────

describe('swipeToClosePopup интеграция с core/popupSwipe', () => {
  test('enable: touch-action на попапе становится none, регистрируется направление up', async () => {
    setupPopupDom();
    const popup = document.querySelector('.info') as HTMLElement;
    popup.style.touchAction = 'pan-y';

    await swipeToClosePopup.enable();

    expect(popup.style.touchAction).toBe('none');

    // direction='up' зарегистрирован: touchstart + туч движение вверх -> tracking, swiping.
    setPopupForTest(popup);
    const target = popup.querySelector('.content-text') as HTMLElement;
    dispatchTouchStartForTest({ clientX: 100, clientY: 500, target }, 0);
    expect(getStateForTest().state).toBe('tracking');
    dispatchTouchMoveForTest({ clientX: 100, clientY: 500 - DIRECTION_THRESHOLD - 1, target }, 50);
    expect(getStateForTest().state).toBe('swiping');
    expect(getStateForTest().activeDirection).toBe('up');
  });

  test('disable: touch-action восстанавливается, direction=up снимается', async () => {
    setupPopupDom();
    const popup = document.querySelector('.info') as HTMLElement;
    popup.style.touchAction = 'pan-y';

    await swipeToClosePopup.enable();
    await swipeToClosePopup.disable();

    expect(popup.style.touchAction).toBe('pan-y');

    // После disable swipe вверх не должен трогать handler (decide/finalize не вызовутся).
    setPopupForTest(popup);
    const target = popup.querySelector('.content-text') as HTMLElement;
    dispatchTouchStartForTest({ clientX: 100, clientY: 500, target }, 0);
    // Нет registered direction -> idle.
    expect(getStateForTest().state).toBe('idle');
  });

  test('свайп вверх через popupSwipe вызывает popup-close.click() (finalize)', async () => {
    setupPopupDom();
    const popup = document.querySelector('.info') as HTMLElement;
    const closeButton = popup.querySelector('.popup-close') as HTMLElement;
    const clickSpy = jest.spyOn(closeButton, 'click');

    await swipeToClosePopup.enable();
    setPopupForTest(popup);

    const target = popup.querySelector('.content-text') as HTMLElement;
    dispatchTouchStartForTest({ clientX: 100, clientY: 500, target }, 0);
    dispatchTouchMoveForTest(
      { clientX: 100, clientY: 500 - (DISMISS_THRESHOLD + 20), target },
      300,
    );
    dispatchTouchEndForTest(400);

    // requestAnimationFrame в jsdom через setTimeout(0).
    await new Promise((resolve) => setTimeout(resolve, 0));
    // Эмулируем transitionend - core вызовет finalize().
    const evt = new Event('transitionend', { bubbles: false });
    Object.defineProperty(evt, 'target', { value: popup });
    popup.dispatchEvent(evt);

    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  test('canStart-фильтр: жест внутри cores-slider не активирует свайп', async () => {
    setupPopupDom();
    const popup = document.querySelector('.info') as HTMLElement;
    await swipeToClosePopup.enable();
    setPopupForTest(popup);

    // Тач на slide. canStart возвращает false -> jest нет других зарегистрированных
    // direction-ов с canStart=true -> state остаётся idle.
    const slide = popup.querySelector('.splide__slide') as HTMLElement;
    dispatchTouchStartForTest({ clientX: 100, clientY: 500, target: slide }, 0);

    expect(getStateForTest().state).toBe('idle');
  });

  test('горизонтальный жест через popupSwipe не активирует up-handler (idle)', async () => {
    setupPopupDom();
    const popup = document.querySelector('.info') as HTMLElement;
    await swipeToClosePopup.enable();
    setPopupForTest(popup);

    const target = popup.querySelector('.content-text') as HTMLElement;
    dispatchTouchStartForTest({ clientX: 100, clientY: 500, target }, 0);
    // dx=100, dy=15 - dx доминирует, direction='right' не зарегистрирован -> idle.
    dispatchTouchMoveForTest({ clientX: 200, clientY: 515, target }, 50);

    expect(getStateForTest().state).toBe('idle');
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
