/**
 * Общая инфраструктура свайп-жестов на попапе точки игры (`.info`). Выносит из
 * модулей-потребителей дублирование state machine и анимаций.
 *
 * Модули регистрируют направление (`up`/`down`/`left`/`right`) и handler, который:
 *  - решает, можно ли начать жест на конкретном touch-target (`canStart`),
 *  - на touchend после успешного жеста возвращает решение dismiss/return,
 *  - при dismiss финализирует действие после завершения CSS-transition.
 *
 * State machine, общие константы и анимации живут здесь; модули не управляют
 * touch-listener'ами и стилями попапа напрямую. Это исключает класс ошибок,
 * когда два модуля параллельно вешают listener'ы на один элемент и
 * `preventDefault` одного отнимает жест у другого. Сейчас единственный
 * потребитель - swipeToClosePopup (`up`); ref-counter в install/uninstall
 * сохранён для безопасного добавления других модулей в будущем.
 */

import { $, waitForElement } from './dom';

export type SwipeDirection = 'up' | 'down' | 'left' | 'right';
export type SwipeOutcome = 'dismiss' | 'return';

export interface ISwipeDirectionHandler {
  /**
   * Фильтр по target: может ли начаться жест в этом направлении на конкретном
   * touchstart-event. Используется например в swipeToClosePopup для исключения
   * cores-slider, где вертикаль за каруселью. Если хоть один зарегистрированный
   * handler вернул true - state переходит в tracking. Если все вернули false -
   * жест не наш, отдаём другим listener'ам.
   */
  canStart?: (event: TouchEvent) => boolean;
  /**
   * Жест прошёл threshold (по delta или velocity). Решает, что делать:
   *  - 'dismiss' - попап улетает в направлении свайпа, после animationend
   *    вызывается finalize().
   *  - 'return' - попап возвращается на исходную позицию, finalize() не вызывается.
   *
   * Sync (не Promise), чтобы анимация началась без задержки и пользователь
   * получал моментальную обратную связь. Если handler'у нужна async-работа -
   * её следует делать в finalize() ПОСЛЕ dismiss-анимации.
   */
  decide: () => SwipeOutcome;
  /**
   * Вызывается после dismiss-анимации (transitionend). Здесь handler закрывает
   * попап / открывает следующую точку / выполняет POST. Для 'return' не
   * вызывается - попап остаётся как был.
   */
  finalize: () => void;
  /**
   * Длительность dismiss/return-анимации (мс). По умолчанию ANIMATION_DURATION = 300.
   * Применяется только когда жест прошёл через handler этого direction'а;
   * другие direction'ы используют свои значения (или дефолт).
   */
  animationDurationMs?: number;
}

/** Минимальное смещение (px), после которого направление считается определённым. */
export const DIRECTION_THRESHOLD = 10;
/** Минимальное смещение (px) для commit жеста как dismiss-кандидата. */
export const DISMISS_THRESHOLD = 100;
/** Минимальная скорость (px/ms) для commit жеста как dismiss-кандидата (даже при малой delta). */
export const VELOCITY_THRESHOLD = 0.5;
/** Расстояние, при котором opacity достигает 0 во время drag. */
export const OPACITY_DISTANCE = 250;
/** Длительность CSS-transition в animateDismiss/animateReturn (мс). Совпадает со styles.css. */
export const ANIMATION_DURATION = 300;
/** Запас по времени для подстраховки transitionend (мс). */
export const ANIMATION_SAFETY_MARGIN = 50;

const ANIMATING_CLASS = 'svp-swipe-animating';

type GestureState = 'idle' | 'tracking' | 'swiping' | 'animating';

const directionHandlers = new Map<SwipeDirection, ISwipeDirectionHandler>();

