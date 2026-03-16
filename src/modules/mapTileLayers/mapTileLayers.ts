import type { IFeatureModule } from '../../core/moduleRegistry';
import type { IOlMap, IOlLayer, IOlVectorSource } from '../../core/olMap';
import { getOlMap, hasTileSource } from '../../core/olMap';
import { injectStyles, removeStyles } from '../../core/dom';
import { t } from '../../core/l10n';
import styles from './styles.css?inline';

const MODULE_ID = 'mapTileLayers';
const STORAGE_KEY_URL = 'svp_mapTileLayerUrl';
const STORAGE_KEY_LAYER = 'svp_mapTileLayer';
const CUSTOM_VALUE = 'svp-custom';
const CUSTOM_DARK_VALUE = 'svp-custom-dark';
const TILE_FILTER_ID = 'mapTileLayersFilter';
const LIGHT_FILTER_CSS = '.ol-layer__base canvas { filter: none !important; }';
const DARK_FILTER_CSS =
  '.ol-layer__base canvas { filter: invert(1) hue-rotate(180deg) !important; }';

type TileLayer = IOlLayer & {
  setSource(source: unknown): void;
};

const LABEL_CUSTOM = { en: 'Custom tiles', ru: 'Свои тайлы' };
const LABEL_CUSTOM_DARK = { en: 'Custom tiles (dark)', ru: 'Свои тайлы (тёмная)' };
const LABEL_HEADER = { en: 'SBG Vanilla+', ru: 'SBG Vanilla+' };

// WGS84 ellipsoid parameters for EPSG:3395 coordinate transformation
const WGS84_ECCENTRICITY = 0.0818191908426;
const HALF_ECCENTRICITY = WGS84_ECCENTRICITY / 2;
const EARTH_RADIUS = 6378137;
const MERCATOR_EXTENT = Math.PI * EARTH_RADIUS;

let enabled = false;
let gameTileLayer: TileLayer | null = null;
let originalSource: IOlVectorSource | null = null;
let originalSetSource: ((source: unknown) => void) | null = null;
let gameRequestedSource: unknown = null;
let hasGameRequest = false;
let popupObserver: MutationObserver | null = null;
let injectedElements: HTMLElement[] = [];
let boundChangeHandler: ((event: Event) => void) | null = null;
let changeTarget: Element | null = null;

/**
 * Convert standard XYZ tile Y to latitude (EPSG:3857 spherical Mercator inverse).
 */
function sphericalTileYToLatitude(tileY: number, zoom: number): number {
  const n = Math.PI * (1 - (2 * tileY) / (1 << zoom));
  return Math.atan(Math.sinh(n));
}

/**
 * Convert latitude to tile Y in EPSG:3395 (ellipsoidal Mercator) tile grid.
 */
function latitudeToEllipsoidalTileY(latitude: number, zoom: number): number {
  const sinLatitude = Math.sin(latitude);
  const mercatorY =
    EARTH_RADIUS *
    Math.log(
      Math.tan(Math.PI / 4 + latitude / 2) *
        Math.pow(
          (1 - WGS84_ECCENTRICITY * sinLatitude) / (1 + WGS84_ECCENTRICITY * sinLatitude),
          HALF_ECCENTRICITY,
        ),
    );
  return Math.floor(((1 << zoom) * (1 - mercatorY / MERCATOR_EXTENT)) / 2);
}

/**
 * Adjust tile Y from EPSG:3857 (spherical Mercator) to EPSG:3395 (ellipsoidal Mercator).
 *
 * EPSG:3857 uses a sphere, EPSG:3395 uses the WGS84 ellipsoid. The difference
 * causes a latitude-dependent offset (up to ~36 km at 57°N). This function
 * converts tile Y so that a tile server expecting ellipsoidal coordinates
 * returns the correct geographic area.
 */
export function adjustTileYToEllipsoidal(tileY: number, zoom: number): number {
  const latitude = sphericalTileYToLatitude(tileY, zoom);
  return latitudeToEllipsoidalTileY(latitude, zoom);
}

/**
 * Detect tile servers that use EPSG:3395 (ellipsoidal Mercator) by URL pattern.
 * These servers require Y coordinate adjustment to align with OpenLayers' EPSG:3857 map.
 */
export function needsEllipsoidalProjection(url: string): boolean {
  try {
    const parsed = new URL(url.replace(/\{[xyz]\}/g, '0'));
    return parsed.hostname.startsWith('core-renderer-tiles.maps.');
  } catch {
    return false;
  }
}

