import type { IFeatureModule } from '../../core/moduleRegistry';
import { waitForElement } from '../../core/dom';

const MODULE_ID = 'disableDoubleTapZoom';
const DOUBLE_TAP_THRESHOLD_MS = 300;

let lastTap = 0;
let pendingEnabled: boolean | null = null;

function blockDoubleTap(e: Event): void {
  const now = Date.now();
  if (now - lastTap < DOUBLE_TAP_THRESHOLD_MS) {
    e.stopImmediatePropagation();
  }
  lastTap = now;
}

function applyEnabled(el: Element, enabled: boolean): void {
  if (enabled) {
    el.addEventListener('pointerdown', blockDoubleTap, { capture: true });
  } else {
    el.removeEventListener('pointerdown', blockDoubleTap, { capture: true });
  }
}

export const disableDoubleTapZoom: IFeatureModule = {
  id: MODULE_ID,
  name: 'Disable Double-Tap Zoom',
  description: 'Отключает зум по двойному тапу для предотвращения случайного зума',
  defaultEnabled: true,
  script: 'features',
  init() {
    void waitForElement('.ol-viewport').then((el) => {
      if (pendingEnabled !== null) {
        applyEnabled(el, pendingEnabled);
        pendingEnabled = null;
      }
    });
  },
  enable() {
    const el = document.querySelector('.ol-viewport');
    if (el) {
      applyEnabled(el, true);
    } else {
      pendingEnabled = true;
    }
  },
  disable() {
    pendingEnabled = false;
    lastTap = 0;
    document
      .querySelector('.ol-viewport')
      ?.removeEventListener('pointerdown', blockDoubleTap, { capture: true });
  },
};
