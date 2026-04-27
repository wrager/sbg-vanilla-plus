import type { IFeatureModule } from '../../core/moduleRegistry';
import { getOlMap, findLayerByName } from '../../core/olMap';
import type { IOlMap, IOlVectorSource, IOlLayer } from '../../core/olMap';
import { readInventoryReferences } from '../../core/inventoryCache';
import { getTextColor, getBackgroundColor } from '../../core/themeColors';

const MODULE_ID = 'keyCountFix';
const MIN_ZOOM = 13;
const DEBOUNCE_MS = 100;
// SBG 0.6.1 layers-config: байт 2 поля map-config.h задаёт «текстовый канал»
// для FeatureStyles.LIGHT (refs/game-beta/script.js:556 далее). Значение 7 =
// References — нативно рисует количество ключей текстом 32px поверх кольца
// точки. Маскируем байт 2 в 0 (None), пока модуль активен — наш слой ниже
// показывает те же числа адаптивным шрифтом.
const TEXT_CHANNEL_SHIFT = 16;
const TEXT_CHANNEL_MASK = 0xff << TEXT_CHANNEL_SHIFT;
const REFERENCES_MODE_VALUE = 7;
const MAP_CONFIG_KEY = 'map-config';

/** clamp(low, value, high) — возвращает value, ограниченный диапазоном [low, high]. */
function clamp(low: number, value: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

/**
 * Адаптивный размер шрифта в зависимости от зума. На MIN_ZOOM (13) — мелкий
 * 10px, на zoom 18+ — 16px. Линейная интерполяция в диапазоне.
 *
 * Нативный рендер игры (refs/game-beta/script.js:570 — `bold 32px Manrope`)
 * слишком крупный на низких зумах (числа закрывают сами точки и соседние
 * подписи); наш более мелкий и масштабируемый шрифт остаётся читаемым.
 */
export function fontSizeForZoom(zoom: number): number {
  return Math.round(clamp(10, zoom - 3, 16));
}

export function buildRefCounts(): Map<string, number> {
  const refs = readInventoryReferences();
  const counts = new Map<string, number>();
  for (const ref of refs) {
    counts.set(ref.l, (counts.get(ref.l) ?? 0) + ref.a);
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

// Оригинальная localStorage.getItem, сохраняется на enable и восстанавливается
// на disable. Хук маскирует текстовый канал в map-config.h, чтобы нативный
// LIGHT-renderer не рисовал свой 32px-текст параллельно с нашим слоем.
let originalGetItem: typeof Storage.prototype.getItem | null = null;

function maskReferencesInMapConfig(rawValue: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawValue) as unknown;
  } catch {
    return rawValue;
  }
  if (typeof parsed !== 'object' || parsed === null) return rawValue;
  const config = parsed as Record<string, unknown>;
  if (typeof config.h !== 'number') return rawValue;
  const textChannel = (config.h & TEXT_CHANNEL_MASK) >> TEXT_CHANNEL_SHIFT;
  if (textChannel !== REFERENCES_MODE_VALUE) return rawValue;
  config.h = config.h & ~TEXT_CHANNEL_MASK;
  return JSON.stringify(config);
}

/**
 * Читает `map-config` напрямую (минуя любые наши патчи) и проверяет, выбран ли
 * пользователем нативный канал References для текстового слоя. Используется
 * на enable, чтобы решить, активировать ли наш слой и подавление нативного
 * рендера: если игрок выключил References в layers-config, нативный 32px-текст
 * не рисуется, наш фикс ему не нужен — модуль уходит в no-op.
 */
function isReferencesEnabledInMapConfig(): boolean {
  const raw = localStorage.getItem(MAP_CONFIG_KEY);
  if (raw === null) return false;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return false;
  }
  if (typeof parsed !== 'object' || parsed === null) return false;
  const config = parsed as Record<string, unknown>;
  if (typeof config.h !== 'number') return false;
  const textChannel = (config.h & TEXT_CHANNEL_MASK) >> TEXT_CHANNEL_SHIFT;
  return textChannel === REFERENCES_MODE_VALUE;
}

function installMapConfigGetItemHook(): void {
  if (originalGetItem !== null) return;
  // eslint-disable-next-line @typescript-eslint/unbound-method -- мы перенесём bind через call внутри patchedGetItem
  const original = Storage.prototype.getItem;
  originalGetItem = original;
  Storage.prototype.getItem = function patchedGetItem(key: string): string | null {
    const value = original.call(this, key);
    if (this !== localStorage || key !== MAP_CONFIG_KEY || value === null) return value;
    return maskReferencesInMapConfig(value);
  };
}

function uninstallMapConfigGetItemHook(): void {
  if (originalGetItem === null) return;
  Storage.prototype.getItem = originalGetItem;
  originalGetItem = null;
}

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

  const textColor = getTextColor();
  const bgColor = getBackgroundColor();
  const fontSize = fontSizeForZoom(zoom);

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
          font: `${fontSize}px Manrope`,
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

export const keyCountFix: IFeatureModule = {
  id: MODULE_ID,
  name: { en: 'Key count on points', ru: 'Количество ключей на точках' },
  description: {
    en: 'When the native References layer is on, replaces it with adaptive-size labels that stay readable at low zoom and do not rotate with the map. Inactive when References is off.',
    ru: 'Когда у игрока включён слой References, заменяет нативную подсветку адаптивными подписями: читаемый размер на любом зуме, числа не вращаются вместе с картой. Если References выключен — модуль ничего не делает.',
  },
  defaultEnabled: true,
  category: 'map',

  init() {},

  enable() {
    // Если игрок не выбрал References в layers-config (refs/game-beta/script.js
    // FeatureStyles.LIGHT case 7), нативный 32px-текст не рисуется, и нашему
    // слою нечего фиксить. Не вешаем хук и не создаём слой — модуль становится
    // полностью пассивным до перезагрузки страницы (смена настройки слоёв в
    // игре требует reload, поэтому динамическая реакция на change не нужна).
    if (!isReferencesEnabledInMapConfig()) return;

    installMapConfigGetItemHook();

    return getOlMap().then((olMap) => {
      const ol = window.ol;
      const OlVectorSource = ol?.source?.Vector;
      const OlVectorLayer = ol?.layer?.Vector;
      if (!OlVectorSource || !OlVectorLayer) return;

      const pointsLayer = findLayerByName(olMap, 'points');
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

    uninstallMapConfigGetItemHook();
  },
};
