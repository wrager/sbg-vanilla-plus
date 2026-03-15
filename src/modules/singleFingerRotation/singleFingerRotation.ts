import type { IFeatureModule } from '../../core/moduleRegistry';
import type { IOlMap } from '../../core/olMap';
import { getOlMap } from '../../core/olMap';
import { waitForElement } from '../../core/dom';

const MODULE_ID = 'singleFingerRotation';

let viewport: HTMLElement | null = null;
let map: IOlMap | null = null;
let trackingPointerId: number | null = null;
let previousAngle: number | null = null;
let originalSetRotation: ((rotation: number) => void) | null = null;
let touchActionStyle: HTMLStyleElement | null = null;
let enabled = false;

function isFollowWalkerActive(): boolean {
  return localStorage.getItem('follow') === 'true';
}

function lockViewRotation(): void {
  if (!map || !originalSetRotation) return;
  map.getView().setRotation = () => {};
}

function unlockViewRotation(): void {
  if (!map || !originalSetRotation) return;
  map.getView().setRotation = originalSetRotation;
}

function applyRotation(delta: number): void {
  if (!originalSetRotation || !map) return;
  originalSetRotation(map.getView().getRotation() + delta);
}

function getScreenCenter(): { x: number; y: number } {
  const padding = map ? map.getView().padding : [0, 0, 0, 0];
  const [top, right, bottom, left] = padding;
  return {
    x: (left + window.innerWidth - right) / 2,
    y: (top + window.innerHeight - bottom) / 2,
  };
}

function angleFromCenter(clientX: number, clientY: number): number {
  const center = getScreenCenter();
  return Math.atan2(clientY - center.y, clientX - center.x);
}

function normalizeAngleDelta(delta: number): number {
  if (delta > Math.PI) return delta - 2 * Math.PI;
  if (delta < -Math.PI) return delta + 2 * Math.PI;
  return delta;
}

function isViewportEvent(event: PointerEvent): boolean {
  if (!viewport) return false;
  const target = event.target;
  return target instanceof Node && viewport.contains(target);
}

function onPointerDown(event: PointerEvent): void {
  if (!isViewportEvent(event)) return;
  if (event.pointerType !== 'touch') return;
  if (!isFollowWalkerActive()) return;
  if (trackingPointerId !== null) return;
  if (!map) return;

  trackingPointerId = event.pointerId;
  previousAngle = angleFromCenter(event.clientX, event.clientY);
  lockViewRotation();
}

function onPointerMove(event: PointerEvent): void {
  if (event.pointerId !== trackingPointerId) return;
  if (previousAngle === null || !originalSetRotation) return;

  event.stopImmediatePropagation();

  const currentAngle = angleFromCenter(event.clientX, event.clientY);
  const delta = normalizeAngleDelta(currentAngle - previousAngle);

  applyRotation(delta);
  previousAngle = currentAngle;
}

function onPointerUp(event: PointerEvent): void {
  if (event.pointerId !== trackingPointerId) return;
  resetState();
}

function onPointerCancel(event: PointerEvent): void {
  if (event.pointerId !== trackingPointerId) return;
  resetState();
}

function resetState(): void {
  trackingPointerId = null;
  previousAngle = null;
  unlockViewRotation();
}

// Use a <style> element instead of inline style to prevent OL/game from
// overwriting touch-action via inline style assignments.
function injectTouchActionStyle(): void {
  if (touchActionStyle) return;
  touchActionStyle = document.createElement('style');
  touchActionStyle.textContent = '.ol-viewport { touch-action: none !important; }';
  document.head.appendChild(touchActionStyle);
}

function removeTouchActionStyle(): void {
  if (!touchActionStyle) return;
  touchActionStyle.remove();
  touchActionStyle = null;
}

function addListeners(): void {
  injectTouchActionStyle();
  document.addEventListener('pointerdown', onPointerDown as EventListener, {
    capture: true,
  });
  document.addEventListener('pointermove', onPointerMove as EventListener, {
    capture: true,
  });
  document.addEventListener('pointerup', onPointerUp as EventListener, {
    capture: true,
  });
  document.addEventListener('pointercancel', onPointerCancel as EventListener, {
    capture: true,
  });
}

function removeListeners(): void {
  removeTouchActionStyle();
  document.removeEventListener('pointerdown', onPointerDown as EventListener, {
    capture: true,
  });
  document.removeEventListener('pointermove', onPointerMove as EventListener, {
    capture: true,
  });
  document.removeEventListener('pointerup', onPointerUp as EventListener, {
    capture: true,
  });
  document.removeEventListener('pointercancel', onPointerCancel as EventListener, {
    capture: true,
  });
}

export const singleFingerRotation: IFeatureModule = {
  id: MODULE_ID,
  name: {
    en: 'Single-Finger Map Rotation',
    ru: 'Вращение карты одним пальцем',
  },
  description: {
    en: 'Rotate map with circular finger gesture in Follow Walker mode',
    ru: 'Вращение карты круговым жестом одного пальца в режиме следования за игроком',
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
        originalSetRotation = olMap.getView().setRotation.bind(olMap.getView());
      }),
    ]).then(() => {
      if (enabled) {
        addListeners();
      }
    });
  },
  enable() {
    enabled = true;
    addListeners();
  },
  disable() {
    enabled = false;
    removeListeners();
    resetState();
  },
};
