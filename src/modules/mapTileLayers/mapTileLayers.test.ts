import {
  mapTileLayers,
  findBaseTileLayer,
  adjustTileYToEllipsoidal,
  needsEllipsoidalProjection,
} from './mapTileLayers';
import type { IOlLayer, IOlMap, IOlTileSource, IOlVectorSource, IOlView } from '../../core/olMap';
import { hasTileSource } from '../../core/olMap';

// ── helpers ──────────────────────────────────────────────────────────────────

function makeFakeSource(): IOlVectorSource {
  return {
    getFeatures: () => [],
    addFeature: jest.fn(),
    clear: jest.fn(),
    on: jest.fn(),
    un: jest.fn(),
  };
}

function makeTileLayer(
  name: string,
  source: IOlVectorSource | null = makeFakeSource(),
): IOlLayer & { setSource: jest.Mock; getSource: () => IOlVectorSource | null } {
  let currentSource = source;
  return {
    get: (key: string) => (key === 'name' ? name : undefined),
    getSource: () => currentSource,
    setSource: jest.fn((s: IOlVectorSource | null) => {
      currentSource = s;
    }),
  };
}

function makeVectorLayer(name: string): IOlLayer {
  return {
    get: (key: string) => (key === 'name' ? name : undefined),
    getSource: () => null,
  };
}

function makeView(): IOlView {
  return {
    padding: [0, 0, 0, 0],
    getCenter: () => undefined,
    setCenter: () => {},
    calculateExtent: () => [0, 0, 0, 0],
    changed: () => {},
    getRotation: () => 0,
    setRotation: () => {},
  };
}

function makeMap(layers: IOlLayer[]): IOlMap {
  return {
    getView: () => makeView(),
    getSize: () => [800, 600],
    getLayers: () => ({ getArray: () => layers }),
    getInteractions: () => ({ getArray: () => [] }),
    addLayer: jest.fn(),
    removeLayer: jest.fn(),
    updateSize: jest.fn(),
  };
}

function mockOlWithXyz(): jest.Mock {
  const xyzConstructor = jest.fn().mockImplementation(() => makeFakeSource());
  window.ol = {
    Map: { prototype: { getView: jest.fn() } },
    source: {
      XYZ: xyzConstructor as unknown as new (opts: {
        url?: string;
        crossOrigin?: string;
        attributions?: string;
        tileUrlFunction?: (coord: number[]) => string;
      }) => IOlTileSource,
    },
  };
  return xyzConstructor;
}

function createLayersConfigPopup(savedBaselayer = 'osm'): HTMLElement {
  const popup = document.createElement('div');
  popup.className = 'layers-config popup pp-center';
  popup.innerHTML = `
    <div class="layers-config__list">
      <h4 class="layers-config__subheader" data-i18n="layers.baselayers.header">Baselayer</h4>
      <label class="layers-config__entry"><input type="radio" name="baselayer" value="nil"> <span>Empty</span></label>
      <label class="layers-config__entry"><input type="radio" name="baselayer" value="osm"${savedBaselayer === 'osm' ? ' checked' : ''}> <span>OSM</span></label>
      <label class="layers-config__entry"><input type="radio" name="baselayer" value="cdb"> <span>Carto</span></label>
      <label class="layers-config__entry"><input type="radio" name="baselayer" value="goo"> <span>Google Satellite</span></label>
    </div>
    <div class="layers-config__buttons">
      <button id="layers-config__save">Save</button>
    </div>
  `;
  return popup;
}

// ── adjustTileYToEllipsoidal ─────────────────────────────────────────────────

