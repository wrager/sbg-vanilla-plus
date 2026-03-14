import { registerModule } from '../../core/moduleRegistry';

const MODULE_ID = 'disableDoubleTapZoom';

interface OlInteraction {
  constructor: { name: string };
  setActive: (active: boolean) => void;
}

interface OlMap {
  getInteractions: () => { getArray: () => OlInteraction[] };
}

function getMap(): OlMap | null {
  const canvas = document.querySelector('.ol-viewport canvas');
  if (!canvas) return null;

  // OpenLayers stores map reference on the viewport container
  const viewport = canvas.closest('.ol-viewport')?.parentElement;
  if (!viewport) return null;

  // Access map instance from global scope (SBG exposes it)
  const win = window as unknown as Record<string, unknown>;
  if ('map' in win && win.map && typeof win.map === 'object') {
    return win.map as OlMap;
  }

  return null;
}

let disabledInteractions: OlInteraction[] = [];

registerModule({
  id: MODULE_ID,
  name: 'Disable Double-Tap Zoom',
  description: 'Отключает зум по двойному тапу для предотвращения случайного зума',
  defaultEnabled: true,
  script: 'features',
  init() {},
  enable() {
    const map = getMap();
    if (!map) return;

    const interactions = map.getInteractions().getArray();
    disabledInteractions = interactions.filter((i) => i.constructor.name === 'DoubleClickZoom');
    for (const interaction of disabledInteractions) {
      interaction.setActive(false);
    }
  },
  disable() {
    for (const interaction of disabledInteractions) {
      interaction.setActive(true);
    }
    disabledInteractions = [];
  },
});
