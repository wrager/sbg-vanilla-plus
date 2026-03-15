import type { IFeatureModule } from '../../core/moduleRegistry';
import { getOlMap } from '../../core/olMap';

const MODULE_ID = 'shiftMapCenterDown';
const PADDING_FACTOR = 0.35;

export const shiftMapCenterDown: IFeatureModule = {
  id: MODULE_ID,
  name: { en: 'Shift Map Center Down', ru: 'Сдвиг центра карты вниз' },
  description: {
    en: 'Moves map center down so you see more ahead while moving',
    ru: 'Сдвигает центр карты вниз, чтобы видеть больше карты впереди по ходу движения',
  },
  defaultEnabled: true,
  requiresReload: true,
  category: 'map',
  init() {},
  enable() {
    return getOlMap().then((map) => {
      const view = map.getView();
      const topPadding = Math.round(window.innerHeight * PADDING_FACTOR);
      view.padding = [topPadding, 0, 0, 0];

      // Оборачиваем calculateExtent, чтобы без аргументов возвращать extent
      // для полного canvas (включая padding-зону). Без этого игра не подгружает
      // точки в области, открывшейся после сдвига центра (как в CUI-референсе).
      const originalCalculateExtent = view.calculateExtent.bind(view);
      view.calculateExtent = (size?: number[]) => originalCalculateExtent(size ?? map.getSize());

      view.setCenter(view.getCenter());
    });
  },
  disable() {},
};