let popup: HTMLElement | null = null;
let savedTouchAction: string | null = null;
let installGeneration = 0;
// Ref-count установок: несколько модулей могут параллельно вызывать
// install/uninstall в своих enable/disable. Без счётчика disable одного модуля
// сорвал бы listener'ы другого. Реальный attach происходит только при первом
// install (refs 0->1), реальный detach - только при последнем uninstall
// (refs 1->0).
let installRefs = 0;

let state: GestureState = 'idle';
let activeDirection: SwipeDirection | null = null;
let startX = 0;
let startY = 0;
let currentDelta = 0;
let startTimestamp = 0;
let safetyTimer: ReturnType<typeof setTimeout> | null = null;
let animationFrameId: number | null = null;
let classObserver: MutationObserver | null = null;
let lastObservedGuid: string | null = null;

/**
 * Регистрирует handler на конкретное направление. Возвращает функцию
 * unregistration. Если на это направление уже есть handler - бросает: два
 * хозяина у одного направления указывают на ошибку проектирования модулей.
 */
export function registerDirection(
  direction: SwipeDirection,
  handler: ISwipeDirectionHandler,
): () => void {
  if (directionHandlers.has(direction)) {
    throw new Error(`popupSwipe: direction "${direction}" уже зарегистрирован`);
  }
  directionHandlers.set(direction, handler);
  return () => {
    if (directionHandlers.get(direction) === handler) {
      directionHandlers.delete(direction);
      if (activeDirection === direction) cleanupAnimation();
    }
  };
}

/**
 * Соответствие "доминирующая ось + знак delta" -> direction. Если |dy| > |dx|,
 * direction по вертикали; иначе по горизонтали. Знак выбирает up/down или left/right.
 */
function classifyDirection(dx: number, dy: number): SwipeDirection | null {
  if (Math.max(Math.abs(dx), Math.abs(dy)) < DIRECTION_THRESHOLD) return null;
  if (Math.abs(dy) > Math.abs(dx)) {
    return dy < 0 ? 'up' : 'down';
  }
  return dx < 0 ? 'left' : 'right';
}

function deltaForDirection(dx: number, dy: number, direction: SwipeDirection): number {
  switch (direction) {
    case 'up':
      return -dy;
    case 'down':
      return dy;
    case 'left':
      return -dx;
    case 'right':
      return dx;
  }
}

function applySwipeStyles(element: HTMLElement, direction: SwipeDirection, delta: number): void {
  const opacity = Math.max(0, 1 - Math.abs(delta) / OPACITY_DISTANCE);
  const signed = Math.max(0, delta);
  const translate =
    direction === 'up'
      ? `0 ${String(-signed)}px`
      : direction === 'down'
        ? `0 ${String(signed)}px`
        : direction === 'left'
          ? `${String(-signed)}px 0`
          : `${String(signed)}px 0`;
  element.style.setProperty('translate', translate);
  element.style.opacity = String(opacity);
}

function resetElementStyles(element: HTMLElement): void {
  element.style.removeProperty('translate');
  element.style.opacity = '';
  element.style.willChange = '';
  element.style.removeProperty('transition-duration');
  element.classList.remove(ANIMATING_CLASS);
}

function hasStaleSwipeStyles(element: HTMLElement): boolean {
  return (
    element.style.getPropertyValue('translate') !== '' ||
    element.style.opacity !== '' ||
    element.classList.contains(ANIMATING_CLASS)
  );
}

function getAnimationDurationForDirection(direction: SwipeDirection | null): number {
  if (!direction) return ANIMATION_DURATION;
  const handler = directionHandlers.get(direction);
  return handler?.animationDurationMs ?? ANIMATION_DURATION;
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
  activeDirection = null;
}

function targetTranslateForDismiss(direction: SwipeDirection): string {
  switch (direction) {
    case 'up':
      return `0 ${String(-window.innerHeight)}px`;
    case 'down':
      return `0 ${String(window.innerHeight)}px`;
    case 'left':
      return `${String(-window.innerWidth)}px 0`;
    case 'right':
      return `${String(window.innerWidth)}px 0`;
  }
}

