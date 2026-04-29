import {
  ANIMATION_DURATION,
  ANIMATION_SAFETY_MARGIN,
  DIRECTION_THRESHOLD,
  DISMISS_THRESHOLD,
  OPACITY_DISTANCE,
  VELOCITY_THRESHOLD,
  dispatchMultiTouchMoveForTest,
  dispatchMultiTouchStartForTest,
  dispatchTouchCancelForTest,
  dispatchTouchEndForTest,
  dispatchTouchMoveForTest,
  dispatchTouchStartForTest,
  getStateForTest,
  installPopupSwipe,
  registerDirection,
  resetForTest,
  setPopupForTest,
  uninstallPopupSwipe,
  type ISwipeDirectionHandler,
  type SwipeDirection,
} from './popupSwipe';

function makePopup(extraClasses = ''): HTMLElement {
  const element = document.createElement('div');
  element.className = `info popup ${extraClasses}`.trim();
  element.dataset.guid = 'point-a';
  document.body.appendChild(element);
  return element;
}

interface IHandlerSpy {
  handler: ISwipeDirectionHandler;
  decideSpy: jest.Mock;
  finalizeSpy: jest.Mock;
  canStartSpy: jest.Mock | null;
}

function makeHandler(
  decideOutcome: 'dismiss' | 'return' = 'dismiss',
  canStart: ((event: TouchEvent) => boolean) | null = null,
): IHandlerSpy {
  const decideSpy: jest.Mock = jest.fn(() => decideOutcome);
  const finalizeSpy: jest.Mock = jest.fn();
  const canStartSpy: jest.Mock | null = canStart ? jest.fn(canStart) : null;
  return {
    handler: {
      decide: decideSpy as () => 'dismiss' | 'return',
      finalize: finalizeSpy as () => void,
      ...(canStartSpy ? { canStart: canStartSpy as (event: TouchEvent) => boolean } : {}),
    },
    decideSpy,
    finalizeSpy,
    canStartSpy,
  };
}

beforeEach(() => {
  document.body.innerHTML = '';
  resetForTest();
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
  resetForTest();
});

describe('registerDirection', () => {
  test('возвращает unregister, повторный register того же direction после unregister работает', () => {
    const popup = makePopup();
    setPopupForTest(popup);

    const a = makeHandler();
    const unregister = registerDirection('up', a.handler);
    unregister();

    const b = makeHandler();
    expect(() => registerDirection('up', b.handler)).not.toThrow();
  });

  test('двойная регистрация одного direction без unregister бросает', () => {
    const a = makeHandler();
    const b = makeHandler();
    registerDirection('up', a.handler);
    expect(() => registerDirection('up', b.handler)).toThrow(/уже зарегистрирован/);
  });
});

describe('idle -> tracking', () => {
  test('1 touch + один зарегистрированный direction: переход в tracking', () => {
    const popup = makePopup();
    setPopupForTest(popup);
    const up = makeHandler();
    registerDirection('up', up.handler);

    dispatchTouchStartForTest({ clientX: 100, clientY: 200, target: popup }, 0);

    expect(getStateForTest().state).toBe('tracking');
  });

  test('multi-touch: state остаётся idle', () => {
    const popup = makePopup();
    setPopupForTest(popup);
    registerDirection('up', makeHandler().handler);

    dispatchMultiTouchStartForTest(0);

    expect(getStateForTest().state).toBe('idle');
  });

  test('нет зарегистрированных handler: state остаётся idle', () => {
    const popup = makePopup();
    setPopupForTest(popup);

    dispatchTouchStartForTest({ clientX: 0, clientY: 0, target: popup }, 0);

    expect(getStateForTest().state).toBe('idle');
  });

  test('все canStart возвращают false: state остаётся idle', () => {
    const popup = makePopup();
    setPopupForTest(popup);
    const up = makeHandler('dismiss', () => false);
    registerDirection('up', up.handler);

    dispatchTouchStartForTest({ clientX: 0, clientY: 0, target: popup }, 0);

    expect(getStateForTest().state).toBe('idle');
  });

  test('хотя бы один canStart=true принимает touch', () => {
    const popup = makePopup();
    setPopupForTest(popup);
    registerDirection('up', makeHandler('dismiss', () => false).handler);
    registerDirection('left', makeHandler('dismiss', () => true).handler);

    dispatchTouchStartForTest({ clientX: 0, clientY: 0, target: popup }, 0);

    expect(getStateForTest().state).toBe('tracking');
  });
});

