import type { IFeatureModule } from '../../core/moduleRegistry';
import type { IOlMap, IOlLayer, IOlVectorSource } from '../../core/olMap';
import { getOlMap, hasTileSource } from '../../core/olMap';
import { injectStyles, removeStyles } from '../../core/dom';
import { t } from '../../core/l10n';
import styles from './styles.css?inline';

const MODULE_ID = 'mapTileLayers';
const STORAGE_KEY_URL = 'svp_mapTileLayerUrl';
const STORAGE_KEY_LAYER = 'svp_mapTileLayer';
const STORAGE_KEY_GAME_LAYER = 'svp_mapTileGameLayer';
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
let lastGameRadioValue: string | null = null;

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
  originalSource = gameTileLayer.getSource();
  originalSetSource = gameTileLayer.setSource.bind(gameTileLayer);
  gameTileLayer.setSource = (source: unknown) => {
    gameRequestedSource = source;
    hasGameRequest = true;
  };
}

/**
 * @param forceOriginal — true при disable модуля: всегда восстанавливать
 *   originalSource (source до custom tiles), игнорируя gameRequestedSource,
 *   который может содержать мусор от обработки игрой неизвестного "svp-custom".
 *   false при переключении на game radio: применить source, запрошенный игрой
 *   (игра уже вызвала setSource для нового baselayer через перехваченный proxy).
 */
function unlockGameSource(forceOriginal = false): void {
  if (!gameTileLayer || !originalSetSource) return;
  gameTileLayer.setSource = originalSetSource;
  if (!forceOriginal && hasGameRequest) {
    gameTileLayer.setSource(gameRequestedSource);
  } else {
    gameTileLayer.setSource(originalSource);
  }
  originalSetSource = null;
  gameRequestedSource = null;
  hasGameRequest = false;
}

function applyTileSource(url: string, variant: string): void {
  const OlXyz = window.ol?.source?.XYZ;
  if (!url || !OlXyz || !gameTileLayer) return;

  lockGameSource();

  const source = new OlXyz({ url });
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

function updateRadioState(urlInput: HTMLTextAreaElement, radios: HTMLInputElement[]): void {
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

  const urlWrapper = document.createElement('div');
  urlWrapper.className = 'layers-config__entry svp-tile-url-entry';
  const urlInput = document.createElement('textarea');
  urlInput.className = 'svp-tile-url-input';
  urlInput.placeholder = 'https://example.com/tiles/{z}/{x}/{y}.png';
  urlInput.value = loadTileUrl();
  urlInput.rows = 2;
  urlWrapper.appendChild(urlInput);

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

  const checkedGameRadio = list.querySelector<HTMLInputElement>('input[name="baselayer"]:checked');
  if (checkedGameRadio && !isCustomValue(checkedGameRadio.value)) {
    lastGameRadioValue = checkedGameRadio.value;
  }

  const saved = loadSelectedLayer();
  if (saved && isCustomValue(saved)) {
    const targetRadio = customRadios.find((r) => r.value === saved);
    if (targetRadio && !targetRadio.disabled) {
      targetRadio.checked = true;
    }
  }

  insertAfter.after(urlWrapper);
  insertAfter.after(customDarkLabel);
  insertAfter.after(customLabel);

  injectedElements.push(customLabel, customDarkLabel, urlWrapper);

  const handleRadioChange = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || target.name !== 'baselayer') return;
    if (isCustomValue(target.value) && target.checked) {
      const url = urlInput.value.trim();
      if (url) {
        if (lastGameRadioValue) {
          localStorage.setItem(STORAGE_KEY_GAME_LAYER, lastGameRadioValue);
        }
        localStorage.setItem(STORAGE_KEY_URL, url);
        localStorage.setItem(STORAGE_KEY_LAYER, target.value);
        applyTileSource(url, target.value);
      }
    } else if (target.checked) {
      lastGameRadioValue = target.value;
      localStorage.removeItem(STORAGE_KEY_GAME_LAYER);
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

/**
 * Restore the game's radio selection in the popup after module disable.
 * Must be called AFTER cleanupInjected (our change handler removed)
 * so the dispatched change event only reaches the game's handler.
 */
function restoreGameRadioSelection(): void {
  const savedValue = lastGameRadioValue ?? localStorage.getItem(STORAGE_KEY_GAME_LAYER);
  if (!savedValue) return;

  const popup = document.querySelector('.layers-config');
  if (!popup) return;

  const radios = popup.querySelectorAll<HTMLInputElement>('input[name="baselayer"]');
  for (const radio of radios) {
    if (radio.value === savedValue) {
      radio.checked = true;
      radio.dispatchEvent(new Event('change', { bubbles: true }));
      break;
    }
  }
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
  defaultEnabled: true,
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

    unlockGameSource(true);
    removeStyles(TILE_FILTER_ID);
    removeStyles(MODULE_ID);
    cleanupInjected();
    restoreGameRadioSelection();
    popupObserver?.disconnect();
    popupObserver = null;

    gameTileLayer = null;
    originalSource = null;
    lastGameRadioValue = null;
  },
};
