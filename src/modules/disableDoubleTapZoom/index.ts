import type { FeatureModule } from '../../core/moduleRegistry';
import { waitForElement } from '../../core/dom';

const MODULE_ID = 'disableDoubleTapZoom';

interface OlInteraction {
  constructor: { name: string };
  setActive: (active: boolean) => void;
}

interface OlMap {
  getInteractions: () => { getArray: () => OlInteraction[] };
}

function getMap(): OlMap | null {
  const win = window as unknown as Record<string, unknown>;
  if ('map' in win && win.map && typeof win.map === 'object') {
    return win.map as OlMap;
  }
  return null;
}

function findDoubleClickZoom(map: OlMap): OlInteraction[] {
  return map
    .getInteractions()
    .getArray()
    .filter((i) => i.constructor.name === 'DoubleClickZoom');
}

let mapReady = false;
let pendingEnabled: boolean | null = null;
let disabledInteractions: OlInteraction[] = [];

function applyEnabled(enabled: boolean): void {
  const map = getMap();
  if (!map) return;

  if (enabled) {
    for (const i of disabledInteractions) i.setActive(true);
    disabledInteractions = [];
  } else {
    disabledInteractions = findDoubleClickZoom(map);
    for (const i of disabledInteractions) i.setActive(false);
  }
}

export const disableDoubleTapZoom: FeatureModule = {
  id: MODULE_ID,
  name: 'Disable Double-Tap Zoom',
  description: 'Отключает зум по двойному тапу для предотвращения случайного зума',
  defaultEnabled: true,
  script: 'features',
  init() {
    void waitForElement('.ol-viewport canvas').then(() => {
      mapReady = true;
      if (pendingEnabled !== null) {
        applyEnabled(pendingEnabled);
        pendingEnabled = null;
      }
    });
  },
  enable() {
    if (mapReady) {
      applyEnabled(true);
    } else {
      pendingEnabled = true;
    }
  },
  disable() {
    if (mapReady) {
      applyEnabled(false);
    } else {
      pendingEnabled = false;
    }
  },
};