describe('adjustTileYToEllipsoidal', () => {
  test('returns same Y at equator (no ellipsoidal correction needed)', () => {
    // At equator, spherical and ellipsoidal Mercator coincide
    const zoom = 10;
    const equatorY = 1 << (zoom - 1); // 512 at z=10 — equator tile
    expect(adjustTileYToEllipsoidal(equatorY, zoom)).toBe(equatorY);
  });

  test('returns higher Y (southward shift) in northern hemisphere', () => {
    // At ~57°N (z=16), ellipsoidal tiles are shifted south relative to spherical
    const zoom = 16;
    const sphericalY = 20531; // approximately 57°N
    const ellipsoidalY = adjustTileYToEllipsoidal(sphericalY, zoom);
    expect(ellipsoidalY).toBeGreaterThan(sphericalY);
  });

  test('offset increases with latitude', () => {
    const zoom = 16;
    const yMid = Math.floor((1 << zoom) * 0.35); // mid-latitude
    const yHigh = Math.floor((1 << zoom) * 0.3); // higher latitude

    const offsetMid = adjustTileYToEllipsoidal(yMid, zoom) - yMid;
    const offsetHigh = adjustTileYToEllipsoidal(yHigh, zoom) - yHigh;

    // Both should have positive offsets (shifted south in tile coords)
    expect(offsetMid).toBeGreaterThan(0);
    expect(offsetHigh).toBeGreaterThan(offsetMid);
  });

  test('produces ~117 tile offset at z=17 for ~57°N', () => {
    // At z=17, y=40396 corresponds to ~56.6°N
    // Expected offset: ~117 tiles (36km / 305.75m per tile)
    const zoom = 17;
    const sphericalY = 40396;
    const ellipsoidalY = adjustTileYToEllipsoidal(sphericalY, zoom);
    const offset = ellipsoidalY - sphericalY;
    expect(offset).toBeGreaterThanOrEqual(110);
    expect(offset).toBeLessThanOrEqual(125);
  });
});

// ── needsEllipsoidalProjection ───────────────────────────────────────────────

describe('needsEllipsoidalProjection', () => {
  test('returns true for tile servers using EPSG:3395', () => {
    const url =
      'https://core-renderer-tiles.maps.example.net/tiles?l=map&x={x}&y={y}&z={z}&scale=1&lang=ru_RU';
    expect(needsEllipsoidalProjection(url)).toBe(true);
  });

  test('returns false for standard XYZ tile servers', () => {
    expect(needsEllipsoidalProjection('https://tile.openstreetmap.org/{z}/{x}/{y}.png')).toBe(
      false,
    );
    expect(
      needsEllipsoidalProjection('https://c.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png'),
    ).toBe(false);
  });

  test('returns false for invalid URLs', () => {
    expect(needsEllipsoidalProjection('not-a-url')).toBe(false);
    expect(needsEllipsoidalProjection('')).toBe(false);
  });
});

// ── hasTileSource type guard ─────────────────────────────────────────────────

describe('hasTileSource', () => {
  test('returns true for layer with setSource function', () => {
    const layer = makeTileLayer('base');
    expect(hasTileSource(layer)).toBe(true);
  });

  test('returns false for layer without setSource', () => {
    const layer = makeVectorLayer('points');
    expect(hasTileSource(layer)).toBe(false);
  });
});

// ── findBaseTileLayer ────────────────────────────────────────────────────────

describe('findBaseTileLayer', () => {
  test('finds first non-points layer with setSource', () => {
    const tileLayer = makeTileLayer('base');
    const pointsLayer = makeVectorLayer('points');
    const olMap = makeMap([tileLayer, pointsLayer]);
    expect(findBaseTileLayer(olMap)).toBe(tileLayer);
  });

  test('skips points layer', () => {
    const pointsLayer = makeVectorLayer('points');
    const tileLayer = makeTileLayer('tiles');
    const olMap = makeMap([pointsLayer, tileLayer]);
    expect(findBaseTileLayer(olMap)).toBe(tileLayer);
  });

  test('returns null when no tile layer found', () => {
    const pointsLayer = makeVectorLayer('points');
    const olMap = makeMap([pointsLayer]);
    expect(findBaseTileLayer(olMap)).toBeNull();
  });

  test('returns null for empty layers', () => {
    const olMap = makeMap([]);
    expect(findBaseTileLayer(olMap)).toBeNull();
  });
});

// ── module metadata ──────────────────────────────────────────────────────────

describe('mapTileLayers metadata', () => {
  test('has correct id', () => {
    expect(mapTileLayers.id).toBe('mapTileLayers');
  });

  test('has map category', () => {
    expect(mapTileLayers.category).toBe('map');
  });

  test('is disabled by default', () => {
    expect(mapTileLayers.defaultEnabled).toBe(false);
  });

  test('has localized name and description', () => {
    expect(mapTileLayers.name.ru).toBeTruthy();
    expect(mapTileLayers.name.en).toBeTruthy();
    expect(mapTileLayers.description.ru).toBeTruthy();
    expect(mapTileLayers.description.en).toBeTruthy();
  });
});