describe('tracking -> swiping', () => {
  test('delta пересекла DIRECTION_THRESHOLD в зарегистрированном направлении: swiping', () => {
    const popup = makePopup();
    setPopupForTest(popup);
    registerDirection('up', makeHandler().handler);

    dispatchTouchStartForTest({ clientX: 100, clientY: 200, target: popup }, 0);
    dispatchTouchMoveForTest(
      { clientX: 100, clientY: 200 - DIRECTION_THRESHOLD - 1, target: popup },
      50,
    );

    expect(getStateForTest().state).toBe('swiping');
    expect(getStateForTest().activeDirection).toBe('up');
  });

  test('движение в незарегистрированном направлении: idle', () => {
    const popup = makePopup();
    setPopupForTest(popup);
    registerDirection('up', makeHandler().handler);

    dispatchTouchStartForTest({ clientX: 100, clientY: 200, target: popup }, 0);
    // Тащим вниз - direction='down' не зарегистрирован.
    dispatchTouchMoveForTest(
      { clientX: 100, clientY: 200 + DIRECTION_THRESHOLD + 1, target: popup },
      50,
    );

    expect(getStateForTest().state).toBe('idle');
  });

  test('canStart handler-а возвращает false для этого touchmove: idle', () => {
    const popup = makePopup();
    setPopupForTest(popup);
    // canStart=true для touchstart, но false для touchmove (target поменялся).
    let canStartCallCount = 0;
    const up = makeHandler('dismiss', () => {
      canStartCallCount++;
      return canStartCallCount === 1;
    });
    registerDirection('up', up.handler);

    dispatchTouchStartForTest({ clientX: 100, clientY: 200, target: popup }, 0);
    expect(getStateForTest().state).toBe('tracking');
    dispatchTouchMoveForTest(
      { clientX: 100, clientY: 200 - DIRECTION_THRESHOLD - 1, target: popup },
      50,
    );

    expect(getStateForTest().state).toBe('idle');
  });
});

describe('swiping: applySwipeStyles', () => {
  function setupSwiping(direction: SwipeDirection): {
    popup: HTMLElement;
    setSpy: jest.SpyInstance;
  } {
    const popup = makePopup();
    setPopupForTest(popup);
    // jsdom не поддерживает чтение style.translate / getPropertyValue('translate')
    // даже после style.setProperty('translate', ...) - проверяем через spy
    // на сам setProperty, как в swipeToClosePopup.test.
    const setSpy = jest.spyOn(popup.style, 'setProperty');
    registerDirection(direction, makeHandler().handler);
    dispatchTouchStartForTest({ clientX: 100, clientY: 200, target: popup }, 0);
    return { popup, setSpy };
  }

  test('up: translate-Y отрицательный, opacity падает', () => {
    const { popup, setSpy } = setupSwiping('up');
    dispatchTouchMoveForTest({ clientX: 100, clientY: 200 - 50, target: popup }, 50);
    expect(setSpy).toHaveBeenCalledWith('translate', '0 -50px');
    expect(parseFloat(popup.style.opacity)).toBeCloseTo(1 - 50 / OPACITY_DISTANCE);
  });

  test('down: translate-Y положительный', () => {
    const { popup, setSpy } = setupSwiping('down');
    dispatchTouchMoveForTest({ clientX: 100, clientY: 200 + 50, target: popup }, 50);
    expect(setSpy).toHaveBeenCalledWith('translate', '0 50px');
  });

  test('left: translate-X отрицательный', () => {
    const { popup, setSpy } = setupSwiping('left');
    dispatchTouchMoveForTest({ clientX: 100 - 60, clientY: 200, target: popup }, 50);
    expect(setSpy).toHaveBeenCalledWith('translate', '-60px 0');
  });

  test('right: translate-X положительный', () => {
    const { popup, setSpy } = setupSwiping('right');
    dispatchTouchMoveForTest({ clientX: 100 + 60, clientY: 200, target: popup }, 50);
    expect(setSpy).toHaveBeenCalledWith('translate', '60px 0');
  });
});

