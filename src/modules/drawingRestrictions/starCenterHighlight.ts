import type { IOlFeature, IOlLayer, IOlMap, IOlVectorSource } from '../../core/olMap';
import { findLayerByName, getOlMap } from '../../core/olMap';
import { STAR_CENTER_CHANGED_EVENT, getStarCenterGuid } from './starCenter';

const POINTS_LAYER_NAME = 'points';

let map: IOlMap | null = null;
let pointsSource: IOlVectorSource | null = null;
let overlayLayer: IOlLayer | null = null;
let overlaySource: IOlVectorSource | null = null;
let sourceChangeHandler: (() => void) | null = null;
let starCenterChangeHandler: (() => void) | null = null;
let installGeneration = 0;
// pendingInstall защищает от race `install() → install()` до резолва getOlMap:
// синхронный guard `map !== null` недостаточен (map присваивается в .then()).
let pendingInstall = false;

function buildHighlightStyle(): unknown {
  const styleLib = window.ol?.style;
  if (!styleLib?.Style || !styleLib.Circle || !styleLib.Stroke || !styleLib.Fill) {
    return null;
  }
  return new styleLib.Style({
    image: new styleLib.Circle({
      radius: 18,
      stroke: new styleLib.Stroke({
        color: '#ffcc33',
        width: 3,
      }),
      fill: new styleLib.Fill({
        color: 'rgba(255, 204, 51, 0.15)',
      }),
    }),
  });
}

function findFeatureByGuid(source: IOlVectorSource, guid: string): IOlFeature | null {
  for (const feature of source.getFeatures()) {
    if (feature.getId() === guid) return feature;
  }
  return null;
}

/**
 * Пересобирает overlay feature: кольцо поверх точки-центра. Overlay живёт в
 * собственном layer/source, поэтому оригинальная feature в слое points не
 * трогается — стандартный вид точки (иконка, цвет команды) сохраняется, а
 * наш highlight дополняет его сверху.
 */
function refreshOverlay(): void {
  if (!overlaySource || !pointsSource) return;
  overlaySource.clear();
  const guid = getStarCenterGuid();
  if (guid === null) return;
  const centerFeature = findFeatureByGuid(pointsSource, guid);
  if (!centerFeature) return;
  const coords = centerFeature.getGeometry().getCoordinates();
  const ol = window.ol;
  if (!ol?.Feature || !ol.geom?.Point) return;
  const style = buildHighlightStyle();
  if (!style) return;
  const overlayFeature = new ol.Feature({ geometry: new ol.geom.Point(coords) });
  overlayFeature.setStyle(style);
  overlaySource.addFeature(overlayFeature);
}

function createOverlayLayer(targetMap: IOlMap): boolean {
  const ol = window.ol;
  if (!ol?.source?.Vector || !ol.layer?.Vector) return false;
  overlaySource = new ol.source.Vector();
  overlayLayer = new ol.layer.Vector({
    source: overlaySource,
    // zIndex выше стандартных слоёв игры, чтобы кольцо было поверх иконки.
    zIndex: 999,
  });
  targetMap.addLayer(overlayLayer);
  return true;
}

export function installStarCenterHighlight(): void {
  if (map || pendingInstall) return;
  installGeneration++;
  const generation = installGeneration;
  pendingInstall = true;
  void getOlMap()
    .then((captured) => {
      if (generation !== installGeneration) return;
      const layer = findLayerByName(captured, POINTS_LAYER_NAME);
      const source = layer?.getSource();
      if (!source) {
        console.warn(
          '[SVP drawingRestrictions] слой points не найден — подсветка звезды недоступна',
        );
        pendingInstall = false;
        return;
      }

      if (!createOverlayLayer(captured)) {
        console.warn('[SVP drawingRestrictions] OL Vector layer/source недоступны');
        pendingInstall = false;
        return;
      }

      map = captured;
      pointsSource = source;

      // Перерисовка при появлении/изменении features (центр мог быть за viewport
      // при install, а потом подгрузиться).
      sourceChangeHandler = (): void => {
        refreshOverlay();
      };
      source.on('change', sourceChangeHandler);

      starCenterChangeHandler = (): void => {
        refreshOverlay();
      };
      document.addEventListener(STAR_CENTER_CHANGED_EVENT, starCenterChangeHandler);

      refreshOverlay();
      pendingInstall = false;
    })
    .catch((error: unknown) => {
      console.warn('[SVP drawingRestrictions] не удалось получить OL Map:', error);
      pendingInstall = false;
    });
}

export function uninstallStarCenterHighlight(): void {
  installGeneration++;
  pendingInstall = false;
  overlaySource?.clear();
  if (map && overlayLayer) {
    map.removeLayer(overlayLayer);
  }
  if (pointsSource && sourceChangeHandler) {
    pointsSource.un('change', sourceChangeHandler);
  }
  if (starCenterChangeHandler) {
    document.removeEventListener(STAR_CENTER_CHANGED_EVENT, starCenterChangeHandler);
  }
  map = null;
  pointsSource = null;
  overlayLayer = null;
  overlaySource = null;
  sourceChangeHandler = null;
  starCenterChangeHandler = null;
}