// ── enable / disable ─────────────────────────────────────────────────────────

jest.mock('../../core/olMap', () => {
  const actual = jest.requireActual<typeof import('../../core/olMap')>('../../core/olMap');
  return {
    ...actual,
    getOlMap: jest.fn(),
  };
});

import { getOlMap } from '../../core/olMap';

const mockGetOlMap = getOlMap as jest.MockedFunction<typeof getOlMap>;

describe('mapTileLayers enable/disable', () => {
  let tileLayer: ReturnType<typeof makeTileLayer>;
  let olMap: IOlMap;

  beforeEach(() => {
    localStorage.removeItem('svp_mapTileLayer');
    localStorage.removeItem('svp_mapTileLayerUrl');
    localStorage.removeItem('svp_mapTileGameLayer');
    tileLayer = makeTileLayer('base');
    const pointsLayer = makeVectorLayer('points');
    olMap = makeMap([tileLayer, pointsLayer]);
    mockGetOlMap.mockResolvedValue(olMap);
    mockOlWithXyz();
  });

  afterEach(async () => {
    await mapTileLayers.disable();
    delete window.ol;
    document.querySelectorAll('.layers-config').forEach((el) => {
      el.remove();
    });
  });

  test('saves original source on enable', async () => {
    const originalSource = tileLayer.getSource();
    await mapTileLayers.enable();
    // Source should remain unchanged (no custom layer selected)
    expect(tileLayer.getSource()).toBe(originalSource);
  });

  test('applies custom source on enable when saved in localStorage', async () => {
    const originalSource = tileLayer.getSource();
    localStorage.setItem('svp_mapTileLayer', 'svp-custom');
    localStorage.setItem('svp_mapTileLayerUrl', 'https://example.com/{z}/{x}/{y}.png');
    await mapTileLayers.enable();
    // Source should have been replaced with XYZ source
    expect(tileLayer.getSource()).not.toBe(originalSource);
  });

  test('restores original source on disable', async () => {
    const originalSource = tileLayer.getSource();
    localStorage.setItem('svp_mapTileLayer', 'svp-custom');
    localStorage.setItem('svp_mapTileLayerUrl', 'https://example.com/{z}/{x}/{y}.png');
    await mapTileLayers.enable();
    await mapTileLayers.disable();
    expect(tileLayer.getSource()).toBe(originalSource);
  });

  test('handles disable before getOlMap resolves', async () => {
    let resolveMap: (map: IOlMap) => void = () => {};
    mockGetOlMap.mockReturnValue(
      new Promise((resolve) => {
        resolveMap = resolve;
      }),
    );

    const enablePromise = mapTileLayers.enable();
    await mapTileLayers.disable();
    resolveMap(olMap);
    await enablePromise;

    // Should not have modified the tile layer since disable was called first
    expect(tileLayer.setSource).not.toHaveBeenCalled();
  });

  test('does nothing if tile layer not found', async () => {
    const olMapNoTiles = makeMap([makeVectorLayer('points')]);
    mockGetOlMap.mockResolvedValue(olMapNoTiles);
    await mapTileLayers.enable();
    // Should not throw
  });
});

// ── setSource interception ──────────────────────────────────────────────────