describe('swiping -> animating', () => {
  function setupSwiping(direction: SwipeDirection, handler: IHandlerSpy): HTMLElement {
    const popup = makePopup();
    setPopupForTest(popup);
    registerDirection(direction, handler.handler);
    dispatchTouchStartForTest({ clientX: 100, clientY: 200, target: popup }, 0);
    return popup;
  }

  test('delta >= DISMISS_THRESHOLD + decide=dismiss: animating, finalize вызывается после transitionend', () => {
    const up = makeHandler('dismiss');
    const popup = setupSwiping('up', up);
    dispatchTouchMoveForTest(
      { clientX: 100, clientY: 200 - DISMISS_THRESHOLD - 1, target: popup },
      50,
    );
    dispatchTouchEndForTest(100);

    expect(up.decideSpy).toHaveBeenCalledTimes(1);
    expect(getStateForTest().state).toBe('animating');
    expect(up.finalizeSpy).not.toHaveBeenCalled();

    // Эмулируем transitionend.
    popup.dispatchEvent(new Event('transitionend'));
    expect(up.finalizeSpy).toHaveBeenCalledTimes(1);
    expect(getStateForTest().state).toBe('idle');
  });

  test('delta >= DISMISS_THRESHOLD + decide=return: animating, finalize НЕ вызывается', () => {
    const up = makeHandler('return');
    const popup = setupSwiping('up', up);
    dispatchTouchMoveForTest(
      { clientX: 100, clientY: 200 - DISMISS_THRESHOLD - 1, target: popup },
      50,
    );
    dispatchTouchEndForTest(100);

    expect(up.decideSpy).toHaveBeenCalledTimes(1);
    expect(getStateForTest().state).toBe('animating');

    popup.dispatchEvent(new Event('transitionend'));
    expect(up.finalizeSpy).not.toHaveBeenCalled();
    expect(getStateForTest().state).toBe('idle');
  });

  test('delta < threshold + velocity мала: animateReturn, decide НЕ вызывается', () => {
    const up = makeHandler('dismiss');
    const popup = setupSwiping('up', up);
    dispatchTouchMoveForTest(
      { clientX: 100, clientY: 200 - DIRECTION_THRESHOLD - 5, target: popup },
      // Большой elapsed -> velocity мала.
      1000,
    );
    dispatchTouchEndForTest(2000);

    expect(up.decideSpy).not.toHaveBeenCalled();
    expect(getStateForTest().state).toBe('animating');

    popup.dispatchEvent(new Event('transitionend'));
    expect(up.finalizeSpy).not.toHaveBeenCalled();
    expect(getStateForTest().state).toBe('idle');
  });

  test('velocity > VELOCITY_THRESHOLD при малой delta: dismiss', () => {
    const up = makeHandler('dismiss');
    const popup = setupSwiping('up', up);
    // delta=20px (< DISMISS_THRESHOLD=100), но за 10мс -> velocity=2 (>0.5).
    dispatchTouchMoveForTest({ clientX: 100, clientY: 180, target: popup }, 5);
    dispatchTouchEndForTest(10);

    expect(getStateForTest().state).toBe('animating');
    const elapsed = 10 - 0;
    const velocity = 20 / elapsed;
    expect(velocity).toBeGreaterThan(VELOCITY_THRESHOLD);
    expect(up.decideSpy).toHaveBeenCalledTimes(1);
  });

  test('safety timer добивает animation, если transitionend не пришёл', () => {
    const up = makeHandler('dismiss');
    const popup = setupSwiping('up', up);
    dispatchTouchMoveForTest(
      { clientX: 100, clientY: 200 - DISMISS_THRESHOLD - 1, target: popup },
      50,
    );
    dispatchTouchEndForTest(100);

    jest.advanceTimersByTime(ANIMATION_DURATION + ANIMATION_SAFETY_MARGIN + 10);

    expect(up.finalizeSpy).toHaveBeenCalledTimes(1);
    expect(getStateForTest().state).toBe('idle');
  });
});

