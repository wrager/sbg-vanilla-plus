import type { IFeatureModule } from '../../core/moduleRegistry';
import { getOlMap, registerForEachFeatureAtPixelInterceptor } from '../../core/olMap';

const MODULE_ID = 'largerPointTapArea';
const HIT_TOLERANCE_PX = 15;

let unregisterInterceptor: (() => void) | null = null;

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
      if (unregisterInterceptor) return;
      // Игра вызывает forEachFeatureAtPixel с дефолтным hitTolerance; повышаем
      // его, чтобы точки было проще нажимать пальцем на мобильном.
      unregisterInterceptor = registerForEachFeatureAtPixelInterceptor(olMap, {
        transformOptions: (options) => ({ ...options, hitTolerance: HIT_TOLERANCE_PX }),
      });
    });
  },

  disable() {
    unregisterInterceptor?.();
    unregisterInterceptor = null;
  },
};
