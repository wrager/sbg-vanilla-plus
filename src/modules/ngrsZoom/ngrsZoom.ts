import type { IFeatureModule } from '../../core/moduleRegistry';
import type { IDragPanControl, IOlInteraction, IOlMap } from '../../core/olMap';
import { createDragPanControl, getOlMap } from '../../core/olMap';

const MODULE_ID = 'ngrsZoom';

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

let map: IOlMap | null = null;
let enabled = false;
let disabledInteractions: IOlInteraction[] = [];
let dragPanControl: IDragPanControl | null = null;

// Gesture state
let state: GestureState = 'idle';
let firstTapStartTimestamp = 0;
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
  dragPanControl?.restore();
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
    firstTapStartTimestamp = event.timeStamp;
    firstTapX = touch.clientX;
    firstTapY = touch.clientY;
    return;
  }

  if (state === 'waitingSecondTap') {
    if (distanceBetweenTaps(touch.clientX, touch.clientY) > MAX_TAP_DISTANCE) {
      resetGesture();
      // Начать новый первый тап
      state = 'firstTapDown';
      firstTapStartTimestamp = event.timeStamp;
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
    dragPanControl?.disable();
    event.preventDefault();
    return;
  }

  // Любое другое состояние — сброс и начало нового цикла
  resetGesture();
  state = 'firstTapDown';
  firstTapStartTimestamp = event.timeStamp;
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

// Используем event.timeStamp вместо Date.now(), чтобы измерять реальную
// длительность тапа — без учёта блокировки event loop другими обработчиками
// (OL pointerup может блокировать главный поток на 100–200мс).
function onTouchEnd(event: TouchEvent): void {
  if (state === 'firstTapDown') {
    const elapsed = event.timeStamp - firstTapStartTimestamp;
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

// Capture-фаза на document: обрабатываем touch-события ДО того, как они
// дойдут до viewport-листенеров других модулей (singleFingerRotation).
// Когда жест зума активен — stopPropagation блокирует дальнейшее всплытие.
function onTouchStartCapture(event: TouchEvent): void {
  onTouchStart(event);
  if (state === 'secondTapDown' || state === 'zooming') {
    event.stopPropagation();
  }
}

function onTouchMoveCapture(event: TouchEvent): void {
  onTouchMove(event);
  if (state === 'secondTapDown' || state === 'zooming') {
    event.stopPropagation();
  }
}

function onTouchEndCapture(event: TouchEvent): void {
  const wasActive = state === 'secondTapDown' || state === 'zooming';
  onTouchEnd(event);
  if (wasActive) {
    event.stopPropagation();
  }
}

function addListeners(): void {
  document.addEventListener('touchstart', onTouchStartCapture, { capture: true, passive: false });
  document.addEventListener('touchmove', onTouchMoveCapture, { capture: true, passive: false });
  document.addEventListener('touchend', onTouchEndCapture, { capture: true });
}

function removeListeners(): void {
  document.removeEventListener('touchstart', onTouchStartCapture, { capture: true });
  document.removeEventListener('touchmove', onTouchMoveCapture, { capture: true });
  document.removeEventListener('touchend', onTouchEndCapture, { capture: true });
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

export const ngrsZoom: IFeatureModule = {
  id: MODULE_ID,
  name: {
    en: 'Ngrs Zoom',
    ru: 'Нгрс-зум',
  },
  description: {
    en: 'Double-tap and drag up/down to zoom in/out smoothly',
    ru: 'Двойной тап и перетаскивание вверх/вниз для плавного зума',
  },
  defaultEnabled: true,
  category: 'map',
  init() {
    return getOlMap().then((olMap) => {
      map = olMap;
      dragPanControl = createDragPanControl(olMap);
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
