import type { IFeatureModule } from '../../core/moduleRegistry';
import type { IOlInteraction } from '../../core/olMap';
import { getOlMap } from '../../core/olMap';

const MODULE_ID = 'disableDoubleTapZoom';

let disabledInteractions: IOlInteraction[] = [];
let enabled = false;

function isDoubleClickZoom(interaction: IOlInteraction): boolean {
  const DoubleClickZoom = window.ol?.interaction?.DoubleClickZoom;
  return DoubleClickZoom !== undefined && interaction instanceof DoubleClickZoom;
}

export const disableDoubleTapZoom: IFeatureModule = {
  id: MODULE_ID,
  name: { en: 'Disable Double-Tap Zoom', ru: 'Отключить зум по двойному тапу' },
  description: {
    en: 'Disables double-tap zoom to prevent accidental zooming',
    ru: 'Отключает зум по двойному тапу для предотвращения случайного зума',
  },
  defaultEnabled: true,
  category: 'map',
  init() {
    // no-op: map interactions are managed in enable/disable
  },
  enable() {
    enabled = true;
    return getOlMap().then((map) => {
      if (!enabled) return;
      const interactions = map.getInteractions().getArray();
      disabledInteractions = interactions.filter(isDoubleClickZoom);
      for (const interaction of disabledInteractions) {
        interaction.setActive(false);
      }
    });
  },
  disable() {
    enabled = false;
    for (const interaction of disabledInteractions) {
      interaction.setActive(true);
    }
    disabledInteractions = [];
  },
};