describe('mapTileLayers setSource interception', () => {
  let tileLayer: ReturnType<typeof makeTileLayer>;

  beforeEach(() => {
    localStorage.removeItem('svp_mapTileLayer');
    localStorage.removeItem('svp_mapTileLayerUrl');
    localStorage.removeItem('svp_mapTileGameLayer');
    tileLayer = makeTileLayer('base');
    const pointsLayer = makeVectorLayer('points');
    const olMap = makeMap([tileLayer, pointsLayer]);
    mockGetOlMap.mockResolvedValue(olMap);
    mockOlWithXyz();
  });

  afterEach(async () => {
    await mapTileLayers.disable();
    delete window.ol;
    document.querySelectorAll('.layers-config').forEach((el) => {
      el.remove();
    });
  });

  test('blocks game setSource calls while custom tiles active', async () => {
    localStorage.setItem('svp_mapTileLayer', 'svp-custom');
    localStorage.setItem('svp_mapTileLayerUrl', 'https://example.com/{z}/{x}/{y}.png');
    await mapTileLayers.enable();

    const customSource = tileLayer.getSource();

    // Simulate game trying to overwrite the source
    tileLayer.setSource(makeFakeSource());

    // Our custom source should still be active (game call was intercepted)
    expect(tileLayer.getSource()).toBe(customSource);
  });

  test('disable ignores game setSource requests and restores pre-lock source', async () => {
    const sourceBeforeCustom = tileLayer.getSource();
    localStorage.setItem('svp_mapTileLayer', 'svp-custom');
    localStorage.setItem('svp_mapTileLayerUrl', 'https://example.com/{z}/{x}/{y}.png');
    await mapTileLayers.enable();

    // Simulate game calling setSource for unknown "svp-custom" value (garbage)
    tileLayer.setSource(makeFakeSource());

    // Disable should restore source from before custom, not game's garbage
    await mapTileLayers.disable();
    expect(tileLayer.getSource()).toBe(sourceBeforeCustom);
  });

  test('restores original source when game made no request', async () => {
    const originalSource = tileLayer.getSource();
    localStorage.setItem('svp_mapTileLayer', 'svp-custom');
    localStorage.setItem('svp_mapTileLayerUrl', 'https://example.com/{z}/{x}/{y}.png');
    await mapTileLayers.enable();

    // No game source request
    await mapTileLayers.disable();
    expect(tileLayer.getSource()).toBe(originalSource);
  });

  test('lockGameSource captures current source for accurate restore', async () => {
    await mapTileLayers.enable();

    // Simulate game changing source (e.g., user switched to Carto)
    const cartoSource = makeFakeSource();
    tileLayer.setSource(cartoSource);

    // Now select custom tiles — lockGameSource should capture cartoSource
    localStorage.setItem('svp_mapTileLayerUrl', 'https://example.com/{z}/{x}/{y}.png');
    localStorage.setItem('svp_mapTileLayer', 'svp-custom');

    // Re-enable to trigger custom source application (lockGameSource captures current)
    await mapTileLayers.disable();
    await mapTileLayers.enable();

    // Disable should restore cartoSource (captured at lock time), not original OSM
    await mapTileLayers.disable();
    expect(tileLayer.getSource()).toBe(cartoSource);
  });

  test('restores original setSource method on disable', async () => {
    localStorage.setItem('svp_mapTileLayer', 'svp-custom');
    localStorage.setItem('svp_mapTileLayerUrl', 'https://example.com/{z}/{x}/{y}.png');
    await mapTileLayers.enable();

    // setSource should be proxied — calling it should not change the source
    const customSource = tileLayer.getSource();
    tileLayer.setSource(makeFakeSource());
    expect(tileLayer.getSource()).toBe(customSource);

    await mapTileLayers.disable();

    // setSource should be restored — calling it should change the source
    const newSource = makeFakeSource();
    tileLayer.setSource(newSource);
    expect(tileLayer.getSource()).toBe(newSource);
  });
});

// ── popup injection ──────────────────────────────────────────────────────────

