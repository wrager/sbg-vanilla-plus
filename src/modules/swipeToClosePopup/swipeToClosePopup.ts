import type { IFeatureModule } from '../../core/moduleRegistry';
import { $, injectStyles, removeStyles } from '../../core/dom';
import styles from './styles.css?inline';

const MODULE_ID = 'swipeToClosePopup';

const POPUP_SELECTOR = '.info.popup';

/** Минимальное смещение для определения направления жеста (px) */
const DIRECTION_THRESHOLD = 10;
/** Минимальное горизонтальное смещение для закрытия попапа (px) */
const DISMISS_THRESHOLD = 100;
/** Минимальная скорость свайпа для закрытия (px/ms) */
const VELOCITY_THRESHOLD = 0.5;
/** Максимальный угол поворота карточки при свайпе (градусы) */
const MAX_ROTATION = 8;
/** Расстояние свайпа, при котором прозрачность достигает минимума (px) */
const OPACITY_DISTANCE = 250;
/** Длительность анимации (мс), должна совпадать с CSS transition */
const ANIMATION_DURATION = 300;
/** Запас по времени для подстраховки transitionend (мс) */
const ANIMATION_SAFETY_MARGIN = 50;

type GestureState = 'idle' | 'tracking' | 'swiping' | 'animating';

let state: GestureState = 'idle';
let startX = 0;
let startY = 0;
let currentDeltaX = 0;
let startTimestamp = 0;
let popup: HTMLElement | null = null;
let safetyTimer: ReturnType<typeof setTimeout> | null = null;
let animationFrameId: number | null = null;
let classObserver: MutationObserver | null = null;
let lastObservedGuid: string | null = null;

/**
 * Применить смещение и поворот через отдельные CSS-свойства translate/rotate.
 * Они compose с существующим transform попапа (центрирование), не перезаписывая его.
 */
function applySwipeStyles(element: HTMLElement, deltaX: number): void {
  const rotation = (deltaX / window.innerWidth) * MAX_ROTATION;
  const opacity = Math.max(0, 1 - Math.abs(deltaX) / OPACITY_DISTANCE);
  element.style.setProperty('translate', `${deltaX}px`);
  element.style.setProperty('rotate', `${rotation}deg`);
  element.style.opacity = String(opacity);
}

function resetElementStyles(element: HTMLElement): void {
  element.style.removeProperty('translate');
  element.style.removeProperty('rotate');
  element.style.opacity = '';
  element.style.willChange = '';
  element.classList.remove('svp-swipe-animating');
}

function hasStaleSwipeStyles(element: HTMLElement): boolean {
  return (
    element.style.getPropertyValue('translate') !== '' ||
    element.style.getPropertyValue('rotate') !== '' ||
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

function animateDismiss(direction: number): void {
  if (!popup) return;
  state = 'animating';

  const targetX = direction > 0 ? window.innerWidth : -window.innerWidth;
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

    // Закрывать через игровую кнопку предпочтительнее:
    // это вызывает оригинальный closePopup со всем внутренним cleanup.
    const closeButton = animatingElement.querySelector('.popup-close');
    if (closeButton instanceof HTMLElement) {
      closeButton.click();
      if (animatingElement.classList.contains('hidden')) return;
    }

    // Fallback для нетипичной разметки без popup-close.
    animatingElement.classList.add('hidden');
    for (const toast of animatingElement.querySelectorAll('.toastify')) {
      toast.remove();
    }
  };

  animatingElement.addEventListener('transitionend', onTransitionEnd);
  safetyTimer = setTimeout(finish, ANIMATION_DURATION + ANIMATION_SAFETY_MARGIN);

  animationFrameId = requestAnimationFrame(() => {
    animationFrameId = null;
    applySwipeStyles(animatingElement, targetX);
  });
}

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
    animatingElement.style.setProperty('translate', '0px');
    animatingElement.style.setProperty('rotate', '0deg');
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

  // Исключить тачи на карусели простановки ядер (Splide)
  const element = target instanceof Element ? target : target.parentElement;
  if (element?.closest('.deploy-slider-wrp')) return;

  const touch = event.targetTouches[0];
  startX = touch.clientX;
  startY = touch.clientY;
  startTimestamp = event.timeStamp;
  currentDeltaX = 0;
  state = 'tracking';

  if (popup) {
    popup.style.willChange = 'translate, rotate, opacity';
  }
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

    if (Math.abs(deltaX) > Math.abs(deltaY)) {
      state = 'swiping';
    } else {
      // Вертикальный скролл — не перехватываем
      if (popup) popup.style.willChange = '';
      state = 'idle';
      return;
    }
  }

  event.preventDefault();
  currentDeltaX = deltaX;
  if (popup) applySwipeStyles(popup, deltaX);
}

function onTouchEnd(event: TouchEvent): void {
  if (state === 'tracking') {
    if (popup) popup.style.willChange = '';
    state = 'idle';
    return;
  }

  if (state !== 'swiping') return;

  const elapsed = event.timeStamp - startTimestamp;
  const velocity = elapsed > 0 ? Math.abs(currentDeltaX) / elapsed : 0;

  if (Math.abs(currentDeltaX) > DISMISS_THRESHOLD || velocity > VELOCITY_THRESHOLD) {
    animateDismiss(currentDeltaX > 0 ? 1 : -1);
  } else {
    animateReturn();
  }
}

function onTouchCancel(): void {
  if (state === 'tracking' || state === 'swiping' || state === 'animating') {
    cleanupAnimation();
  }
}

function addListeners(): void {
  if (!popup) return;
  popup.addEventListener('touchstart', onTouchStart, { passive: true });
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

export const swipeToClosePopup: IFeatureModule = {
  id: MODULE_ID,
  name: {
    en: 'Swipe to Close Popup',
    ru: 'Закрытие попапа свайпом',
  },
  description: {
    en: 'Swipe the point popup left or right to close it with a card swipe animation',
    ru: 'Свайп попапа точки влево или вправо закрывает его с анимацией смахивания',
  },
  defaultEnabled: true,
  category: 'ui',
  init() {},
  enable() {
    const element = $(POPUP_SELECTOR);
    if (!(element instanceof HTMLElement)) return;
    popup = element;
    injectStyles(styles, MODULE_ID);
    addListeners();
    startPopupObserver();
  },
  disable() {
    removeListeners();
    stopPopupObserver();
    cleanupAnimation();
    removeStyles(MODULE_ID);
    lastObservedGuid = null;
    popup = null;
  },
};
