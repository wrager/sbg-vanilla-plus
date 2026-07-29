import type { IFeatureModule } from '../../core/moduleRegistry';
import { getOlMap, registerForEachFeatureAtPixelInterceptor } from '../../core/olMap';

const MODULE_ID = 'largerPointTapArea';
const HIT_TOLERANCE_PX = 15;

let unregisterInterceptor: (() => void) | null = null;
// Модуль включён по умолчанию, поэтому enable ждёт захвата карты. Токен
// отменяет регистрацию перехватчика, если модуль выключили за время ожидания.
let enableToken = 0;

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
    const myToken = ++enableToken;
    return getOlMap().then((olMap) => {
      if (myToken !== enableToken) return;
      if (unregisterInterceptor) return;
      // Игра вызывает forEachFeatureAtPixel с дефолтным hitTolerance; повышаем
      // его, чтобы точки было проще нажимать пальцем на мобильном.
      unregisterInterceptor = registerForEachFeatureAtPixelInterceptor(olMap, {
        transformOptions: (options) => ({ ...options, hitTolerance: HIT_TOLERANCE_PX }),
      });
    });
  },

  disable() {
    enableToken++;
    unregisterInterceptor?.();
    unregisterInterceptor = null;
  },
};
