/**
 * Capture the OL Map instance created by the game.
 *
 * The game stores `map` in a local variable (not on `window`).
 * We intercept `ol.Map.prototype.getView` — it is called during
 * map construction, so the capture happens almost immediately.
 *
 * Since the game script loads as a dynamic `type="module"`, `window.ol`
 * may not be available yet at `document-idle`. We handle both cases:
 * - ol already loaded → hook prototype immediately
 * - ol not yet loaded → intercept `window.ol` assignment via defineProperty
 */

export interface IOlView {
  padding: number[];
  getCenter(): number[] | undefined;
  setCenter(center: number[] | undefined): void;
  calculateExtent(size?: number[]): number[];
  changed(): void;
  getRotation(): number;
  setRotation(rotation: number): void;
  adjustRotation?(delta: number, anchor?: number[]): void;
  getZoom?(): number | undefined;
  setZoom?(zoom: number): void;
  on?(type: string, listener: () => void): void;
  un?(type: string, listener: () => void): void;
}

export interface IOlFeature {
  getGeometry(): { getCoordinates(): number[] };
  getId(): string | number | undefined;
  setId(id: string): void;
  setStyle(style: unknown): void;
}

export interface IOlVectorSource {
  getFeatures(): IOlFeature[];
  addFeature(feature: IOlFeature): void;
  clear(): void;
  on(type: string, listener: () => void): void;
  un(type: string, listener: () => void): void;
}

export interface IOlTileSource {
  readonly __brand?: 'OlTileSource';
}

export interface IOlLayer {
  get(key: string): unknown;
  getSource(): IOlVectorSource | null;
}

export function hasTileSource(layer: IOlLayer): layer is IOlLayer & {
  setSource(source: unknown): void;
} {
  return 'setSource' in layer && typeof (layer as Record<string, unknown>).setSource === 'function';
}

export interface IOlInteraction {
  setActive(active: boolean): void;
  getActive(): boolean;
}

export interface IOlMapEvent {
  type: string;
  pixel: number[];
  originalEvent: Record<string, unknown>;
}

export interface IOlMap {
  getView(): IOlView;
  getSize(): number[] | undefined;
  getLayers(): { getArray(): IOlLayer[] };
  getInteractions(): { getArray(): IOlInteraction[] };
  addLayer(layer: IOlLayer): void;
  removeLayer(layer: IOlLayer): void;
  updateSize(): void;
  getPixelFromCoordinate?(coordinate: number[]): number[];
  getCoordinateFromPixel?(pixel: number[]): number[];
  dispatchEvent?(event: IOlMapEvent): void;
}

interface IOlGlobal {
  Map: { prototype: { getView: () => IOlView } };
  layer?: { Vector?: new (opts: Record<string, unknown>) => IOlLayer };
  source?: {
    Vector?: new () => IOlVectorSource;
    XYZ?: new (opts: {
      url?: string;
      crossOrigin?: string;
      attributions?: string;
    }) => IOlTileSource;
  };
  style?: {
    Style?: new (opts: Record<string, unknown>) => unknown;
    Text?: new (opts: Record<string, unknown>) => unknown;
    Fill?: new (opts: Record<string, unknown>) => unknown;
    Stroke?: new (opts: Record<string, unknown>) => unknown;
  };
  Feature?: new (opts?: Record<string, unknown>) => IOlFeature;
  geom?: { Point?: new (coords: number[]) => { getCoordinates(): number[] } };
  interaction?: {
    DoubleClickZoom?: new () => IOlInteraction;
    DragPan?: new () => IOlInteraction;
  };
}

function isOlGlobal(val: unknown): val is IOlGlobal {
  return (
    typeof val === 'object' &&
    val !== null &&
    'Map' in val &&
    typeof val.Map === 'object' &&
    val.Map !== null &&
    'prototype' in val.Map &&
    typeof val.Map.prototype === 'object' &&
    val.Map.prototype !== null &&
    'getView' in val.Map.prototype &&
    typeof val.Map.prototype.getView === 'function'
  );
}

declare global {
  interface Window {
    ol?: IOlGlobal;
  }
}

export function isDragPan(interaction: IOlInteraction): boolean {
  const DragPan = window.ol?.interaction?.DragPan;
  return DragPan !== undefined && interaction instanceof DragPan;
}

export function findDragPanInteractions(map: IOlMap): IOlInteraction[] {
  return map.getInteractions().getArray().filter(isDragPan);
}

let captured: IOlMap | null = null;
const resolvers: ((map: IOlMap) => void)[] = [];
let hooked = false;
let proxyInstalled = false;

const DIAG_DELAY = 5_000;

export function getOlMap(): Promise<IOlMap> {
  if (captured) return Promise.resolve(captured);
  return new Promise((resolve) => {
    resolvers.push(resolve);
  });
}

function hookGetView(ol: IOlGlobal): void {
  hooked = true;
  const proto = ol.Map.prototype;
  const orig = proto.getView;

  proxyInstalled = true;
  proto.getView = new Proxy(orig, {
    apply(_target, thisArg: IOlMap) {
      proto.getView = orig;
      proxyInstalled = false;
      captured = thisArg;
      for (const r of resolvers) r(thisArg);
      resolvers.length = 0;
      return orig.call(thisArg);
    },
  });
}

function logDiagnostics(): void {
  if (captured) return;

  const olAvailable = isOlGlobal(window.ol);
  const viewportExists = document.querySelector('.ol-viewport') !== null;

  console.warn(
    '[SVP] OL Map не захвачен за %dс. Диагностика:' +
      ' window.ol=%s, hookGetView=%s, proxy=%s, viewport=%s',
    DIAG_DELAY / 1000,
    olAvailable ? 'есть' : 'нет',
    hooked ? 'вызван' : 'не вызван',
    proxyInstalled ? 'установлен' : 'снят',
    viewportExists ? 'есть' : 'нет',
  );

  // window.ol появился, но hookGetView не вызван — defineProperty не сработал
  if (olAvailable && !hooked) {
    console.warn('[SVP] Повторная попытка перехвата getView');
    hookGetView(window.ol as IOlGlobal);
  }
}

export function initOlMapCapture(): void {
  if (window.ol) {
    hookGetView(window.ol);
  } else {
    // ol not yet loaded — intercept when the game sets window.ol
    let olValue: IOlGlobal | undefined;
    Object.defineProperty(window, 'ol', {
      configurable: true,
      enumerable: true,
      get() {
        return olValue;
      },
      set(val: unknown) {
        // Restore as a normal data property first
        Object.defineProperty(window, 'ol', {
          configurable: true,
          enumerable: true,
          writable: true,
          value: val,
        });
        if (isOlGlobal(val)) {
          olValue = val;
          hookGetView(val);
        }
      },
    });
  }

  setTimeout(logDiagnostics, DIAG_DELAY);
}
