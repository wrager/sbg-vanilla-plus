import type { IFeatureModule } from '../../core/moduleRegistry';
import { getOlMap } from '../../core/olMap';
import type { IOlFeature, IOlLayer, IOlMap } from '../../core/olMap';

const MODULE_ID = 'largerPointTapArea';
const HIT_TOLERANCE_PX = 15;

type ForEachFeatureAtPixel = NonNullable<IOlMap['forEachFeatureAtPixel']>;

let map: IOlMap | null = null;
let originalMethod: ForEachFeatureAtPixel | null = null;

export const largerPointTapArea: IFeatureModule = {
  id: MODULE_ID,
  name: { en: 'Larger Point Tap Area', ru: 'Увеличенная область нажатия' },
  description: {
    en: 'Increases the tappable area of map points for easier selection on mobile',
    ru: 'Увеличивает кликабельную область точек на карте для удобства на мобильных',
  },
  defaultEnabled: true,
  category: 'map',

  init() {},

  enable() {
    return getOlMap().then((olMap) => {
      if (originalMethod || !olMap.forEachFeatureAtPixel) return;

      map = olMap;
      originalMethod = olMap.forEachFeatureAtPixel.bind(olMap);
      const saved = originalMethod;

      olMap.forEachFeatureAtPixel = (
        pixel: number[],
        callback: (feature: IOlFeature, layer: IOlLayer) => void,
        options?: { hitTolerance?: number; layerFilter?: (layer: IOlLayer) => boolean },
      ) => {
        saved(pixel, callback, {
          ...options,
          hitTolerance: HIT_TOLERANCE_PX,
        });
      };
    });
  },

  disable() {
    if (map && originalMethod && map.forEachFeatureAtPixel) {
      map.forEachFeatureAtPixel = originalMethod;
    }
    originalMethod = null;
    map = null;
  },
};
