import type { IFeatureModule } from '../../core/moduleRegistry';
import { $, injectStyles, removeStyles, waitForElement } from '../../core/dom';
import styles from './styles.css?inline';

const MODULE_ID = 'swipeToClosePopup';

const POPUP_SELECTOR = '.info';

/** Минимальное смещение для определения направления жеста (px). */
const DIRECTION_THRESHOLD = 10;
/** Минимальное вертикальное смещение для закрытия попапа (px). */
const DISMISS_THRESHOLD = 100;
/** Минимальная скорость свайпа для закрытия (px/ms). */
const VELOCITY_THRESHOLD = 0.5;
/** Расстояние свайпа, при котором прозрачность достигает минимума (px). */
const OPACITY_DISTANCE = 250;
/** Длительность анимации (мс), должна совпадать с CSS transition в styles.css. */
const ANIMATION_DURATION = 300;
/** Запас по времени для подстраховки transitionend (мс). */
const ANIMATION_SAFETY_MARGIN = 50;

type GestureState = 'idle' | 'tracking' | 'swiping' | 'animating';

let state: GestureState = 'idle';
let startX = 0;
let startY = 0;
let currentDeltaY = 0;
let startTimestamp = 0;
let popup: HTMLElement | null = null;
let savedTouchAction: string | null = null;
let safetyTimer: ReturnType<typeof setTimeout> | null = null;
let animationFrameId: number | null = null;
let classObserver: MutationObserver | null = null;
let lastObservedGuid: string | null = null;
let installGeneration = 0;

const CORES_SLIDER_ANCESTOR_SELECTORS = ['.deploy-slider-wrp', '.splide', '#cores-list'];

export function isWithinCoresSlider(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  for (const selector of CORES_SLIDER_ANCESTOR_SELECTORS) {
    if (target.closest(selector)) return true;
  }
  return false;
}

/**
 * Применить смещение по Y и opacity через отдельное CSS-свойство `translate`.
 * Оно composес с существующим transform попапа (центрирование), не перезаписывая
 * его. Без rotation - для вертикального жеста наклон карточки не подходит.
 */
function applySwipeStyles(element: HTMLElement, deltaY: number): void {
  const opacity = Math.max(0, 1 - Math.abs(deltaY) / OPACITY_DISTANCE);
  element.style.setProperty('translate', `0 ${String(deltaY)}px`);
  element.style.opacity = String(opacity);
}

function resetElementStyles(element: HTMLElement): void {
  element.style.removeProperty('translate');
  element.style.opacity = '';
  element.style.willChange = '';
  element.classList.remove('svp-swipe-animating');
}

function hasStaleSwipeStyles(element: HTMLElement): boolean {
  return (
    element.style.getPropertyValue('translate') !== '' ||
    element.style.opacity !== '' ||
    element.classList.contains('svp-swipe-animating')
  );
}

function clearSafetyTimer(): void {
  if (safetyTimer !== null) {
    clearTimeout(safetyTimer);
    safetyTimer = null;
  }
}

function cancelAnimationFrameIfPending(): void {
  if (animationFrameId !== null) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
}

function cleanupAnimation(element: HTMLElement | null = popup): void {
  cancelAnimationFrameIfPending();
  clearSafetyTimer();
  if (element) resetElementStyles(element);
  state = 'idle';
}

function startPopupObserver(): void {
  if (!popup) return;
  stopPopupObserver();
  lastObservedGuid = popup.dataset.guid ?? null;

  classObserver = new MutationObserver((mutations) => {
    if (!popup) return;
    for (const mutation of mutations) {
      if (mutation.type !== 'attributes') continue;
      if (!(mutation.target instanceof HTMLElement)) continue;
      if (mutation.target !== popup) continue;

      if (mutation.attributeName === 'class') {
        const oldValue = mutation.oldValue ?? '';
        const wasHidden = /\bhidden\b/.test(oldValue);
        const isHidden = popup.classList.contains('hidden');
        // Реагируем на переход из hidden в не-hidden (открытие попапа на новой
        // точке): чистим остатки от незавершённого жеста, чтобы попап не
        // открылся со смещением/прозрачностью.
        if (!wasHidden || isHidden) continue;
        lastObservedGuid = popup.dataset.guid ?? null;
        if (state !== 'idle' || hasStaleSwipeStyles(popup)) cleanupAnimation(popup);
        continue;
      }

      if (mutation.attributeName === 'data-guid') {
        if (popup.classList.contains('hidden')) continue;
        const currentGuid = popup.dataset.guid ?? null;
        if (currentGuid === lastObservedGuid) continue;
        lastObservedGuid = currentGuid;
        if (state !== 'idle' || hasStaleSwipeStyles(popup)) cleanupAnimation(popup);
      }
    }
  });

  classObserver.observe(popup, {
    attributes: true,
    attributeFilter: ['class', 'data-guid'],
    attributeOldValue: true,
  });
}

function stopPopupObserver(): void {
  classObserver?.disconnect();
  classObserver = null;
}

/**
 * Финальная анимация-уехать: попап улетает наверх + opacity 0, после
 * transitionend (или таймаута) - close popup через клик .popup-close.
 */