describe('mapTileLayers popup injection', () => {
  let tileLayer: ReturnType<typeof makeTileLayer>;
  let xyzConstructor: jest.Mock;

  beforeEach(() => {
    localStorage.removeItem('svp_mapTileLayer');
    localStorage.removeItem('svp_mapTileLayerUrl');
    localStorage.removeItem('svp_mapTileGameLayer');
    tileLayer = makeTileLayer('base');
    const pointsLayer = makeVectorLayer('points');
    const olMap = makeMap([tileLayer, pointsLayer]);
    mockGetOlMap.mockResolvedValue(olMap);
    xyzConstructor = mockOlWithXyz();
  });

  afterEach(async () => {
    await mapTileLayers.disable();
    delete window.ol;
    document.querySelectorAll('.layers-config').forEach((el) => {
      el.remove();
    });
  });

  test('injects custom radio buttons when popup appears', async () => {
    await mapTileLayers.enable();

    const popup = createLayersConfigPopup();
    document.body.appendChild(popup);

    // Wait for MutationObserver to fire
    await new Promise((resolve) => setTimeout(resolve, 0));

    const customRadio = popup.querySelector<HTMLInputElement>(
      'input[name="baselayer"][value="svp-custom"]',
    );
    expect(customRadio).not.toBeNull();

    // Dark variant should not exist
    const darkRadio = popup.querySelector<HTMLInputElement>(
      'input[name="baselayer"][value="svp-custom-dark"]',
    );
    expect(darkRadio).toBeNull();
  });

  test('URL input is a textarea for multi-line display', async () => {
    await mapTileLayers.enable();

    const popup = createLayersConfigPopup();
    document.body.appendChild(popup);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const urlInput = popup.querySelector('.svp-tile-url-input');
    expect(urlInput).not.toBeNull();
    expect(urlInput?.tagName).toBe('TEXTAREA');
  });

  test('radio buttons are disabled when URL is empty', async () => {
    await mapTileLayers.enable();

    const popup = createLayersConfigPopup();
    document.body.appendChild(popup);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const customRadio = popup.querySelector<HTMLInputElement>(
      'input[name="baselayer"][value="svp-custom"]',
    );
    expect(customRadio?.disabled).toBe(true);
  });

  test('radio buttons are enabled when URL is set', async () => {
    localStorage.setItem('svp_mapTileLayerUrl', 'https://example.com/{z}/{x}/{y}.png');
    await mapTileLayers.enable();

    const popup = createLayersConfigPopup();
    document.body.appendChild(popup);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const customRadio = popup.querySelector<HTMLInputElement>(
      'input[name="baselayer"][value="svp-custom"]',
    );
    expect(customRadio?.disabled).toBe(false);
  });

  test('selecting custom radio instantly applies tiles and persists', async () => {
    localStorage.setItem('svp_mapTileLayerUrl', 'https://example.com/{z}/{x}/{y}.png');
    await mapTileLayers.enable();

    const originalSource = tileLayer.getSource();
    const popup = createLayersConfigPopup();
    document.body.appendChild(popup);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const customRadio = popup.querySelector<HTMLInputElement>(
      'input[name="baselayer"][value="svp-custom"]',
    );
    if (customRadio) {
      customRadio.checked = true;
      customRadio.dispatchEvent(new Event('change', { bubbles: true }));
    }

    expect(tileLayer.getSource()).not.toBe(originalSource);
    expect(localStorage.getItem('svp_mapTileLayer')).toBe('svp-custom');
  });

  test('selecting game radio restores and clears localStorage', async () => {
    localStorage.setItem('svp_mapTileLayerUrl', 'https://example.com/{z}/{x}/{y}.png');
    localStorage.setItem('svp_mapTileLayer', 'svp-custom');
    await mapTileLayers.enable();

    const popup = createLayersConfigPopup();
    document.body.appendChild(popup);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const osmRadio = popup.querySelector<HTMLInputElement>('input[name="baselayer"][value="osm"]');
    if (osmRadio) {
      osmRadio.checked = true;
      osmRadio.dispatchEvent(new Event('change', { bubbles: true }));
    }

    expect(localStorage.getItem('svp_mapTileLayer')).toBeNull();
  });

  test('save button does not affect custom tiles', async () => {
    localStorage.setItem('svp_mapTileLayerUrl', 'https://example.com/{z}/{x}/{y}.png');
    await mapTileLayers.enable();

    const popup = createLayersConfigPopup();
    document.body.appendChild(popup);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const sourceBeforeSave = tileLayer.getSource();
    const saveButton = popup.querySelector('#layers-config__save');
    saveButton?.dispatchEvent(new Event('click', { bubbles: true }));

    // Save should not change source
    expect(tileLayer.getSource()).toBe(sourceBeforeSave);
  });

  test('does not inject CSS filter for custom tiles (game handles theme filters)', async () => {
    localStorage.setItem('svp_mapTileLayerUrl', 'https://example.com/{z}/{x}/{y}.png');
    localStorage.setItem('svp_mapTileLayer', 'svp-custom');
    await mapTileLayers.enable();

    const filterStyle = document.getElementById('svp-mapTileLayersFilter');
    expect(filterStyle).toBeNull();
  });

  test('cleans up injected elements on disable', async () => {
    await mapTileLayers.enable();

    const popup = createLayersConfigPopup();
    document.body.appendChild(popup);
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Verify injection happened
    expect(popup.querySelector('.svp-tile-url-input')).not.toBeNull();

    await mapTileLayers.disable();

    // Injected elements should be removed
    expect(popup.querySelector('.svp-tile-url-input')).toBeNull();
    expect(popup.querySelector('input[value="svp-custom"]')).toBeNull();
  });

  test('disable restores game radio selection in popup', async () => {
    localStorage.setItem('svp_mapTileLayerUrl', 'https://example.com/{z}/{x}/{y}.png');
    await mapTileLayers.enable();

    const popup = createLayersConfigPopup();
    document.body.appendChild(popup);
    await new Promise((resolve) => setTimeout(resolve, 0));

    // OSM is checked by default in our test popup
    const osmRadio = popup.querySelector<HTMLInputElement>('input[name="baselayer"][value="osm"]');
    expect(osmRadio?.checked).toBe(true);

    // Select custom tiles
    const customRadio = popup.querySelector<HTMLInputElement>(
      'input[name="baselayer"][value="svp-custom"]',
    );
    if (customRadio) {
      customRadio.checked = true;
      customRadio.dispatchEvent(new Event('change', { bubbles: true }));
    }

    // OSM is now unchecked (same radio name group)
    expect(osmRadio?.checked).toBe(false);

    // Disable module → should restore OSM radio
    await mapTileLayers.disable();

    // Our custom radio is removed, OSM should be re-checked
    expect(popup.querySelector('input[value="svp-custom"]')).toBeNull();
    expect(osmRadio?.checked).toBe(true);
  });

  test('saves game radio value to localStorage on custom select', async () => {
    localStorage.setItem('svp_mapTileLayerUrl', 'https://example.com/{z}/{x}/{y}.png');
    await mapTileLayers.enable();

    const popup = createLayersConfigPopup();
    document.body.appendChild(popup);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const customRadio = popup.querySelector<HTMLInputElement>(
      'input[name="baselayer"][value="svp-custom"]',
    );
    if (customRadio) {
      customRadio.checked = true;
      customRadio.dispatchEvent(new Event('change', { bubbles: true }));
    }

    expect(localStorage.getItem('svp_mapTileGameLayer')).toBe('osm');
  });

  test('clears game radio from localStorage when game radio selected', async () => {
    localStorage.setItem('svp_mapTileLayerUrl', 'https://example.com/{z}/{x}/{y}.png');
    localStorage.setItem('svp_mapTileLayer', 'svp-custom');
    localStorage.setItem('svp_mapTileGameLayer', 'osm');
    await mapTileLayers.enable();

    const popup = createLayersConfigPopup();
    document.body.appendChild(popup);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const cdbRadio = popup.querySelector<HTMLInputElement>('input[name="baselayer"][value="cdb"]');
    if (cdbRadio) {
      cdbRadio.checked = true;
      cdbRadio.dispatchEvent(new Event('change', { bubbles: true }));
    }

    expect(localStorage.getItem('svp_mapTileGameLayer')).toBeNull();
  });

  test('URL input change re-applies tiles when custom radio is selected', async () => {
    localStorage.setItem('svp_mapTileLayerUrl', 'https://example.com/{z}/{x}/{y}.png');
    localStorage.setItem('svp_mapTileLayer', 'svp-custom');
    await mapTileLayers.enable();

    const popup = createLayersConfigPopup();
    document.body.appendChild(popup);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const urlInput = popup.querySelector<HTMLTextAreaElement>('.svp-tile-url-input');
    if (urlInput) {
      urlInput.value = 'https://new-tiles.example.com/{z}/{x}/{y}.png';
      urlInput.dispatchEvent(new Event('input'));
    }

    expect(localStorage.getItem('svp_mapTileLayerUrl')).toBe(
      'https://new-tiles.example.com/{z}/{x}/{y}.png',
    );
  });

  test('uses tileUrlFunction for EPSG:3395 tile server URLs', async () => {
    const ellipsoidalUrl =
      'https://core-renderer-tiles.maps.example.net/tiles?l=map&x={x}&y={y}&z={z}';
    localStorage.setItem('svp_mapTileLayerUrl', ellipsoidalUrl);
    localStorage.setItem('svp_mapTileLayer', 'svp-custom');
    await mapTileLayers.enable();

    // XYZ constructor should have been called with tileUrlFunction (not url)
    const lastCallArgs = xyzConstructor.mock.lastCall as unknown[];
    const lastCall = lastCallArgs[0] as Record<string, unknown>;
    expect(lastCall).toHaveProperty('tileUrlFunction');
    expect(lastCall).not.toHaveProperty('url');
  });

  test('uses url template for standard tile server URLs', async () => {
    localStorage.setItem('svp_mapTileLayerUrl', 'https://tile.openstreetmap.org/{z}/{x}/{y}.png');
    localStorage.setItem('svp_mapTileLayer', 'svp-custom');
    await mapTileLayers.enable();

    const lastCallArgs = xyzConstructor.mock.lastCall as unknown[];
    const lastCall = lastCallArgs[0] as Record<string, unknown>;
    expect(lastCall).toHaveProperty('url');
    expect(lastCall).not.toHaveProperty('tileUrlFunction');
  });
});

