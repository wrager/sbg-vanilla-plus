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
  getZoom?(): number | undefined;
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

export interface IOlLayer {
  get(key: string): unknown;
  getSource(): IOlVectorSource | null;
}

export interface IOlMap {
  getView(): IOlView;
  getSize(): number[] | undefined;
  getLayers(): { getArray(): IOlLayer[] };
  addLayer(layer: IOlLayer): void;
  removeLayer(layer: IOlLayer): void;
  updateSize(): void;
}

interface IOlGlobal {
  Map: { prototype: { getView: () => IOlView } };
  layer?: { Vector?: new (opts: Record<string, unknown>) => IOlLayer };
  source?: { Vector?: new () => IOlVectorSource };
  style?: {
    Style?: new (opts: Record<string, unknown>) => unknown;
    Text?: new (opts: Record<string, unknown>) => unknown;
    Fill?: new (opts: Record<string, unknown>) => unknown;
    Stroke?: new (opts: Record<string, unknown>) => unknown;
  };
  Feature?: new (opts?: Record<string, unknown>) => IOlFeature;
  geom?: { Point?: new (coords: number[]) => { getCoordinates(): number[] } };
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

let captured: IOlMap | null = null;
const resolvers: ((map: IOlMap) => void)[] = [];

export function getOlMap(): Promise<IOlMap> {
  if (captured) return Promise.resolve(captured);
  return new Promise((resolve) => {
    resolvers.push(resolve);
  });
}

function hookGetView(ol: IOlGlobal): void {
  const proto = ol.Map.prototype;
  const orig = proto.getView;

  proto.getView = new Proxy(orig, {
    apply(_target, thisArg: IOlMap) {
      proto.getView = orig;
      captured = thisArg;
      for (const r of resolvers) r(thisArg);
      resolvers.length = 0;
      return orig.call(thisArg);
    },
  });
}

export function initOlMapCapture(): void {
  if (window.ol) {
    hookGetView(window.ol);
    return;
  }

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
