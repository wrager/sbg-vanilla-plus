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
  // Перезагрузка нужна по трём причинам:
  // 1. enable() оборачивает view.calculateExtent — повторный вызов создаст вложенные обёртки.
  // 2. disable() не восстанавливает оригинальный calculateExtent и padding.
  // 3. В отличие от предыдущей CSS-реализации (injectStyles + map.updateSize()),
  //    которая применялась динамически, view.padding + обёртка calculateExtent
  //    должны быть установлены до первой загрузки данных игрой — иначе OL уже
  //    закеширует extent без учёта padding и точки в новой области не подгрузятся.
  requiresReload: true,
  category: 'map',
  init() {},
  enable() {
    return getOlMap().then((map) => {
      const view = map.getView();
      const topPadding = Math.round(window.innerHeight * PADDING_FACTOR);
      view.padding = [topPadding, 0, 0, 0];

      // Игра вызывает view.calculateExtent(map.getSize()) для определения
      // видимой области и загрузки точек. OL при наличии padding уменьшает
      // эту область, из-за чего точки в padding-зоне не загружаются.
      // Компенсируем: увеличиваем height на величину padding (как в CUI).
      const originalCalculateExtent = view.calculateExtent.bind(view);
      view.calculateExtent = (size?: number[]) => {
        const effectiveSize = size ? [size[0], size[1] + topPadding] : map.getSize();
        return originalCalculateExtent(effectiveSize);
      };

      view.setCenter(view.getCenter());
    });
  },
  disable() {},
};