export function findBaseTileLayer(olMap: IOlMap): TileLayer | null {
  for (const layer of olMap.getLayers().getArray()) {
    if (layer.get('name') === 'points') continue;
    if (hasTileSource(layer)) return layer;
  }
  return null;
}

function loadSelectedLayer(): string | null {
  return localStorage.getItem(STORAGE_KEY_LAYER);
}

function loadTileUrl(): string {
  return localStorage.getItem(STORAGE_KEY_URL) ?? '';
}

function isCustomValue(value: string): boolean {
  return value === CUSTOM_VALUE || value === CUSTOM_DARK_VALUE;
}

function lockGameSource(): void {
  if (!gameTileLayer || originalSetSource) return;
  originalSetSource = gameTileLayer.setSource.bind(gameTileLayer);
  gameTileLayer.setSource = (source: unknown) => {
    gameRequestedSource = source;
    hasGameRequest = true;
  };
}

function unlockGameSource(): void {
  if (!gameTileLayer || !originalSetSource) return;
  gameTileLayer.setSource = originalSetSource;
  if (hasGameRequest) {
    gameTileLayer.setSource(gameRequestedSource);
  } else {
    gameTileLayer.setSource(originalSource);
  }
  originalSetSource = null;
  gameRequestedSource = null;
  hasGameRequest = false;
}

/**
 * Build a tileUrlFunction that adjusts Y coordinates for EPSG:3395 tile servers.
 *
 * Different OpenLayers versions pass tile coordinates in different formats:
 * some use negative internal encoding (y = -(row + 1)), others pass standard
 * XYZ y directly. We handle both by normalizing negative values.
 */
function buildEllipsoidalTileUrlFunction(urlTemplate: string): (coord: number[]) => string {
  return (coord: number[]) => {
    const zoom = coord[0];
    const x = coord[1];
    const y = coord[2] < 0 ? -coord[2] - 1 : coord[2];
    const adjustedY = adjustTileYToEllipsoidal(y, zoom);
    return urlTemplate
      .replace('{z}', String(zoom))
      .replace('{x}', String(x))
      .replace('{y}', String(adjustedY));
  };
}

function applyTileSource(url: string, variant: string): void {
  const OlXyz = window.ol?.source?.XYZ;
  if (!url || !OlXyz || !gameTileLayer) return;

  lockGameSource();

  const source = needsEllipsoidalProjection(url)
    ? new OlXyz({ tileUrlFunction: buildEllipsoidalTileUrlFunction(url) })
    : new OlXyz({ url });
  if (originalSetSource) {
    originalSetSource(source);
  }

  const isDark = variant === CUSTOM_DARK_VALUE;
  injectStyles(isDark ? DARK_FILTER_CSS : LIGHT_FILTER_CSS, TILE_FILTER_ID);
}

function removeCustomTiles(): void {
  unlockGameSource();
  removeStyles(TILE_FILTER_ID);
}

function applyCustomSource(): void {
  const url = loadTileUrl();
  const variant = loadSelectedLayer();
  if (!variant || !isCustomValue(variant)) return;
  applyTileSource(url, variant);
}

function updateRadioState(urlInput: HTMLInputElement, radios: HTMLInputElement[]): void {
  const hasUrl = urlInput.value.trim().length > 0;
  for (const radio of radios) {
    radio.disabled = !hasUrl;
  }
}