function animateDismiss(): void {
  if (!popup) return;
  state = 'animating';

  const targetY = -window.innerHeight;
  const animatingElement = popup;

  animatingElement.classList.add('svp-swipe-animating');

  let finished = false;
  const onTransitionEnd = (event: TransitionEvent): void => {
    if (event.target !== animatingElement) return;
    finish();
  };

  const finish = (): void => {
    if (finished) return;
    finished = true;
    animatingElement.removeEventListener('transitionend', onTransitionEnd);
    cleanupAnimation(animatingElement);
    // Закрываем через игровую кнопку - оригинальный closePopup делает весь
    // нужный cleanup (popovers, info_cooldown/score таймеры, abort draw).
    const closeButton = animatingElement.querySelector('.popup-close');
    if (closeButton instanceof HTMLElement) {
      closeButton.click();
      if (animatingElement.classList.contains('hidden')) return;
    }
    // Fallback: просто прячем.
    animatingElement.classList.add('hidden');
    for (const toast of animatingElement.querySelectorAll('.toastify')) {
      toast.remove();
    }
  };

  animatingElement.addEventListener('transitionend', onTransitionEnd);
  safetyTimer = setTimeout(finish, ANIMATION_DURATION + ANIMATION_SAFETY_MARGIN);

  // requestAnimationFrame отделяет добавление animating-класса от смены translate:
  // браузер успевает зафиксировать стартовый стиль, тогда transition отрабатывает
  // от текущей позиции до targetY. Без rAF transition мог бы пропуститься.
  animationFrameId = requestAnimationFrame(() => {
    animationFrameId = null;
    applySwipeStyles(animatingElement, targetY);
  });
}

/** Анимация-вернуть попап на место (когда жест не дотянул до свайпа). */
function animateReturn(): void {
  if (!popup) return;
  state = 'animating';

  const animatingElement = popup;
  animatingElement.classList.add('svp-swipe-animating');

  let finished = false;
  const onTransitionEnd = (event: TransitionEvent): void => {
    if (event.target !== animatingElement) return;
    finish();
  };

  const finish = (): void => {
    if (finished) return;
    finished = true;
    animatingElement.removeEventListener('transitionend', onTransitionEnd);
    cleanupAnimation(animatingElement);
  };

  animatingElement.addEventListener('transitionend', onTransitionEnd);
  safetyTimer = setTimeout(finish, ANIMATION_DURATION + ANIMATION_SAFETY_MARGIN);

  animationFrameId = requestAnimationFrame(() => {
    animationFrameId = null;
    animatingElement.style.setProperty('translate', '0 0px');
    animatingElement.style.opacity = '1';
  });
}

function onTouchStart(event: TouchEvent): void {
  if (state === 'idle' && popup && hasStaleSwipeStyles(popup)) {
    cleanupAnimation(popup);
  }
  if (state !== 'idle') return;
  if (event.targetTouches.length !== 1) return;

  const target = event.target;
  if (!(target instanceof Node)) return;
  // Исключаем тачи на слайдере ядер (Splide) - там вертикальный жест за каруселью.
  const element = target instanceof Element ? target : target.parentElement;
  if (element && isWithinCoresSlider(element)) return;

  const touch = event.targetTouches[0];
  startX = touch.clientX;
  startY = touch.clientY;
  startTimestamp = event.timeStamp;
  currentDeltaY = 0;
  state = 'tracking';

  if (popup) popup.style.willChange = 'translate, opacity';
}

function onTouchMove(event: TouchEvent): void {
  if (state !== 'tracking' && state !== 'swiping') return;
  if (event.targetTouches.length !== 1) {
    if (popup) resetElementStyles(popup);
    state = 'idle';
    return;
  }

  const touch = event.targetTouches[0];
  const deltaX = touch.clientX - startX;
  const deltaY = touch.clientY - startY;

  if (state === 'tracking') {
    if (Math.max(Math.abs(deltaX), Math.abs(deltaY)) < DIRECTION_THRESHOLD) return;
    // Жест считается нашим только если вертикаль доминирует И направление - вверх.
    // Иначе (горизонталь, вертикаль вниз) - отдаём другим handler'ам.
    if (Math.abs(deltaY) > Math.abs(deltaX) && deltaY < 0) {
      state = 'swiping';
    } else {
      if (popup) popup.style.willChange = '';
      state = 'idle';
      return;
    }
  }

  // На swiping забираем жест у браузера: preventDefault не даст ему скроллить.
  // touch-action: pan-x на .info уже отдал нам вертикаль, но preventDefault
  // дублирует защиту на случай, если другие touchmove-handler'ы (Hammer)
  // что-то предпринимают.
  event.preventDefault();
  currentDeltaY = deltaY;
  if (popup) applySwipeStyles(popup, deltaY);
}

