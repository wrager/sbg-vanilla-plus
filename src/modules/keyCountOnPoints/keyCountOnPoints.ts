import type { IFeatureModule } from '../../core/moduleRegistry';
import { getOlMap } from '../../core/olMap';
import type { IOlMap, IOlVectorSource, IOlLayer } from '../../core/olMap';

const MODULE_ID = 'keyCountOnPoints';
const MIN_ZOOM = 15;
const DEBOUNCE_MS = 100;

interface InventoryRef {
  t: 3;
  l: string;
  a: number;
}

function isInventoryRef(val: unknown): val is InventoryRef {
  return (
    typeof val === 'object' &&
    val !== null &&
    't' in val &&
    (val as Record<string, unknown>).t === 3 &&
    'l' in val &&
    typeof (val as Record<string, unknown>).l === 'string' &&
    'a' in val &&
    typeof (val as Record<string, unknown>).a === 'number'
  );
}

export function buildRefCounts(): Map<string, number> {
  const raw = localStorage.getItem('inventory-cache');
  if (!raw) return new Map();
  let items: unknown;
  try {
    items = JSON.parse(raw) as unknown;
  } catch {
    return new Map();
  }
  if (!Array.isArray(items)) return new Map();
  const counts = new Map<string, number>();
  for (const item of items) {
    if (isInventoryRef(item)) {
      counts.set(item.l, (counts.get(item.l) ?? 0) + item.a);
    }
  }
  return counts;
}

let map: IOlMap | null = null;
let pointsSource: IOlVectorSource | null = null;
let labelsSource: IOlVectorSource | null = null;
let labelsLayer: IOlLayer | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let mutationObserver: MutationObserver | null = null;
let onPointsChange: (() => void) | null = null;
let onZoomChange: (() => void) | null = null;

function renderLabels(): void {
  if (!labelsSource || !map || !pointsSource) return;

  labelsSource.clear();

  const zoom = map.getView().getZoom?.() ?? 0;
  if (zoom < MIN_ZOOM) return;

  const refCounts = buildRefCounts();
  if (refCounts.size === 0) return;

  const ol = window.ol;
  const OlFeature = ol?.Feature;
  const OlPoint = ol?.geom?.Point;
  const OlStyle = ol?.style?.Style;
  const OlText = ol?.style?.Text;
  const OlFill = ol?.style?.Fill;
  const OlStroke = ol?.style?.Stroke;
  if (!OlFeature || !OlPoint || !OlStyle || !OlText || !OlFill || !OlStroke) return;

  const textColor =
    getComputedStyle(document.documentElement).getPropertyValue('--text').trim() || '#000000';
  const bgColor =
    getComputedStyle(document.documentElement).getPropertyValue('--background').trim() || '#ffffff';

  for (const feature of pointsSource.getFeatures()) {
    const id = feature.getId();
    if (typeof id !== 'string') continue;
    const count = refCounts.get(id);
    if (!count || count <= 0) continue;

    const coords = feature.getGeometry().getCoordinates();
    const label = new OlFeature({ geometry: new OlPoint(coords) });
    label.setId(id + ':key-label');
    label.setStyle(
      new OlStyle({
        text: new OlText({
          font: '12px Manrope',
          text: String(count),
          fill: new OlFill({ color: textColor }),
          stroke: new OlStroke({ color: bgColor, width: 3 }),
        }),
        zIndex: 5,
      }),
    );
    labelsSource.addFeature(label);
  }
}

function scheduleRender(): void {
  if (debounceTimer !== null) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(renderLabels, DEBOUNCE_MS);
}

function findPointsLayer(olMap: IOlMap): IOlLayer | null {
  for (const layer of olMap.getLayers().getArray()) {
    if (layer.get('name') === 'points') return layer;
  }
  return null;
}

export const keyCountOnPoints: IFeatureModule = {
  id: MODULE_ID,
  name: { en: 'Key count on points', ru: 'Количество ключей на точках' },
  description: {
    en: 'Shows the number of reference keys for each visible point on the map',
    ru: 'Показывает число ключей (refs) для каждой видимой точки на карте',
  },
  defaultEnabled: true,
  category: 'ui',

  init() {},

  enable() {
    return getOlMap().then((olMap) => {
      const ol = window.ol;
      const OlVectorSource = ol?.source?.Vector;
      const OlVectorLayer = ol?.layer?.Vector;
      if (!OlVectorSource || !OlVectorLayer) return;

      const pointsLayer = findPointsLayer(olMap);
      if (!pointsLayer) return;

      const src = pointsLayer.getSource();
      if (!src) return;

      map = olMap;
      pointsSource = src;
      labelsSource = new OlVectorSource();
      labelsLayer = new OlVectorLayer({
        // as unknown as: OL Vector constructor accepts a generic options bag;
        // IOlVectorSource cannot be narrowed to Record<string, unknown> without a guard
        source: labelsSource as unknown as Record<string, unknown>,
        zIndex: 5,
      });

      olMap.addLayer(labelsLayer);

      onPointsChange = scheduleRender;
      pointsSource.on('change', onPointsChange);

      onZoomChange = renderLabels;
      olMap.getView().on?.('change:resolution', onZoomChange);

      const invEl = document.getElementById('self-info__inv');
      if (invEl) {
        mutationObserver = new MutationObserver(renderLabels);
        mutationObserver.observe(invEl, { characterData: true, childList: true, subtree: true });
      }

      renderLabels();
    });
  },

  disable() {
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }

    if (mutationObserver) {
      mutationObserver.disconnect();
      mutationObserver = null;
    }

    if (pointsSource && onPointsChange) {
      pointsSource.un('change', onPointsChange);
      onPointsChange = null;
    }

    if (map && onZoomChange) {
      map.getView().un?.('change:resolution', onZoomChange);
      onZoomChange = null;
    }

    if (map && labelsLayer) {
      map.removeLayer(labelsLayer);
    }

    map = null;
    pointsSource = null;
    labelsSource = null;
    labelsLayer = null;
  },
};