function injectIntoPopup(popup: Element): void {
  const list = popup.querySelector('.layers-config__list');
  if (!list) return;

  const lastGameRadio = popup.querySelector<HTMLInputElement>(
    'input[name="baselayer"][value="goo"]',
  );
  const insertAfter = lastGameRadio?.closest('.layers-config__entry') ?? null;
  if (!insertAfter) return;

  const header = document.createElement('h4');
  header.className = 'layers-config__subheader';
  header.textContent = t(LABEL_HEADER);

  const urlLabel = document.createElement('label');
  urlLabel.className = 'layers-config__entry svp-tile-url-entry';
  const urlInput = document.createElement('input');
  urlInput.type = 'text';
  urlInput.className = 'svp-tile-url-input';
  urlInput.placeholder = 'https://example.com/tiles/{z}/{x}/{y}.png';
  urlInput.value = loadTileUrl();
  urlLabel.appendChild(urlInput);

  const customRadios: HTMLInputElement[] = [];

  function createRadioLabel(value: string, label: { en: string; ru: string }): HTMLLabelElement {
    const radioLabel = document.createElement('label');
    radioLabel.className = 'layers-config__entry';
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'baselayer';
    radio.value = value;
    radio.disabled = !urlInput.value.trim();
    customRadios.push(radio);
    const span = document.createElement('span');
    span.textContent = t(label);
    radioLabel.append(radio, ' ', span);
    return radioLabel;
  }

  const customLabel = createRadioLabel(CUSTOM_VALUE, LABEL_CUSTOM);
  const customDarkLabel = createRadioLabel(CUSTOM_DARK_VALUE, LABEL_CUSTOM_DARK);

  urlInput.addEventListener('input', () => {
    updateRadioState(urlInput, customRadios);
    const checkedCustom = customRadios.find((r) => r.checked);
    if (checkedCustom) {
      const url = urlInput.value.trim();
      if (url) {
        localStorage.setItem(STORAGE_KEY_URL, url);
        applyTileSource(url, checkedCustom.value);
      }
    }
  });

  const saved = loadSelectedLayer();
  if (saved && isCustomValue(saved)) {
    const targetRadio = customRadios.find((r) => r.value === saved);
    if (targetRadio && !targetRadio.disabled) {
      targetRadio.checked = true;
    }
  }

  insertAfter.after(customDarkLabel);
  insertAfter.after(customLabel);
  insertAfter.after(urlLabel);
  insertAfter.after(header);

  injectedElements.push(header, urlLabel, customLabel, customDarkLabel);

  const handleRadioChange = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || target.name !== 'baselayer') return;
    if (isCustomValue(target.value) && target.checked) {
      const url = urlInput.value.trim();
      if (url) {
        localStorage.setItem(STORAGE_KEY_URL, url);
        localStorage.setItem(STORAGE_KEY_LAYER, target.value);
        applyTileSource(url, target.value);
      }
    } else if (target.checked) {
      localStorage.removeItem(STORAGE_KEY_LAYER);
      removeCustomTiles();
    }
  };
  boundChangeHandler = handleRadioChange;
  changeTarget = list;
  list.addEventListener('change', handleRadioChange);
}

function cleanupInjected(): void {
  if (changeTarget && boundChangeHandler) {
    changeTarget.removeEventListener('change', boundChangeHandler);
    boundChangeHandler = null;
    changeTarget = null;
  }
  for (const element of injectedElements) {
    element.remove();
  }
  injectedElements = [];
}

function onMutation(mutations: MutationRecord[]): void {
  for (const mutation of mutations) {
    for (const node of mutation.addedNodes) {
      if (node instanceof HTMLElement && node.classList.contains('layers-config')) {
        injectIntoPopup(node);
        return;
      }
    }
    for (const node of mutation.removedNodes) {
      if (node instanceof HTMLElement && node.classList.contains('layers-config')) {
        cleanupInjected();
        return;
      }
    }
  }
}

export const mapTileLayers: IFeatureModule = {
  id: MODULE_ID,
  name: { en: 'Custom map tiles', ru: 'Свои тайлы карты' },
  description: {
    en: 'Adds custom tile layers to the map layer switcher',
    ru: 'Добавляет свои тайлы карты в переключатель слоёв',
  },
  defaultEnabled: false,
  category: 'map',

  init() {},

  enable() {
    enabled = true;
    return getOlMap().then((olMap) => {
      if (!enabled) return;

      gameTileLayer = findBaseTileLayer(olMap);
      if (!gameTileLayer) return;

      originalSource = gameTileLayer.getSource();

      const saved = loadSelectedLayer();
      const url = loadTileUrl();
      if (saved && isCustomValue(saved) && url) {
        applyCustomSource();
      }

      injectStyles(styles, MODULE_ID);

      const existingPopup = document.querySelector('.layers-config');
      if (existingPopup) {
        injectIntoPopup(existingPopup);
      }

      popupObserver = new MutationObserver(onMutation);
      popupObserver.observe(document.body, { childList: true });
    });
  },

  disable() {
    enabled = false;

    removeCustomTiles();
    removeStyles(MODULE_ID);
    cleanupInjected();
    popupObserver?.disconnect();
    popupObserver = null;

    gameTileLayer = null;
    originalSource = null;
  },
};