function animateDismiss(direction: SwipeDirection, finalize: () => void): void {
  if (!popup) return;
  state = 'animating';
  const animatingElement = popup;
  const duration = getAnimationDurationForDirection(direction);
  // Inline transition-duration перебивает CSS-rule (по специфичности),
  // позволяя per-handler настройку длительности без дублирования CSS-классов.
  // CSS-rule в styles.css задаёт сам факт transition (на translate и opacity),
  // мы только меняем длительность.
  animatingElement.style.setProperty('transition-duration', `${String(duration)}ms`);
  animatingElement.classList.add(ANIMATING_CLASS);

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
    finalize();
  };

  animatingElement.addEventListener('transitionend', onTransitionEnd);
  safetyTimer = setTimeout(finish, duration + ANIMATION_SAFETY_MARGIN);

  // requestAnimationFrame отделяет добавление animating-класса от смены translate:
  // браузер успевает зафиксировать стартовый стиль, тогда transition отрабатывает
  // от текущей позиции до target. Без rAF transition мог бы пропуститься.
  animationFrameId = requestAnimationFrame(() => {
    animationFrameId = null;
    animatingElement.style.setProperty('translate', targetTranslateForDismiss(direction));
    animatingElement.style.opacity = '0';
  });
}

function animateReturn(): void {
  if (!popup) return;
  state = 'animating';
  const animatingElement = popup;
  // Длительность return берём по тому же direction, что был активен в swiping
  // (handler этого direction'а контролирует обе ветки своей анимации).
  const duration = getAnimationDurationForDirection(activeDirection);
  animatingElement.style.setProperty('transition-duration', `${String(duration)}ms`);
  animatingElement.classList.add(ANIMATING_CLASS);

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
  safetyTimer = setTimeout(finish, duration + ANIMATION_SAFETY_MARGIN);

  animationFrameId = requestAnimationFrame(() => {
    animationFrameId = null;
    animatingElement.style.setProperty('translate', '0 0');
    animatingElement.style.opacity = '1';
  });
}

function onTouchStart(event: TouchEvent): void {
  if (state === 'idle' && popup && hasStaleSwipeStyles(popup)) {
    cleanupAnimation(popup);
  }
  if (state !== 'idle') return;
  if (event.targetTouches.length !== 1) return;
  if (directionHandlers.size === 0) return;

  // Хотя бы один зарегистрированный handler должен пропустить touch (canStart=true
  // или отсутствует). Если все отказались - жест не наш. Без этой проверки
  // touchstart на cores-slider начинал бы tracking, и мы бы перетягивали
  // вертикальный pan к свайпу закрытия.
  let anyAccepts = false;
  for (const handler of directionHandlers.values()) {
    if (!handler.canStart || handler.canStart(event)) {
      anyAccepts = true;
      break;
    }
  }
  if (!anyAccepts) return;

  const touch = event.targetTouches[0];
  startX = touch.clientX;
  startY = touch.clientY;
  startTimestamp = event.timeStamp;
  currentDelta = 0;
  state = 'tracking';

  if (popup) popup.style.willChange = 'translate, opacity';
}

