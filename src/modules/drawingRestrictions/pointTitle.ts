import {
  findLayerByName,
  getCapturedOlMap,
  type IOlFeature,
  type IOlVectorSource,
} from '../../core/olMap';

const POINTS_LAYER_NAME = 'points';
const POPUP_SELECTOR = '.info.popup';
const POPUP_TITLE_SELECTOR = '#i-title';

/**
 * Имя из заголовка открытого попапа, если попап показан на запрошенной точке.
 * Игра заполняет `#i-title` при ЛЮБОМ способе открытия попапа: клик по
 * feature, window.showInfo(guid) (используется next-point swipe, deep-link,
 * списки, нашим refreshOpenPopup'ом). Это даёт имя даже для точек, не
 * подгруженных в текущий viewport карты (где OL feature отсутствует) -
 * критично для попап-кнопки, которая может быть нажата в попапе вне viewport.
 */
function getPointTitleFromOpenPopup(guid: string): string | null {
  const popup = document.querySelector(POPUP_SELECTOR);
  if (!popup || popup.classList.contains('hidden')) return null;
  if (!(popup instanceof HTMLElement)) return null;
  if (popup.dataset.guid !== guid) return null;
  const titleElement = document.querySelector(POPUP_TITLE_SELECTOR);
  if (!titleElement) return null;
  const text = titleElement.textContent.trim();
  return text.length > 0 ? text : null;
}

function findPointsSource(): IOlVectorSource | null {
  const map = getCapturedOlMap();
  if (!map) return null;
  const layer = findLayerByName(map, POINTS_LAYER_NAME);
  return layer?.getSource() ?? null;
}

/**
 * Линейный fallback, если OL VectorSource.getFeatureById не реализован в
 * текущей версии OL (используется в моках тестов). В production O(1) lookup
 * через getFeatureById достаточен и предпочтителен.
 */
function findFeatureByIteration(source: IOlVectorSource, guid: string): IOlFeature | null {
  for (const feature of source.getFeatures()) {
    if (feature.getId() === guid) return feature;
  }
  return null;
}

function getPointTitleFromOlFeature(guid: string): string | null {
  const source = findPointsSource();
  if (!source) return null;
  const feature = source.getFeatureById?.(guid) ?? findFeatureByIteration(source, guid);
  if (!feature) return null;
  const title = feature.get?.('title');
  if (typeof title !== 'string' || title.length === 0) return null;
  return title;
}

/**
 * Имя точки по GUID. Источники в порядке приоритета:
 * (1) Заголовок открытого попапа, если попап на этой же точке - работает
 *     независимо от того, подгружен ли feature в OL viewport.
 * (2) `feature.get('title')` из points-layer - работает когда попап закрыт
 *     или на другой точке, но feature загружен в текущий viewport.
 *
 * null, если ни один источник не дал имени (карта не захвачена, feature не
 * загружен, и попап не на этой точке). Caller использует null как сигнал
 * показать общий вариант тоста без имени.
 */
export function getPointTitleByGuid(guid: string): string | null {
  const fromPopup = getPointTitleFromOpenPopup(guid);
  if (fromPopup !== null) return fromPopup;
  return getPointTitleFromOlFeature(guid);
}