// ── persistence ──────────────────────────────────────────────────────────────

describe('mapTileLayers persistence', () => {
  beforeEach(() => {
    localStorage.removeItem('svp_mapTileLayer');
    localStorage.removeItem('svp_mapTileLayerUrl');
    localStorage.removeItem('svp_mapTileGameLayer');
  });

  test('selecting custom radio persists both URL and variant', async () => {
    const tileLayer = makeTileLayer('base');
    const olMap = makeMap([tileLayer, makeVectorLayer('points')]);
    mockGetOlMap.mockResolvedValue(olMap);
    mockOlWithXyz();

    localStorage.setItem('svp_mapTileLayerUrl', 'https://tiles.example.com/{z}/{x}/{y}.png');
    await mapTileLayers.enable();

    const popup = createLayersConfigPopup();
    document.body.appendChild(popup);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const customRadio = popup.querySelector<HTMLInputElement>(
      'input[name="baselayer"][value="svp-custom"]',
    );
    if (customRadio) {
      customRadio.checked = true;
      customRadio.dispatchEvent(new Event('change', { bubbles: true }));
    }

    expect(localStorage.getItem('svp_mapTileLayerUrl')).toBe(
      'https://tiles.example.com/{z}/{x}/{y}.png',
    );
    expect(localStorage.getItem('svp_mapTileLayer')).toBe('svp-custom');

    await mapTileLayers.disable();
    delete window.ol;
    popup.remove();
  });

  test('disable + re-enable restores custom tiles from localStorage', async () => {
    const tileLayer = makeTileLayer('base');
    const olMap = makeMap([tileLayer, makeVectorLayer('points')]);
    mockGetOlMap.mockResolvedValue(olMap);
    mockOlWithXyz();

    localStorage.setItem('svp_mapTileLayerUrl', 'https://tiles.example.com/{z}/{x}/{y}.png');
    localStorage.setItem('svp_mapTileLayer', 'svp-custom');

    // Enable → custom tiles applied
    await mapTileLayers.enable();
    const sourceBeforeDisable = tileLayer.getSource();

    // Disable → original source restored
    await mapTileLayers.disable();
    const sourceAfterDisable = tileLayer.getSource();
    expect(sourceAfterDisable).not.toBe(sourceBeforeDisable);

    // Re-enable → custom tiles should come back
    await mapTileLayers.enable();
    expect(tileLayer.getSource()).not.toBe(sourceAfterDisable);

    // URL and variant still in localStorage
    expect(localStorage.getItem('svp_mapTileLayerUrl')).toBe(
      'https://tiles.example.com/{z}/{x}/{y}.png',
    );
    expect(localStorage.getItem('svp_mapTileLayer')).toBe('svp-custom');

    await mapTileLayers.disable();
    delete window.ol;
  });
});