function onTouchMove(event: TouchEvent): void {
  if (state !== 'tracking' && state !== 'swiping') return;
  if (event.targetTouches.length !== 1) {
    if (popup) resetElementStyles(popup);
    state = 'idle';
    activeDirection = null;
    return;
  }

  const touch = event.targetTouches[0];
  const dx = touch.clientX - startX;
  const dy = touch.clientY - startY;

  if (state === 'tracking') {
    const direction = classifyDirection(dx, dy);
    if (!direction) return;
    const handler = directionHandlers.get(direction);
    // Direction не зарегистрировано или handler специально отказался от
    // этого touch: жест не наш, отпускаем для других listener'ов и браузера.
    if (!handler || (handler.canStart && !handler.canStart(event))) {
      if (popup) popup.style.willChange = '';
      state = 'idle';
      return;
    }
    activeDirection = direction;
    state = 'swiping';
  }

  if (!activeDirection) return;
  // На swiping забираем жест у браузера: preventDefault не даст ему скроллить
  // и отдавать pointercancel другим Hammer-recognizer'ам. Проверяем cancelable -
  // браузер делает event non-cancelable если уже начал обрабатывать touch как
  // скролл (типичный сценарий: свайп вверх в попапе с прокручиваемым контентом
  // - браузер успевает решить скроллить и сделать последующие touchmove
  // non-cancelable до нашего state=swiping). Без проверки spam'ит [Intervention]
  // в консоли по 13-15 ошибок за одну серию touchmove.
  if (event.cancelable) {
    event.preventDefault();
  }
  const delta = deltaForDirection(dx, dy, activeDirection);
  currentDelta = delta;
  if (popup) applySwipeStyles(popup, activeDirection, delta);
}

function onTouchEnd(event: TouchEvent): void {
  if (state === 'tracking') {
    if (popup) popup.style.willChange = '';
    state = 'idle';
    return;
  }
  if (state !== 'swiping' || !activeDirection) return;

  const elapsed = event.timeStamp - startTimestamp;
  const velocity = elapsed > 0 ? Math.abs(currentDelta) / elapsed : 0;
  const direction = activeDirection;
  const handler = directionHandlers.get(direction);

  // delta < threshold И velocity мала - это незавершённый жест, не спрашиваем
  // handler, сразу animateReturn. Это выгружает handler'у заботу различать
  // "пользователь передумал" от "следующей точки нет" - первое решает core.
  const passedThreshold = currentDelta >= DISMISS_THRESHOLD || velocity >= VELOCITY_THRESHOLD;
  if (!passedThreshold || !handler) {
    animateReturn();
    return;
  }

  const outcome = handler.decide();
  if (outcome === 'dismiss') {
    animateDismiss(direction, () => {
      handler.finalize();
    });
  } else {
    animateReturn();
  }
}

