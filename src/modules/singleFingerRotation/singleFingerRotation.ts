import type { IFeatureModule } from '../../core/moduleRegistry';
import type { IOlMap } from '../../core/olMap';
import { getOlMap } from '../../core/olMap';
import { waitForElement } from '../../core/dom';

const MODULE_ID = 'singleFingerRotation';

let viewport: Element | null = null;
let map: IOlMap | null = null;
let trackingPointerId: number | null = null;
let previousAngle: number | null = null;
let enabled = false;

function isFollowWalkerActive(): boolean {
  return localStorage.getItem('follow') === 'true';
}

function getScreenCenter(): { x: number; y: number } {
  return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
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

function onPointerDown(event: PointerEvent): void {
  if (event.pointerType !== 'touch') return;
  if (!isFollowWalkerActive()) return;
  if (trackingPointerId !== null) return;

  trackingPointerId = event.pointerId;
  previousAngle = angleFromCenter(event.clientX, event.clientY);
}

function onPointerMove(event: PointerEvent): void {
  if (event.pointerId !== trackingPointerId) return;
  if (previousAngle === null || !map) return;

  event.stopPropagation();

  const currentAngle = angleFromCenter(event.clientX, event.clientY);
  const delta = normalizeAngleDelta(currentAngle - previousAngle);

  const view = map.getView();
  view.setRotation(view.getRotation() + delta);
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
}

function addListeners(element: Element): void {
  element.addEventListener('pointerdown', onPointerDown as EventListener, {
    capture: true,
  });
  element.addEventListener('pointermove', onPointerMove as EventListener, {
    capture: true,
  });
  element.addEventListener('pointerup', onPointerUp as EventListener, {
    capture: true,
  });
  element.addEventListener('pointercancel', onPointerCancel as EventListener, {
    capture: true,
  });
}

function removeListeners(element: Element): void {
  element.removeEventListener('pointerdown', onPointerDown as EventListener, {
    capture: true,
  });
  element.removeEventListener('pointermove', onPointerMove as EventListener, {
    capture: true,
  });
  element.removeEventListener('pointerup', onPointerUp as EventListener, {
    capture: true,
  });
  element.removeEventListener('pointercancel', onPointerCancel as EventListener, { capture: true });
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
        viewport = element;
      }),
      getOlMap().then((olMap) => {
        map = olMap;
      }),
    ]).then(() => {
      if (enabled && viewport) {
        addListeners(viewport);
      }
    });
  },
  enable() {
    enabled = true;
    if (viewport) {
      addListeners(viewport);
    }
  },
  disable() {
    enabled = false;
    if (viewport) {
      removeListeners(viewport);
    }
    resetState();
  },
};
