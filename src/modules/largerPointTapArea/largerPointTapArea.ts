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
  name: { en: 'Larger point tap area', ru: 'Увеличенная область нажатия' },
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
      // Игровой обработчик клика по карте не задаёт hitTolerance и получает
      // дефолтные 0 пикселей; повышаем его, чтобы точки было проще нажимать
      // пальцем на мобильном. Заданный явно радиус остаётся: это осознанный
      // выбор вызывающей стороны, а не игровой дефолт.
      unregisterInterceptor = registerForEachFeatureAtPixelInterceptor(olMap, {
        transformOptions: (options) => ({
          ...options,
          hitTolerance: options?.hitTolerance ?? HIT_TOLERANCE_PX,
        }),
      });
    });
  },

  disable() {
    enableToken++;
    unregisterInterceptor?.();
    unregisterInterceptor = null;
  },
};
