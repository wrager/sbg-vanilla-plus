import type { IFeatureModule } from '../../core/moduleRegistry';
import type { IOlMap } from '../../core/olMap';
import { getOlMap } from '../../core/olMap';

const MODULE_ID = 'shiftMapCenterDown';
const PADDING_FACTOR = 0.35;

let map: IOlMap | null = null;
let topPadding = 0;
let inflateForPadding = false;

export const shiftMapCenterDown: IFeatureModule = {
  id: MODULE_ID,
  name: { en: 'Shift Map Center Down', ru: 'Сдвиг центра карты вниз' },
  description: {
    en: 'Moves map center down so you see more ahead while moving',
    ru: 'Сдвигает центр карты вниз, чтобы видеть больше карты впереди по ходу движения',
  },
  defaultEnabled: true,
  category: 'map',
  init() {
    topPadding = Math.round(window.innerHeight * PADDING_FACTOR);

    return getOlMap().then((olMap) => {
      map = olMap;

      // Игра вызывает view.calculateExtent(map.getSize()) для определения
      // видимой области и загрузки точек. OL при наличии padding уменьшает
      // эту область, из-за чего точки в padding-зоне не загружаются.
      // Компенсируем: увеличиваем height на величину padding.
      // Wrapper создаётся один раз, переключается флагом в enable/disable.
      const view = olMap.getView();
      const originalCalculateExtent = view.calculateExtent.bind(view);
      view.calculateExtent = (size?: number[]) => {
        if (inflateForPadding && size) {
          return originalCalculateExtent([size[0], size[1] + topPadding]);
        }
        return originalCalculateExtent(size);
      };
    });
  },
  enable() {
    inflateForPadding = true;
    if (map) {
      const view = map.getView();
      // Сохраняем центр ДО смены padding: OL's padding setter корректирует
      // центр в координатном пространстве (без учёта rotation), а рендеринг
      // (getState) применяет padding в экранном (с rotation). Если не
      // восстановить центр, при повороте карты сдвиг пойдёт не вниз.
      const center = view.getCenter();
      view.padding = [topPadding, 0, 0, 0];
      view.setCenter(center);
    }
  },
  disable() {
    inflateForPadding = false;
    if (map) {
      const view = map.getView();
      const center = view.getCenter();
      view.padding = [0, 0, 0, 0];
      view.setCenter(center);
    }
  },
};