function onTouchCancel(): void {
  if (state === 'tracking') {
    if (popup) popup.style.willChange = '';
    state = 'idle';
    activeDirection = null;
    return;
  }
  if (state === 'swiping') {
    animateReturn();
  }
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
        // Реагируем на переход hidden -> visible: попап открыли заново на
        // другой точке, чистим остатки незавершённого жеста.
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

function attachListeners(): void {
  if (!popup) return;
  popup.addEventListener('touchstart', onTouchStart, { passive: true });
  // passive: false на touchmove - чтобы preventDefault мог забрать жест у
  // браузера (запретить скролл и отказаться от pointercancel в Hammer).
  popup.addEventListener('touchmove', onTouchMove, { passive: false });
  popup.addEventListener('touchend', onTouchEnd, { passive: true });
  popup.addEventListener('touchcancel', onTouchCancel, { passive: true });
}

function detachListeners(): void {
  if (!popup) return;
  popup.removeEventListener('touchstart', onTouchStart);
  popup.removeEventListener('touchmove', onTouchMove);
  popup.removeEventListener('touchend', onTouchEnd);
  popup.removeEventListener('touchcancel', onTouchCancel);
}

function applyTouchActionOverride(element: HTMLElement): void {
  // Игра ставит inline `touch-action: pan-y` (для горизонтального Hammer'а).
  // Под нашим контролем теперь обе оси - touch-action: none. Inline-стиль
  // перебивает CSS-rule по специфичности, поэтому override через JS, сохраняя
  // оригинальное значение для restore на uninstall.
  //
  // savedTouchAction записывается только при первом вызове: повторный
  // installPopupSwipe иначе бы перезаписал сохранённый pan-y текущим 'none' от
  // нашего же предыдущего install, и uninstall вернул бы 'none' вместо
  // pan-y. Идемпотентность важна для cycles enable -> install -> install.
  if (savedTouchAction === null) {
    savedTouchAction = element.style.touchAction;
  }
  element.style.touchAction = 'none';
}

function restoreTouchAction(element: HTMLElement): void {
  if (savedTouchAction === null) return;
  element.style.touchAction = savedTouchAction;
  savedTouchAction = null;
}

/**
 * Подключает touch-listener'ы и observer к попапу. Если попап ещё не в DOM,
 * ждёт через `waitForElement`. Идемпотентен через ref-counter: реальный
 * attach происходит только при первом install (refs 0->1), последующие
 * вызовы только инкрементируют счётчик.
 */
export function installPopupSwipe(selector: string): void {
  installRefs++;
  if (installRefs > 1) return;
  installGeneration++;
  const myGeneration = installGeneration;
  const immediate = $(selector);
  if (immediate instanceof HTMLElement) {
    popup = immediate;
    applyTouchActionOverride(popup);
    attachListeners();
    startPopupObserver();
    return;
  }
  void waitForElement(selector).then((element) => {
    if (myGeneration !== installGeneration) return;
    if (!(element instanceof HTMLElement)) return;
    popup = element;
    applyTouchActionOverride(popup);
    attachListeners();
    startPopupObserver();
  });
}

/**
 * Снимает touch-listener'ы и observer. Зарегистрированные direction-handler'ы
 * НЕ очищаются - модули отвечают за свою регистрацию через unregister-функцию.
 *
 * Реальный detach происходит только при последнем uninstall (refs 1->0),
 * чтобы выгрузка одного модуля не сорвала listener'ы другого, продолжающего
 * жить. Дисбаланс install/uninstall (счётчик ушёл бы в минус) клампится в 0.
 */
export function uninstallPopupSwipe(): void {
  if (installRefs <= 0) return;
  installRefs--;
  if (installRefs > 0) return;
  installGeneration++;
  detachListeners();
  stopPopupObserver();
  cleanupAnimation();
  if (popup) restoreTouchAction(popup);
  lastObservedGuid = null;
  popup = null;
}

// ── Test hooks ───────────────────────────────────────────────────────────────

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
  options: { cancelable?: boolean; preventDefault?: () => void } = {},
): void {
  onTouchMove({
    targetTouches: [touch],
    timeStamp,
    target: touch.target,
    cancelable: options.cancelable ?? true,
    preventDefault: options.preventDefault ?? (() => {}),
  } as unknown as TouchEvent);
}

export function dispatchTouchEndForTest(timeStamp: number): void {
  onTouchEnd({
    targetTouches: [],
    timeStamp,
    preventDefault: () => {},
  } as unknown as TouchEvent);
}

export function dispatchTouchCancelForTest(): void {
  onTouchCancel();
}

export function dispatchMultiTouchStartForTest(timeStamp: number): void {
  onTouchStart({
    targetTouches: [
      { clientX: 0, clientY: 0 },
      { clientX: 50, clientY: 50 },
    ],
    timeStamp,
    target: null,
    preventDefault: () => {},
  } as unknown as TouchEvent);
}

export function dispatchMultiTouchMoveForTest(timeStamp: number): void {
  onTouchMove({
    targetTouches: [
      { clientX: 0, clientY: 0 },
      { clientX: 50, clientY: 50 },
    ],
    timeStamp,
    preventDefault: () => {},
  } as unknown as TouchEvent);
}

export function setPopupForTest(element: HTMLElement | null): void {
  popup = element;
}

export function getStateForTest(): {
  state: GestureState;
  activeDirection: SwipeDirection | null;
} {
  return { state, activeDirection };
}

export function resetForTest(): void {
  cleanupAnimation();
  directionHandlers.clear();
  popup = null;
  savedTouchAction = null;
  installRefs = 0;
  installGeneration++;
  state = 'idle';
  activeDirection = null;
  startX = 0;
  startY = 0;
  currentDelta = 0;
  startTimestamp = 0;
  lastObservedGuid = null;
}