describe('multi-touch / cancel посреди swiping', () => {
  test('multi-touch посреди swiping: state -> idle с reset styles', () => {
    const popup = makePopup();
    setPopupForTest(popup);
    const removeSpy = jest.spyOn(popup.style, 'removeProperty');
    registerDirection('up', makeHandler().handler);
    dispatchTouchStartForTest({ clientX: 100, clientY: 200, target: popup }, 0);
    dispatchTouchMoveForTest({ clientX: 100, clientY: 100, target: popup }, 50);
    expect(getStateForTest().state).toBe('swiping');

    dispatchMultiTouchMoveForTest(60);

    expect(getStateForTest().state).toBe('idle');
    // resetElementStyles делает removeProperty('translate') и opacity=''.
    expect(removeSpy).toHaveBeenCalledWith('translate');
    expect(popup.style.opacity).toBe('');
  });

  test('touchcancel посреди swiping -> animateReturn', () => {
    const popup = makePopup();
    setPopupForTest(popup);
    const up = makeHandler('dismiss');
    registerDirection('up', up.handler);
    dispatchTouchStartForTest({ clientX: 100, clientY: 200, target: popup }, 0);
    dispatchTouchMoveForTest({ clientX: 100, clientY: 100, target: popup }, 50);
    expect(getStateForTest().state).toBe('swiping');

    dispatchTouchCancelForTest();
    expect(getStateForTest().state).toBe('animating');

    popup.dispatchEvent(new Event('transitionend'));
    expect(up.finalizeSpy).not.toHaveBeenCalled();
    expect(getStateForTest().state).toBe('idle');
  });
});

describe('install / uninstall lifecycle', () => {
  test('install ставит touch-action: none, uninstall возвращает оригинальное', () => {
    const popup = makePopup();
    popup.style.touchAction = 'pan-y';

    installPopupSwipe('.info.popup');
    expect(popup.style.touchAction).toBe('none');

    uninstallPopupSwipe();
    expect(popup.style.touchAction).toBe('pan-y');
  });

  test('повторный install сохраняет оригинальный touch-action для последующего uninstall', () => {
    const popup = makePopup();
    popup.style.touchAction = 'pan-y';

    installPopupSwipe('.info.popup');
    // Повторный install не должен перезаписать сохранённый pan-y текущим
    // 'none' от нашего же предыдущего install.
    installPopupSwipe('.info.popup');
    uninstallPopupSwipe();
    expect(popup.style.touchAction).toBe('pan-y');
  });

  test('install подключает listeners, после uninstall touchstart на popup state не меняет', () => {
    const popup = makePopup();
    installPopupSwipe('.info.popup');
    registerDirection('up', makeHandler().handler);

    const touchEvent = new Event('touchstart', { bubbles: true }) as unknown as TouchEvent;
    Object.defineProperty(touchEvent, 'targetTouches', {
      value: [{ clientX: 100, clientY: 200, target: popup }],
    });
    Object.defineProperty(touchEvent, 'timeStamp', { value: 0 });
    Object.defineProperty(touchEvent, 'preventDefault', { value: () => {} });
    popup.dispatchEvent(touchEvent);
    expect(getStateForTest().state).toBe('tracking');

    // Сбрасываем state чтобы проверить, что после uninstall listener больше не дёрнется.
    resetForTest();
    installPopupSwipe('.info.popup');
    uninstallPopupSwipe();
    registerDirection('up', makeHandler().handler);

    const touchEvent2 = new Event('touchstart', { bubbles: true }) as unknown as TouchEvent;
    Object.defineProperty(touchEvent2, 'targetTouches', {
      value: [{ clientX: 100, clientY: 200, target: popup }],
    });
    Object.defineProperty(touchEvent2, 'timeStamp', { value: 0 });
    Object.defineProperty(touchEvent2, 'preventDefault', { value: () => {} });
    popup.dispatchEvent(touchEvent2);

    expect(getStateForTest().state).toBe('idle');
  });
});

describe('popup observer', () => {
  test('переход hidden -> visible с другим guid: state -> idle с reset styles', () => {
    const popup = makePopup('hidden');
    document.body.appendChild(popup);
    installPopupSwipe('.info.popup');

    const up = makeHandler('dismiss');
    registerDirection('up', up.handler);

    // Имитируем stale styles (как от прерванного жеста).
    popup.style.setProperty('translate', '0 -50px');
    popup.style.opacity = '0.5';
    popup.classList.add('svp-swipe-animating');

    // Открываем попап заново на новой точке.
    popup.classList.remove('hidden');
    popup.dataset.guid = 'point-b';

    // Observer асинхронный - даём микротик обработать.
    return Promise.resolve().then(() => {
      expect(popup.style.getPropertyValue('translate')).toBe('');
      expect(popup.style.opacity).toBe('');
      expect(popup.classList.contains('svp-swipe-animating')).toBe(false);
    });
  });
});
