import type { IFeatureModule } from '../../core/moduleRegistry';
import { getOlMap } from '../../core/olMap';
import type { IOlMap } from '../../core/olMap';

const MODULE_ID = 'largerPointTapArea';
const HIT_TOLERANCE_PX = 15;

type FeatureCallback = (...args: unknown[]) => unknown;
type ForEachFeatureAtPixel = (
  pixel: number[],
  callback: FeatureCallback,
  options?: Record<string, unknown>,
) => unknown;

function hasForEachFeatureAtPixel(
  object: IOlMap,
): object is IOlMap & { forEachFeatureAtPixel: ForEachFeatureAtPixel } {
  return (
    'forEachFeatureAtPixel' in object &&
    typeof (object as Record<string, unknown>).forEachFeatureAtPixel === 'function'
  );
}

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
    void getOlMap().then((olMap) => {
      if (originalMethod) return;
      if (!hasForEachFeatureAtPixel(olMap)) return;

      map = olMap;
      originalMethod = olMap.forEachFeatureAtPixel;
      const saved = originalMethod;

      olMap.forEachFeatureAtPixel = function (
        pixel: number[],
        callback: FeatureCallback,
        options?: Record<string, unknown>,
      ) {
        return saved.call(this, pixel, callback, {
          ...options,
          hitTolerance: HIT_TOLERANCE_PX,
        });
      };
    });
  },

  disable() {
    if (map && originalMethod && hasForEachFeatureAtPixel(map)) {
      map.forEachFeatureAtPixel = originalMethod;
    }
    originalMethod = null;
    map = null;
  },
};
