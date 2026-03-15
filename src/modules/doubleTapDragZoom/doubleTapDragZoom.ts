import type { IFeatureModule } from '../../core/moduleRegistry';
import type { IOlInteraction, IOlMap } from '../../core/olMap';
import { getOlMap } from '../../core/olMap';
import { waitForElement } from '../../core/dom';

const MODULE_ID = 'doubleTapDragZoom';

/** Максимальная длительность нажатия, чтобы считаться тапом (мс) */
const TAP_DURATION_THRESHOLD = 200;
/** Максимальный интервал между первым и вторым тапом (мс) */
const MAX_TAP_GAP = 300;
/** Максимальное расстояние между первым и вторым тапом (px) */
const MAX_TAP_DISTANCE = 30;
/** Минимальное вертикальное смещение для начала зума (px) */
const DRAG_THRESHOLD = 5;
/** Чувствительность: zoom levels на пиксель вертикального смещения */
const ZOOM_SENSITIVITY = 0.01;

type GestureState = 'idle' | 'firstTapDown' | 'waitingSecondTap' | 'secondTapDown' | 'zooming';

let viewport: HTMLElement | null = null;
let map: IOlMap | null = null;
let enabled = false;
let disabledInteractions: IOlInteraction[] = [];

// Gesture state
let state: GestureState = 'idle';
let firstTapTime = 0;
let firstTapX = 0;
let firstTapY = 0;
let secondTapTimer: ReturnType<typeof setTimeout> | null = null;
let initialY = 0;
let initialZoom = 0;

function isDoubleClickZoom(interaction: IOlInteraction): boolean {
  const DoubleClickZoom = window.ol?.interaction?.DoubleClickZoom;
  return DoubleClickZoom !== undefined && interaction instanceof DoubleClickZoom;
}

function resetGesture(): void {
  state = 'idle';
  if (secondTapTimer !== null) {
    clearTimeout(secondTapTimer);
    secondTapTimer = null;
  }
}

function distanceBetweenTaps(x: number, y: number): number {
  return Math.sqrt((x - firstTapX) ** 2 + (y - firstTapY) ** 2);
}

function applyZoom(currentY: number): void {
  if (!map) return;
  const view = map.getView();
  if (!view.setZoom) return;
  const deltaY = initialY - currentY;
  view.setZoom(initialZoom + deltaY * ZOOM_SENSITIVITY);
}

function onTouchStart(event: TouchEvent): void {
  if (event.targetTouches.length !== 1) {
    resetGesture();
    return;
  }
  if (!(event.target instanceof HTMLCanvasElement)) return;

  const touch = event.targetTouches[0];

  if (state === 'idle') {
    state = 'firstTapDown';
    firstTapTime = Date.now();
    firstTapX = touch.clientX;
    firstTapY = touch.clientY;
    return;
  }

  if (state === 'waitingSecondTap') {
    if (distanceBetweenTaps(touch.clientX, touch.clientY) > MAX_TAP_DISTANCE) {
      resetGesture();
      // Начать новый первый тап
      state = 'firstTapDown';
      firstTapTime = Date.now();
      firstTapX = touch.clientX;
      firstTapY = touch.clientY;
      return;
    }

    if (secondTapTimer !== null) {
      clearTimeout(secondTapTimer);
      secondTapTimer = null;
    }

    const view = map?.getView();
    const zoom = view?.getZoom?.();
    if (zoom === undefined) {
      resetGesture();
      return;
    }

    state = 'secondTapDown';
    initialY = touch.clientY;
    initialZoom = zoom;
    event.preventDefault();
    return;
  }

  // Любое другое состояние — сброс и начало нового цикла
  resetGesture();
  state = 'firstTapDown';
  firstTapTime = Date.now();
  firstTapX = touch.clientX;
  firstTapY = touch.clientY;
}

function onTouchMove(event: TouchEvent): void {
  if (state === 'firstTapDown') {
    resetGesture();
    return;
  }

  if (state === 'secondTapDown') {
    const touch = event.targetTouches[0];
    if (Math.abs(touch.clientY - initialY) > DRAG_THRESHOLD) {
      state = 'zooming';
      event.preventDefault();
      applyZoom(touch.clientY);
    }
    return;
  }

  if (state === 'zooming') {
    event.preventDefault();
    const touch = event.targetTouches[0];
    applyZoom(touch.clientY);
  }
}

function onTouchEnd(): void {
  if (state === 'firstTapDown') {
    const elapsed = Date.now() - firstTapTime;
    if (elapsed < TAP_DURATION_THRESHOLD) {
      state = 'waitingSecondTap';
      secondTapTimer = setTimeout(() => {
        resetGesture();
      }, MAX_TAP_GAP);
      return;
    }
    resetGesture();
    return;
  }

  resetGesture();
}

// Блокируем pointermove во время жеста зума, чтобы OL DragPan
// не панорамировал карту параллельно с нашим зумом.
function onPointerMove(event: PointerEvent): void {
  if (state === 'zooming' && event.pointerType === 'touch') {
    event.stopImmediatePropagation();
  }
}

function addListeners(): void {
  if (!viewport) return;
  viewport.addEventListener('touchstart', onTouchStart, { passive: false });
  viewport.addEventListener('touchmove', onTouchMove, { passive: false });
  viewport.addEventListener('touchend', onTouchEnd);
  document.addEventListener('pointermove', onPointerMove as EventListener, { capture: true });
}

function removeListeners(): void {
  if (!viewport) return;
  viewport.removeEventListener('touchstart', onTouchStart);
  viewport.removeEventListener('touchmove', onTouchMove);
  viewport.removeEventListener('touchend', onTouchEnd);
  document.removeEventListener('pointermove', onPointerMove as EventListener, {
    capture: true,
  });
}

function disableDoubleClickZoomInteractions(): void {
  if (!map) return;
  const interactions = map.getInteractions().getArray();
  disabledInteractions = interactions.filter(isDoubleClickZoom);
  for (const interaction of disabledInteractions) {
    interaction.setActive(false);
  }
}

function restoreDoubleClickZoomInteractions(): void {
  for (const interaction of disabledInteractions) {
    interaction.setActive(true);
  }
  disabledInteractions = [];
}

export const doubleTapDragZoom: IFeatureModule = {
  id: MODULE_ID,
  name: {
    en: 'Double-Tap Drag Zoom',
    ru: 'Зум перетаскиванием по двойному тапу',
  },
  description: {
    en: 'Double-tap and drag up/down to zoom in/out smoothly',
    ru: 'Двойной тап и перетаскивание вверх/вниз для плавного зума',
  },
  defaultEnabled: true,
  category: 'map',
  init() {
    return Promise.all([
      waitForElement('.ol-viewport').then((element) => {
        if (element instanceof HTMLElement) {
          viewport = element;
        }
      }),
      getOlMap().then((olMap) => {
        map = olMap;
      }),
    ]).then(() => {
      if (enabled) {
        disableDoubleClickZoomInteractions();
        addListeners();
      }
    });
  },
  enable() {
    enabled = true;
    addListeners();
    return getOlMap().then((olMap) => {
      if (!enabled) return;
      map = olMap;
      disableDoubleClickZoomInteractions();
    });
  },
  disable() {
    enabled = false;
    restoreDoubleClickZoomInteractions();
    removeListeners();
    resetGesture();
  },
};