function onTouchEnd(event: TouchEvent): void {
  if (state === 'tracking') {
    if (popup) popup.style.willChange = '';
    state = 'idle';
    return;
  }
  if (state !== 'swiping') return;

  const elapsed = event.timeStamp - startTimestamp;
  const velocity = elapsed > 0 ? Math.abs(currentDeltaY) / elapsed : 0;

  // Закрываем, если пройден порог по смещению ИЛИ по скорости (быстрый flick
  // на коротком пути тоже считается свайпом). Только направление вверх:
  // currentDeltaY < 0.
  if (currentDeltaY < 0 && (-currentDeltaY > DISMISS_THRESHOLD || velocity > VELOCITY_THRESHOLD)) {
    animateDismiss();
  } else {
    animateReturn();
  }
}

function onTouchCancel(): void {
  if (state === 'tracking' || state === 'swiping' || state === 'animating') {
    cleanupAnimation();
  }
}

/** Тестовые хуки. */
export function dispatchTouchStartForTest(
  touch: { clientX: number; clientY: number; target: EventTarget | null },
  timeStamp: number,
): void {
  onTouchStart({
    targetTouches: [touch],
    timeStamp,
    target: touch.target,
    preventDefault: () => {},
  } as unknown as TouchEvent);
}
export function dispatchTouchMoveForTest(
  touch: { clientX: number; clientY: number; target: EventTarget | null },
  timeStamp: number,
): void {
  onTouchMove({
    targetTouches: [touch],
    timeStamp,
    target: touch.target,
    preventDefault: () => {},
  } as unknown as TouchEvent);
}
export function dispatchTouchEndForTest(timeStamp: number): void {
  onTouchEnd({
    targetTouches: [],
    timeStamp,
    preventDefault: () => {},
  } as unknown as TouchEvent);
}
export function setPopupForTest(element: HTMLElement | null): void {
  popup = element;
}
export function resetTrackingForTest(): void {
  state = 'idle';
  currentDeltaY = 0;
  clearSafetyTimer();
  cancelAnimationFrameIfPending();
}
export function getStateForTest(): GestureState {
  return state;
}
export {
  DIRECTION_THRESHOLD,
  DISMISS_THRESHOLD,
  VELOCITY_THRESHOLD,
  OPACITY_DISTANCE,
  ANIMATION_DURATION,
};

function addListeners(): void {
  if (!popup) return;
  popup.addEventListener('touchstart', onTouchStart, { passive: true });
  // passive: false на touchmove - чтобы preventDefault мог забрать жест у
  // браузера (запретить скролл и отказаться от pointercancel).
  popup.addEventListener('touchmove', onTouchMove, { passive: false });
  popup.addEventListener('touchend', onTouchEnd, { passive: true });
  popup.addEventListener('touchcancel', onTouchCancel, { passive: true });
}

function removeListeners(): void {
  if (!popup) return;
  popup.removeEventListener('touchstart', onTouchStart);
  popup.removeEventListener('touchmove', onTouchMove);
  popup.removeEventListener('touchend', onTouchEnd);
  popup.removeEventListener('touchcancel', onTouchCancel);
}

function applyTouchActionOverride(element: HTMLElement): void {
  // Игра ставит inline `touch-action: pan-y` (для горизонтального Hammer'а).
  // Нам нужна обратная политика: pan-x (отдаём горизонталь скроллу/Hammer'у,
  // забираем вертикаль). Inline-стиль перебьёт CSS-rule, поэтому override-им
  // через JS, сохранив оригинальное значение для restore на disable.
  savedTouchAction = element.style.touchAction;
  element.style.touchAction = 'pan-x';
}

function restoreTouchAction(element: HTMLElement): void {
  if (savedTouchAction === null) return;
  element.style.touchAction = savedTouchAction;
  savedTouchAction = null;
}

export const swipeToClosePopup: IFeatureModule = {
  id: MODULE_ID,
  name: { en: 'Swipe to close popup', ru: 'Свайп для закрытия попапа' },
  description: {
    en: 'Closes the point popup with a swipe up gesture: the popup follows the finger, then animates off-screen on release. Anywhere inside the popup except the cores slider, where the swipe stays for the carousel.',
    ru: 'Закрывает попап точки жестом свайпа вверх: попап едет за пальцем и при отпускании плавно улетает наверх. Работает по всему попапу кроме слайдера ядер, где свайп остаётся за каруселью.',
  },
  defaultEnabled: true,
  category: 'feature',
  init() {},
  enable() {
    installGeneration++;
    const myGeneration = installGeneration;
    injectStyles(styles, MODULE_ID);
    const immediate = $(POPUP_SELECTOR);
    if (immediate instanceof HTMLElement) {
      popup = immediate;
      applyTouchActionOverride(popup);
      addListeners();
      startPopupObserver();
      return;
    }
    void waitForElement(POPUP_SELECTOR).then((element) => {
      if (myGeneration !== installGeneration) return;
      if (!(element instanceof HTMLElement)) return;
      popup = element;
      applyTouchActionOverride(popup);
      addListeners();
      startPopupObserver();
    });
  },
  disable() {
    installGeneration++;
    removeListeners();
    stopPopupObserver();
    cleanupAnimation();
    if (popup) restoreTouchAction(popup);
    removeStyles(MODULE_ID);
    lastObservedGuid = null;
    popup = null;
  },
};
