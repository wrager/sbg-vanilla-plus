import type { IOlFeature, IOlMap, IOlVectorSource } from '../../core/olMap';
import { findLayerByName, getOlMap } from '../../core/olMap';
import { STAR_CENTER_CHANGED_EVENT, getStarCenterGuid } from './starCenter';

const POINTS_LAYER_NAME = 'points';

let map: IOlMap | null = null;
let pointsSource: IOlVectorSource | null = null;
let sourceChangeHandler: (() => void) | null = null;
let starCenterChangeHandler: (() => void) | null = null;
let currentStyledFeature: IOlFeature | null = null;
let installGeneration = 0;

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

function clearCurrentStyle(): void {
  if (currentStyledFeature) {
    currentStyledFeature.setStyle(null);
    currentStyledFeature = null;
  }
}

function refreshHighlight(): void {
  if (!pointsSource) return;
  const starCenterGuid = getStarCenterGuid();
  if (starCenterGuid === null) {
    clearCurrentStyle();
    return;
  }
  const feature = findFeatureByGuid(pointsSource, starCenterGuid);
  if (feature === currentStyledFeature) return;
  clearCurrentStyle();
  if (feature) {
    const style = buildHighlightStyle();
    if (style !== null) {
      feature.setStyle(style);
      currentStyledFeature = feature;
    }
  }
}

export function installStarCenterHighlight(): void {
  if (map) return;
  installGeneration++;
  const generation = installGeneration;
  void getOlMap().then((captured) => {
    if (generation !== installGeneration) return;
    map = captured;
    const layer = findLayerByName(captured, POINTS_LAYER_NAME);
    const source = layer?.getSource();
    if (!source) {
      console.warn('[SVP drawingRestrictions] слой points не найден — подсветка звезды недоступна');
      return;
    }
    pointsSource = source;

    // Пересчитываем подсветку при каждом обновлении слоя (появление/исчезновение точек).
    sourceChangeHandler = (): void => {
      refreshHighlight();
    };
    source.on('change', sourceChangeHandler);

    starCenterChangeHandler = (): void => {
      refreshHighlight();
    };
    document.addEventListener(STAR_CENTER_CHANGED_EVENT, starCenterChangeHandler);

    refreshHighlight();
  });
}

export function uninstallStarCenterHighlight(): void {
  installGeneration++;
  clearCurrentStyle();
  if (pointsSource && sourceChangeHandler) {
    pointsSource.un('change', sourceChangeHandler);
  }
  if (starCenterChangeHandler) {
    document.removeEventListener(STAR_CENTER_CHANGED_EVENT, starCenterChangeHandler);
  }
  map = null;
  pointsSource = null;
  sourceChangeHandler = null;
  starCenterChangeHandler = null;
}
