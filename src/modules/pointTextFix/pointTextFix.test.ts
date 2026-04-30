import {
  buildRefCounts,
  computeLabelText,
  fontSizeForZoom,
  pointTextFix,
  predictTextQueue,
  readMapConfigH,
  unwrapFeature,
  wrapFeature,
  wrapLightRenderer,
  wrapStyleArray,
} from './pointTextFix';
import type { IOlFeature, IOlLayer, IOlMap, IOlVectorSource, IOlView } from '../../core/olMap';

const WRAPPED_MARKER_DESC = 'svp.pointTextFix.wrapped';

// ── helpers ──────────────────────────────────────────────────────────────────

interface IMockSource extends IOlVectorSource {
  _listeners: Map<string, ((e?: unknown) => void)[]>;
  _emit(type: string, payload?: unknown): void;
}

function makeSource(features: IOlFeature[] = []): IMockSource {
  const listeners = new Map<string, ((e?: unknown) => void)[]>();
  return {
    _listeners: listeners,
    _emit(type, payload) {
      const arr = listeners.get(type) ?? [];
      for (const cb of arr) cb(payload);
    },
    getFeatures: () => features,
    addFeature: jest.fn(),
    clear: jest.fn(),
    on(type, cb) {
      const arr = listeners.get(type) ?? [];
      arr.push(cb as (e?: unknown) => void);
      listeners.set(type, arr);
    },
    un(type, cb) {
      const arr = listeners.get(type) ?? [];
      listeners.set(
        type,
        arr.filter((l) => l !== (cb as unknown)),
      );
    },
  };
}

interface IMockView extends IOlView {
  _listeners: Map<string, (() => void)[]>;
  _setZoom(zoom: number): void;
}

function makeView(zoom = 16): IMockView {
  const listeners = new Map<string, (() => void)[]>();
  let currentZoom = zoom;
  return {
    _listeners: listeners,
    _setZoom(z) {
      currentZoom = z;
    },
    padding: [0, 0, 0, 0],
    getCenter: () => undefined,
    setCenter: () => {},
    calculateExtent: () => [0, 0, 0, 0],
    changed: () => {},
    getRotation: () => 0,
    setRotation: () => {},
    getZoom: () => currentZoom,
    on(type, cb) {
      const arr = listeners.get(type) ?? [];
      arr.push(cb);
      listeners.set(type, arr);
    },
    un(type, cb) {
      const arr = listeners.get(type) ?? [];
      listeners.set(
        type,
        arr.filter((l) => l !== cb),
      );
    },
  };
}

function makeLayer(name: string, source: IOlVectorSource | null): IOlLayer {
  return {
    get: (key: string) => (key === 'name' ? name : undefined),
    getSource: () => source,
  };
}

function makeMap(layers: IOlLayer[], view: IOlView): IOlMap {
  return {
    getView: () => view,
    getSize: () => [800, 600],
    getLayers: () => ({ getArray: () => layers }),
    getInteractions: () => ({ getArray: () => [] }),
    addLayer: jest.fn(),
    removeLayer: jest.fn(),
    updateSize: jest.fn(),
  };
}

interface IMockCtx {
  font: string;
  fillStyle: string;
  strokeStyle: string;
  lineWidth: number;
  fillText: jest.Mock;
  strokeText: jest.Mock;
  beginPath: jest.Mock;
  arc: jest.Mock;
  moveTo: jest.Mock;
  lineTo: jest.Mock;
  stroke: jest.Mock;
  fill: jest.Mock;
  save: jest.Mock;
  restore: jest.Mock;
  translate: jest.Mock;
  rotate: jest.Mock;
}

function makeCtx(): IMockCtx {
  return {
    font: '',
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    fillText: jest.fn(),
    strokeText: jest.fn(),
    beginPath: jest.fn(),
    arc: jest.fn(),
    moveTo: jest.fn(),
    lineTo: jest.fn(),
    stroke: jest.fn(),
    fill: jest.fn(),
    save: jest.fn(),
    restore: jest.fn(),
    translate: jest.fn(),
    rotate: jest.fn(),
  };
}

interface IMockStyle {
  _renderer: ((...args: never[]) => void) | null;
  getRenderer: jest.Mock;
  setRenderer: jest.Mock;
}

function makeStyleWithRenderer(renderer: (...args: never[]) => void): IMockStyle {
  const style: IMockStyle = {
    _renderer: renderer,
    getRenderer: jest.fn(() => style._renderer),
    setRenderer: jest.fn((fn: (...args: never[]) => void) => {
      style._renderer = fn;
    }),
  };
  return style;
}

function makeStyleWithoutRenderer(): { foo: string } {
  return { foo: 'point' };
}

interface IMockFeature extends IOlFeature {
  _style: unknown;
  _props: Record<string, unknown>;
  _changedCalls: number;
  _eventListeners: Map<string, (() => void)[]>;
  getStyle(): unknown;
  on(type: string, cb: () => void): void;
  un(type: string, cb: () => void): void;
  changed(): void;
  get(key: string): unknown;
}

function makeFeature(
  initialStyle: unknown = null,
  props: Record<string, unknown> = {},
  id: string | number | undefined = 'f-id',
): IMockFeature {
  const listeners = new Map<string, (() => void)[]>();
  const f: IMockFeature = {
    _style: initialStyle,
    _props: { ...props },
    _changedCalls: 0,
    _eventListeners: listeners,
    getGeometry: () => ({ getCoordinates: () => [0, 0] }),
    getId: () => id,
    setId: jest.fn(),
    setStyle(style: unknown) {
      this._style = style;
    },
    getStyle() {
      return this._style;
    },
    get(key: string) {
      return this._props[key];
    },
    on(type, cb) {
      const arr = listeners.get(type) ?? [];
      arr.push(cb);
      listeners.set(type, arr);
    },
    un(type, cb) {
      const arr = listeners.get(type) ?? [];
      listeners.set(
        type,
        arr.filter((l) => l !== cb),
      );
    },
    changed() {
      this._changedCalls++;
      const arr = listeners.get('change') ?? [];
      for (const cb of arr) cb();
    },
  };
  return f;
}

function mockOl(): { createdSources: IOlVectorSource[] } {
  const createdSources: IOlVectorSource[] = [];

  window.ol = {
    Map: { prototype: { getView: jest.fn() } },
    source: {
      Vector: jest.fn().mockImplementation(() => {
        const s = makeSource();
        createdSources.push(s);
        return s;
      }) as unknown as new () => IOlVectorSource,
    },
    layer: {
      Vector: jest.fn().mockImplementation((opts: Record<string, unknown>) => {
        const src = createdSources[createdSources.length - 1] ?? makeSource();
        const name = typeof opts.name === 'string' ? opts.name : undefined;
        return {
          get: (key: string) => (key === 'name' ? name : undefined),
          getSource: () => src,
        } as IOlLayer;
      }) as unknown as new (opts: Record<string, unknown>) => IOlLayer,
    },
    Feature: jest.fn().mockImplementation((opts?: Record<string, unknown>) => {
      const geometry = (opts?.geometry as { getCoordinates(): number[] } | undefined) ?? {
        getCoordinates: () => [0, 0],
      };
      let id: string | number | undefined;
      let style: unknown = null;
      return {
        getGeometry: () => geometry,
        getId: () => id,
        setId: jest.fn((newId: string) => {
          id = newId;
        }),
        setStyle: jest.fn((s: unknown) => {
          style = s;
        }),
        getStyle: () => style,
      } as unknown as IOlFeature;
    }) as unknown as new (opts?: Record<string, unknown>) => IOlFeature,
    geom: {
      Point: jest.fn().mockImplementation((coords: number[]) => ({
        getCoordinates: () => coords,
      })) as unknown as new (coords: number[]) => { getCoordinates(): number[] },
    },
    style: {
      Style: jest.fn().mockImplementation((o: Record<string, unknown>) => o) as unknown as new (
        opts: Record<string, unknown>,
      ) => unknown,
      Text: jest.fn().mockImplementation((o: Record<string, unknown>) => o) as unknown as new (
        opts: Record<string, unknown>,
      ) => unknown,
      Fill: jest.fn().mockImplementation((o: Record<string, unknown>) => o) as unknown as new (
        opts: Record<string, unknown>,
      ) => unknown,
      Stroke: jest.fn().mockImplementation((o: Record<string, unknown>) => o) as unknown as new (
        opts: Record<string, unknown>,
      ) => unknown,
    },
  };

  return { createdSources };
}

function makePointFeature(id: string, props: Record<string, unknown> = {}): IOlFeature {
  return {
    getGeometry: () => ({ getCoordinates: () => [0, 0] }),
    getId: () => id,
    setId: jest.fn(),
    setStyle: jest.fn(),
    get: (key: string) => props[key],
    getProperties: () => props,
  };
}

function packH(slot0: number, slot1: number, slot2: number): number {
  return (slot0 & 0xff) | ((slot1 & 0xff) << 8) | ((slot2 & 0xff) << 16);
}

// ── fontSizeForZoom ───────────────────────────────────────────────────────────

describe('fontSizeForZoom', () => {
  test('zoom 13 -> 10 (нижняя граница clamp)', () => {
    expect(fontSizeForZoom(13)).toBe(10);
  });
  test('zoom 16 -> 13 (линейная интерполяция)', () => {
    expect(fontSizeForZoom(16)).toBe(13);
  });
  test('zoom 19 -> 16 (верхняя граница clamp)', () => {
    expect(fontSizeForZoom(19)).toBe(16);
  });
  test('zoom 25 -> 16 (saturate)', () => {
    expect(fontSizeForZoom(25)).toBe(16);
  });
  test('zoom 5 -> 10 (saturate снизу)', () => {
    expect(fontSizeForZoom(5)).toBe(10);
  });
});

// ── readMapConfigH ────────────────────────────────────────────────────────────

describe('readMapConfigH', () => {
  afterEach(() => {
    localStorage.clear();
  });

  test('отсутствует - 0', () => {
    expect(readMapConfigH()).toBe(0);
  });
  test('невалидный JSON - 0', () => {
    localStorage.setItem('map-config', 'not-json');
    expect(readMapConfigH()).toBe(0);
  });
  test('h не число - 0', () => {
    localStorage.setItem('map-config', JSON.stringify({ l: 5, h: 'bad' }));
    expect(readMapConfigH()).toBe(0);
  });
  test('читает packed h', () => {
    const h = packH(1, 2, 7);
    localStorage.setItem('map-config', JSON.stringify({ l: 7, h }));
    expect(readMapConfigH()).toBe(h);
  });
});

// ── predictTextQueue ──────────────────────────────────────────────────────────

describe('predictTextQueue', () => {
  test('пустой highlight - empty queue', () => {
    expect(predictTextQueue(packH(7, 7, 7), [])).toEqual([]);
  });

  test('slot 2 = 5 (Levels), highlight[5]=10 - text-pair в slot 2', () => {
    const h: unknown[] = [];
    h[5] = 10;
    expect(predictTextQueue(packH(0, 0, 5), h)).toEqual([{ slot: 2, channel: 5 }]);
  });

  test('slot 2 = 5, highlight[5]=0 - всё равно text-pair (native рисует "0")', () => {
    const h: unknown[] = [];
    h[5] = 0;
    expect(predictTextQueue(packH(0, 0, 5), h)).toEqual([{ slot: 2, channel: 5 }]);
  });

  test('slot 2 = 6 (Cores), value=0 - пропуск всей итерации', () => {
    const h: unknown[] = [];
    h[6] = 0;
    expect(predictTextQueue(packH(0, 0, 6), h)).toEqual([]);
  });

  test('slot 2 = 6, value=3 - text-pair', () => {
    const h: unknown[] = [];
    h[6] = 3;
    expect(predictTextQueue(packH(0, 0, 6), h)).toEqual([{ slot: 2, channel: 6 }]);
  });

  test('slot 2 = 7 (Refs), value=0 - пропуск', () => {
    const h: unknown[] = [];
    h[7] = 0;
    expect(predictTextQueue(packH(0, 0, 7), h)).toEqual([]);
  });

  test('slot 2 = 7, value=5 - text-pair', () => {
    const h: unknown[] = [];
    h[7] = 5;
    expect(predictTextQueue(packH(0, 0, 7), h)).toEqual([{ slot: 2, channel: 7 }]);
  });

  test('slot 2 = 8 (Guards), value=-1 - пропуск', () => {
    const h: unknown[] = [];
    h[8] = -1;
    expect(predictTextQueue(packH(0, 0, 8), h)).toEqual([]);
  });

  test('slot 2 = 8, value=10 - text-pair', () => {
    const h: unknown[] = [];
    h[8] = 10;
    expect(predictTextQueue(packH(0, 0, 8), h)).toEqual([{ slot: 2, channel: 8 }]);
  });

  test('slot 2 = 0 (off) - пустая queue (highlight[0] undefined)', () => {
    expect(predictTextQueue(packH(0, 0, 0), [])).toEqual([]);
  });

  test('case 5 в slot 0/1 - арка, без text', () => {
    const h: unknown[] = [];
    h[5] = 10;
    expect(predictTextQueue(packH(5, 5, 0), h)).toEqual([]);
  });

  test('case 6 в slot 0/1 при value=3 - pellets, без text', () => {
    const h: unknown[] = [];
    h[6] = 3;
    expect(predictTextQueue(packH(6, 6, 0), h)).toEqual([]);
  });

  test('case 7 в slot 0 (нетипично) - text-pair в slot 0 (в native нет is_text-проверки)', () => {
    const h: unknown[] = [];
    h[7] = 5;
    expect(predictTextQueue(packH(7, 0, 0), h)).toEqual([{ slot: 0, channel: 7 }]);
  });

  test('case 7 в slot 0 + case 5 в slot 2 - две text-pair в правильном порядке', () => {
    const h: unknown[] = [];
    h[5] = 8;
    h[7] = 5;
    expect(predictTextQueue(packH(7, 0, 5), h)).toEqual([
      { slot: 0, channel: 7 },
      { slot: 2, channel: 5 },
    ]);
  });

  test('case 1-4 в slot 0/1 - арки без text', () => {
    const h: unknown[] = [];
    h[1] = 1;
    h[2] = 1;
    h[5] = 10;
    expect(predictTextQueue(packH(1, 2, 5), h)).toEqual([{ slot: 2, channel: 5 }]);
  });

  test('case 9 в slot 0 - team-color арки без text', () => {
    const h: unknown[] = [];
    h[9] = 1;
    h[5] = 10;
    expect(predictTextQueue(packH(9, 0, 5), h)).toEqual([{ slot: 2, channel: 5 }]);
  });
});

// ── computeLabelText ──────────────────────────────────────────────────────────

describe('computeLabelText', () => {
  function highlightWith(index: number, value: unknown): unknown[] {
    const h: unknown[] = [];
    h[index] = value;
    return h;
  }

  test('slot2=5, highlight[5]=10 -> "10"', () => {
    const f = makeFeature(null, { highlight: highlightWith(5, 10) });
    expect(computeLabelText(f, 5, null)).toBe('10');
  });
  test('slot2=5, highlight[5]=0 -> "0" (mirror native)', () => {
    const f = makeFeature(null, { highlight: highlightWith(5, 0) });
    expect(computeLabelText(f, 5, null)).toBe('0');
  });
  test('slot2=5, highlight[5] undefined -> null', () => {
    const f = makeFeature(null, { highlight: [] as unknown[] });
    expect(computeLabelText(f, 5, null)).toBeNull();
  });
  test('slot2=5, no highlight prop -> null', () => {
    const f = makeFeature(null, {});
    expect(computeLabelText(f, 5, null)).toBeNull();
  });
  test('slot2=6, value=0 -> null', () => {
    const f = makeFeature(null, { highlight: highlightWith(6, 0) });
    expect(computeLabelText(f, 6, null)).toBeNull();
  });
  test('slot2=6, value=3 -> "3"', () => {
    const f = makeFeature(null, { highlight: highlightWith(6, 3) });
    expect(computeLabelText(f, 6, null)).toBe('3');
  });
  test('slot2=7, refCounts has positive count -> string', () => {
    const f = makeFeature(null, {}, 'point-1');
    const counts = new Map([['point-1', 5]]);
    expect(computeLabelText(f, 7, counts)).toBe('5');
  });
  test('slot2=7, refCounts null -> null', () => {
    const f = makeFeature(null, {}, 'point-1');
    expect(computeLabelText(f, 7, null)).toBeNull();
  });
  test('slot2=7, refCounts has 0 -> null', () => {
    const f = makeFeature(null, {}, 'point-1');
    const counts = new Map([['point-1', 0]]);
    expect(computeLabelText(f, 7, counts)).toBeNull();
  });
  test('slot2=7, feature id not string -> null', () => {
    const f = makeFeature(null, {}, undefined);
    const counts = new Map([['point-1', 5]]);
    expect(computeLabelText(f, 7, counts)).toBeNull();
  });
  test('slot2=8, value=-1 -> null', () => {
    const f = makeFeature(null, { highlight: highlightWith(8, -1) });
    expect(computeLabelText(f, 8, null)).toBeNull();
  });
  test('slot2=8, value=5 -> "5"', () => {
    const f = makeFeature(null, { highlight: highlightWith(8, 5) });
    expect(computeLabelText(f, 8, null)).toBe('5');
  });
});

// ── wrapLightRenderer ─────────────────────────────────────────────────────────

describe('wrapLightRenderer: adaptive font / поворот', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test('font 46px при zoom=16 заменяется на 13px (адаптивный)', () => {
    const original = jest.fn((_coords: unknown, state: { context: IMockCtx }) => {
      state.context.font = 'bold 46px "Manrope"';
    });
    const wrapped = wrapLightRenderer(original as never, () => 16);
    const ctx = makeCtx();
    wrapped(null, { context: ctx as unknown as CanvasRenderingContext2D, rotation: 0 });
    expect(ctx.font).toBe('bold 13px "Manrope"');
  });

  test('font множится на pixelRatio (mirror OL Text textScale)', () => {
    const original = jest.fn((_coords: unknown, state: { context: IMockCtx }) => {
      state.context.font = 'bold 46px "Manrope"';
    });
    const wrapped = wrapLightRenderer(original as never, () => 16);
    const ctx = makeCtx();
    wrapped(null, {
      context: ctx as unknown as CanvasRenderingContext2D,
      rotation: 0,
      pixelRatio: 2,
    });
    expect(ctx.font).toBe('bold 26px "Manrope"');
  });

  test('non-text методы проходят на реальный context', () => {
    const ctx = makeCtx();
    const original = jest.fn((_coords: unknown, state: { context: IMockCtx }) => {
      state.context.beginPath();
      state.context.arc(0, 0, 10, 0, Math.PI);
      state.context.stroke();
    });
    const wrapped = wrapLightRenderer(original as never, () => 16);
    wrapped(null, { context: ctx as unknown as CanvasRenderingContext2D, rotation: 0 });
    expect(ctx.beginPath).toHaveBeenCalledTimes(1);
    expect(ctx.arc).toHaveBeenCalledWith(0, 0, 10, 0, Math.PI);
    expect(ctx.stroke).toHaveBeenCalledTimes(1);
  });

  test('обёрнутый renderer несёт WRAPPED_MARKER symbol', () => {
    const wrapped = wrapLightRenderer(jest.fn() as never, () => 16);
    const markers = Object.getOwnPropertySymbols(wrapped);
    const marker = markers.find((s) => s.description === WRAPPED_MARKER_DESC);
    expect(marker).toBeDefined();
    expect((wrapped as unknown as Record<symbol, unknown>)[marker as symbol]).toBe(true);
  });
});

describe('wrapLightRenderer: counter-based filter native text', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test('slot 2 = 5 (Levels), value=10 - native text для slot 2 НЕ вызывается', () => {
    const h: unknown[] = [];
    h[5] = 10;
    const feature = makeFeature(null, { highlight: h });
    localStorage.setItem('map-config', JSON.stringify({ h: packH(0, 0, 5) }));

    const ctx = makeCtx();
    const original = jest.fn((_coords: unknown, state: { context: IMockCtx }) => {
      state.context.strokeText('10', 100, 200);
      state.context.fillText('10', 100, 200);
    });
    const wrapped = wrapLightRenderer(original as never, () => 16);
    wrapped(null, {
      context: ctx as unknown as CanvasRenderingContext2D,
      rotation: 0,
      feature,
    });

    expect(ctx.strokeText).not.toHaveBeenCalled();
    expect(ctx.fillText).not.toHaveBeenCalled();
  });

  test('slot 2 = 7 (Refs), value=5 - native text для slot 2 НЕ вызывается', () => {
    const h: unknown[] = [];
    h[7] = 5;
    const feature = makeFeature(null, { highlight: h });
    localStorage.setItem('map-config', JSON.stringify({ h: packH(0, 0, 7) }));

    const ctx = makeCtx();
    const original = jest.fn((_coords: unknown, state: { context: IMockCtx }) => {
      state.context.strokeText('5', 100, 200);
      state.context.fillText('5', 100, 200);
    });
    const wrapped = wrapLightRenderer(original as never, () => 16);
    wrapped(null, {
      context: ctx as unknown as CanvasRenderingContext2D,
      rotation: 0,
      feature,
    });

    expect(ctx.strokeText).not.toHaveBeenCalled();
    expect(ctx.fillText).not.toHaveBeenCalled();
  });

  test('slot 0 = 7, slot 2 = 5 - первая пара (slot 0) проходит, вторая (slot 2) пропускается', () => {
    const h: unknown[] = [];
    h[5] = 8;
    h[7] = 5;
    const feature = makeFeature(null, { highlight: h });
    localStorage.setItem('map-config', JSON.stringify({ h: packH(7, 0, 5) }));

    const ctx = makeCtx();
    const original = jest.fn((_coords: unknown, state: { context: IMockCtx }) => {
      // slot 0: refs -> text "5"
      state.context.strokeText('5', 100, 100);
      state.context.fillText('5', 100, 100);
      // slot 2: levels -> text "8"
      state.context.strokeText('8', 200, 200);
      state.context.fillText('8', 200, 200);
    });
    const wrapped = wrapLightRenderer(original as never, () => 16);
    wrapped(null, {
      context: ctx as unknown as CanvasRenderingContext2D,
      rotation: 0,
      feature,
    });

    // slot 0 пара прошла
    expect(ctx.strokeText).toHaveBeenCalledTimes(1);
    expect(ctx.strokeText).toHaveBeenCalledWith('5', 100, 100, undefined);
    expect(ctx.fillText).toHaveBeenCalledTimes(1);
    expect(ctx.fillText).toHaveBeenCalledWith('5', 100, 100, undefined);
    // slot 2 пара отфильтрована
  });

  test('slot 2 = 0 (off) - native text не было запланировано, не вызвано', () => {
    const h: unknown[] = [];
    h[5] = 10;
    const feature = makeFeature(null, { highlight: h });
    localStorage.setItem('map-config', JSON.stringify({ h: 0 }));

    const ctx = makeCtx();
    const original = jest.fn((_coords: unknown, state: { context: IMockCtx }) => {
      // эмулируем что native code сам не вызовет text при slot 2 = off
      // (значение не определено ни в одном из 3 слотов)
      void state;
    });
    const wrapped = wrapLightRenderer(original as never, () => 16);
    wrapped(null, {
      context: ctx as unknown as CanvasRenderingContext2D,
      rotation: 0,
      feature,
    });

    expect(ctx.strokeText).not.toHaveBeenCalled();
    expect(ctx.fillText).not.toHaveBeenCalled();
  });

  test('slot 2 = 5 при rotation!=0 - text пропущен, save/restore не вызваны', () => {
    const h: unknown[] = [];
    h[5] = 10;
    const feature = makeFeature(null, { highlight: h });
    localStorage.setItem('map-config', JSON.stringify({ h: packH(0, 0, 5) }));

    const ctx = makeCtx();
    const original = jest.fn((_coords: unknown, state: { context: IMockCtx }) => {
      state.context.strokeText('10', 100, 200);
      state.context.fillText('10', 100, 200);
    });
    const wrapped = wrapLightRenderer(original as never, () => 16);
    wrapped(null, {
      context: ctx as unknown as CanvasRenderingContext2D,
      rotation: 1.57,
      feature,
    });

    expect(ctx.save).not.toHaveBeenCalled();
    expect(ctx.restore).not.toHaveBeenCalled();
    expect(ctx.strokeText).not.toHaveBeenCalled();
  });

  test('slot 0 = 7 при rotation!=0 - text проходит с поворот compensation', () => {
    const h: unknown[] = [];
    h[7] = 5;
    const feature = makeFeature(null, { highlight: h });
    localStorage.setItem('map-config', JSON.stringify({ h: packH(7, 0, 0) }));

    const ctx = makeCtx();
    const original = jest.fn((_coords: unknown, state: { context: IMockCtx }) => {
      state.context.strokeText('5', 100, 200);
      state.context.fillText('5', 100, 200);
    });
    const wrapped = wrapLightRenderer(original as never, () => 16);
    wrapped(null, {
      context: ctx as unknown as CanvasRenderingContext2D,
      rotation: 1.57,
      feature,
    });

    expect(ctx.save).toHaveBeenCalledTimes(2);
    expect(ctx.rotate).toHaveBeenCalledWith(-1.57);
    expect(ctx.strokeText).toHaveBeenCalledTimes(1);
    expect(ctx.fillText).toHaveBeenCalledTimes(1);
    expect(ctx.restore).toHaveBeenCalledTimes(2);
  });

  test('idsAtWrapTime - снапшот на момент wrap-а, не текущий localStorage', () => {
    // Wrap создаётся при h=slot2=5. Затем localStorage меняется на slot2=7.
    // На render call queue должна использовать h из момента wrap (slot2=5),
    // потому что native LIGHT closure также имеет старый h.
    const h: unknown[] = [];
    h[5] = 10;
    h[7] = 3;
    const feature = makeFeature(null, { highlight: h });

    localStorage.setItem('map-config', JSON.stringify({ h: packH(0, 0, 5) }));
    const original = jest.fn((_coords: unknown, state: { context: IMockCtx }) => {
      // native iterates с h=slot2=5: одна text-пара slot 2 channel 5.
      state.context.strokeText('10', 100, 200);
      state.context.fillText('10', 100, 200);
    });
    const wrapped = wrapLightRenderer(original as never, () => 16);

    // Меняем map-config после wrap-а.
    localStorage.setItem('map-config', JSON.stringify({ h: packH(0, 0, 7) }));

    const ctx = makeCtx();
    wrapped(null, {
      context: ctx as unknown as CanvasRenderingContext2D,
      rotation: 0,
      feature,
    });

    // Slot 2 пара пропущена по queue от idsAtWrapTime.
    expect(ctx.strokeText).not.toHaveBeenCalled();
  });
});

// ── wrapStyleArray / wrapFeature / unwrapFeature ──────────────────────────────

describe('wrapStyleArray', () => {
  beforeEach(() => {
    localStorage.clear();
  });
  test('оборачивает LIGHT renderer, не трогает POINT-стиль', () => {
    const lightRenderer = jest.fn();
    const light = makeStyleWithRenderer(lightRenderer as never);
    const point = makeStyleWithoutRenderer();
    wrapStyleArray([point, light], () => 16);
    expect(light.setRenderer).toHaveBeenCalledTimes(1);
    expect(light._renderer).not.toBe(lightRenderer);
  });
  test('null - no-op', () => {
    expect(() => {
      wrapStyleArray(null, () => 16);
    }).not.toThrow();
  });
  test('уже обёрнутый renderer не оборачивается повторно', () => {
    const wrappedOnce = wrapLightRenderer(jest.fn() as never, () => 16);
    const style = makeStyleWithRenderer(wrappedOnce);
    wrapStyleArray([style], () => 16);
    expect(style.setRenderer).not.toHaveBeenCalled();
  });
});

describe('wrapFeature / unwrapFeature', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test('после wrap setStyle оборачивает LIGHT renderer', () => {
    const feature = makeFeature(null);
    wrapFeature(feature, () => 16);
    const light = makeStyleWithRenderer(jest.fn() as never);
    feature.setStyle([makeStyleWithoutRenderer(), light]);
    expect(light.setRenderer).toHaveBeenCalledTimes(1);
  });

  test('повторный wrapFeature - no-op', () => {
    const feature = makeFeature(null);
    wrapFeature(feature, () => 16);
    const firstSetStyle = feature.setStyle;
    wrapFeature(feature, () => 16);
    expect(feature.setStyle).toBe(firstSetStyle);
  });

  test('текущий стиль во время wrap оборачивается', () => {
    const light = makeStyleWithRenderer(jest.fn() as never);
    const feature = makeFeature([light]);
    wrapFeature(feature, () => 16);
    expect(light.setRenderer).toHaveBeenCalledTimes(1);
  });

  test('unwrapFeature восстанавливает setStyle и renderer', () => {
    const lightRenderer = jest.fn();
    const light = makeStyleWithRenderer(lightRenderer as never);
    const feature = makeFeature([light]);
    wrapFeature(feature, () => 16);
    unwrapFeature(feature);
    expect(light._renderer).toBe(lightRenderer);

    const newLight = makeStyleWithRenderer(jest.fn() as never);
    feature.setStyle([newLight]);
    expect(newLight.setRenderer).not.toHaveBeenCalled();
  });

  test('feature.changed() заново оборачивает новый LIGHT (in-place мутация)', () => {
    const oldLight = makeStyleWithRenderer(jest.fn() as never);
    const feature = makeFeature([oldLight]);
    wrapFeature(feature, () => 16);

    const newLight = makeStyleWithRenderer(jest.fn() as never);
    const styles = feature.getStyle() as IMockStyle[];
    styles[0] = newLight;
    feature.changed();

    expect(newLight.setRenderer).toHaveBeenCalledTimes(1);
  });

  test('feature.changed вызывается после wrap для инвалидации render plan', () => {
    const feature = makeFeature(null);
    const before = feature._changedCalls;
    wrapFeature(feature, () => 16);
    expect(feature._changedCalls).toBeGreaterThan(before);
  });
});

// ── buildRefCounts ────────────────────────────────────────────────────────────

describe('buildRefCounts', () => {
  afterEach(() => {
    localStorage.removeItem('inventory-cache');
  });
  test('пустой кэш - пустая Map', () => {
    expect(buildRefCounts().size).toBe(0);
  });
  test('агрегирует количество по точке', () => {
    localStorage.setItem(
      'inventory-cache',
      JSON.stringify([
        { g: 'r1', t: 3, l: 'p1', a: 2 },
        { g: 'r2', t: 3, l: 'p1', a: 1 },
        { g: 'r3', t: 3, l: 'p2', a: 3 },
      ]),
    );
    const counts = buildRefCounts();
    expect(counts.get('p1')).toBe(3);
    expect(counts.get('p2')).toBe(3);
  });
});

// ── module metadata ───────────────────────────────────────────────────────────

describe('pointTextFix metadata', () => {
  test('id = pointTextFix', () => {
    expect(pointTextFix.id).toBe('pointTextFix');
  });
  test('категория map', () => {
    expect(pointTextFix.category).toBe('map');
  });
  test('включён по умолчанию', () => {
    expect(pointTextFix.defaultEnabled).toBe(true);
  });
  test('локализованные name/description', () => {
    expect(pointTextFix.name.ru).toBeTruthy();
    expect(pointTextFix.name.en).toBeTruthy();
    expect(pointTextFix.description.ru).toBeTruthy();
    expect(pointTextFix.description.en).toBeTruthy();
  });
});

// ── enable/disable + render labels ────────────────────────────────────────────

jest.mock('../../core/olMap', () => ({
  getOlMap: jest.fn(),
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- requireActual returns any
  findLayerByName: jest.requireActual('../../core/olMap').findLayerByName,
}));

import { getOlMap } from '../../core/olMap';

const mockGetOlMap = getOlMap as jest.MockedFunction<typeof getOlMap>;

describe('pointTextFix enable / disable', () => {
  let pointsSrc: IMockSource;
  let view: IMockView;
  let olMap: IOlMap;

  beforeEach(() => {
    localStorage.clear();
    pointsSrc = makeSource();
    view = makeView(16);
    const pointsLayer = makeLayer('points', pointsSrc);
    olMap = makeMap([pointsLayer], view);
    mockGetOlMap.mockResolvedValue(olMap);
    mockOl();
  });

  afterEach(async () => {
    await pointTextFix.disable();
    delete window.ol;
  });

  test('подписки на addfeature/change/change:resolution на enable, отписка на disable', async () => {
    await pointTextFix.enable();
    expect(pointsSrc._listeners.get('addfeature')?.length).toBe(1);
    expect(pointsSrc._listeners.get('change')?.length).toBeGreaterThan(0);
    expect(view._listeners.get('change:resolution')?.length).toBeGreaterThan(0);

    await pointTextFix.disable();
    expect(pointsSrc._listeners.get('addfeature')?.length ?? 0).toBe(0);
    expect(pointsSrc._listeners.get('change')?.length ?? 0).toBe(0);
    expect(view._listeners.get('change:resolution')?.length ?? 0).toBe(0);
  });

  test('addLayer на enable, removeLayer на disable', async () => {
    await pointTextFix.enable();
    expect((olMap.addLayer as jest.Mock).mock.calls.length).toBe(1);
    await pointTextFix.disable();
    expect((olMap.removeLayer as jest.Mock).mock.calls.length).toBe(1);
  });

  test('layer создаётся с именем svp-point-text-fix', async () => {
    await pointTextFix.enable();
    const ol = window.ol;
    const VectorLayerCtor = ol?.layer?.Vector as unknown as jest.Mock;
    const calls = VectorLayerCtor.mock.calls as unknown[][];
    const lastCall = calls[calls.length - 1];
    expect((lastCall[0] as Record<string, unknown>).name).toBe('svp-point-text-fix');
  });

  test('disable до enable - идемпотентен', () => {
    expect(() => {
      void pointTextFix.disable();
    }).not.toThrow();
  });

  test('race-disable во время await getOlMap не оставляет подписки', async () => {
    let resolveGetOlMap: ((v: IOlMap) => void) | undefined;
    const pending = new Promise<IOlMap>((resolve) => {
      resolveGetOlMap = resolve;
    });
    mockGetOlMap.mockReturnValueOnce(pending);

    const enablePromise = pointTextFix.enable();
    void pointTextFix.disable();
    resolveGetOlMap?.(olMap);
    await enablePromise;

    expect(pointsSrc._listeners.get('addfeature')?.length ?? 0).toBe(0);
    expect(pointsSrc._listeners.get('change')?.length ?? 0).toBe(0);
  });

  test('enable wraps существующих features', async () => {
    const light = makeStyleWithRenderer(jest.fn() as never);
    const feature = makeFeature([light]);
    pointsSrc = makeSource([feature]);
    olMap = makeMap([makeLayer('points', pointsSrc)], view);
    mockGetOlMap.mockResolvedValue(olMap);

    await pointTextFix.enable();
    expect(light.setRenderer).toHaveBeenCalledTimes(1);
  });
});

describe('pointTextFix render labels по выбранному каналу', () => {
  let view: IMockView;
  let olMap: IOlMap;
  let createdSources: IOlVectorSource[];

  function setup(features: IOlFeature[]): void {
    const pointsSrc = makeSource(features);
    olMap = makeMap([makeLayer('points', pointsSrc)], view);
    mockGetOlMap.mockResolvedValue(olMap);
  }

  beforeEach(() => {
    localStorage.clear();
    view = makeView(16);
    ({ createdSources } = mockOl());
  });

  afterEach(async () => {
    await pointTextFix.disable();
    delete window.ol;
  });

  test('slot2 = 5 (Levels) - рисует highlight[5] для каждой точки', async () => {
    localStorage.setItem('map-config', JSON.stringify({ h: packH(0, 0, 5) }));
    const h1: unknown[] = [];
    h1[5] = 8;
    const h2: unknown[] = [];
    h2[5] = 3;
    setup([makePointFeature('p1', { highlight: h1 }), makePointFeature('p2', { highlight: h2 })]);

    await pointTextFix.enable();

    const labelsSrc = createdSources[createdSources.length - 1];
    expect((labelsSrc.addFeature as jest.Mock).mock.calls.length).toBe(2);
  });

  test('slot2 = 7 (Refs) - читает inventory-cache, не highlight[7]', async () => {
    localStorage.setItem('map-config', JSON.stringify({ h: packH(0, 0, 7) }));
    localStorage.setItem('inventory-cache', JSON.stringify([{ g: 'r1', t: 3, l: 'p1', a: 5 }]));
    setup([makePointFeature('p1'), makePointFeature('p2')]);

    await pointTextFix.enable();

    const labelsSrc = createdSources[createdSources.length - 1];
    // p1 имеет refs, p2 - нет.
    expect((labelsSrc.addFeature as jest.Mock).mock.calls.length).toBe(1);
  });

  test('slot2 = 0 (off) - labels пуст', async () => {
    localStorage.setItem('map-config', JSON.stringify({ h: 0 }));
    const h: unknown[] = [];
    h[5] = 10;
    setup([makePointFeature('p1', { highlight: h })]);

    await pointTextFix.enable();

    const labelsSrc = createdSources[createdSources.length - 1];
    expect((labelsSrc.addFeature as jest.Mock).mock.calls.length).toBe(0);
  });

  test('slot2 = 4 (не text-канал) - labels пуст', async () => {
    localStorage.setItem('map-config', JSON.stringify({ h: packH(0, 0, 4) }));
    const h: unknown[] = [];
    h[4] = 1;
    setup([makePointFeature('p1', { highlight: h })]);

    await pointTextFix.enable();

    const labelsSrc = createdSources[createdSources.length - 1];
    expect((labelsSrc.addFeature as jest.Mock).mock.calls.length).toBe(0);
  });

  test('slot2 = 6 (Cores) - пропускает точки с value=0', async () => {
    localStorage.setItem('map-config', JSON.stringify({ h: packH(0, 0, 6) }));
    const h1: unknown[] = [];
    h1[6] = 0;
    const h2: unknown[] = [];
    h2[6] = 4;
    setup([makePointFeature('p1', { highlight: h1 }), makePointFeature('p2', { highlight: h2 })]);

    await pointTextFix.enable();

    const labelsSrc = createdSources[createdSources.length - 1];
    expect((labelsSrc.addFeature as jest.Mock).mock.calls.length).toBe(1);
  });

  test('zoom < MIN_ZOOM - labels пуст', async () => {
    view._setZoom(12);
    localStorage.setItem('map-config', JSON.stringify({ h: packH(0, 0, 5) }));
    const h: unknown[] = [];
    h[5] = 10;
    setup([makePointFeature('p1', { highlight: h })]);

    await pointTextFix.enable();

    const labelsSrc = createdSources[createdSources.length - 1];
    expect((labelsSrc.addFeature as jest.Mock).mock.calls.length).toBe(0);
  });

  test('change:resolution event перерисовывает labels', async () => {
    localStorage.setItem('map-config', JSON.stringify({ h: packH(0, 0, 5) }));
    const h: unknown[] = [];
    h[5] = 10;
    setup([makePointFeature('p1', { highlight: h })]);

    await pointTextFix.enable();

    const labelsSrc = createdSources[createdSources.length - 1];
    const initial = (labelsSrc.addFeature as jest.Mock).mock.calls.length;
    const cb = view._listeners.get('change:resolution')?.[0];
    cb?.();

    expect((labelsSrc.addFeature as jest.Mock).mock.calls.length).toBe(initial + 1);
  });

  test('source change debounced ререндерит labels', async () => {
    jest.useFakeTimers();
    localStorage.setItem('map-config', JSON.stringify({ h: packH(0, 0, 5) }));
    const h: unknown[] = [];
    h[5] = 10;
    const pointsSrc = makeSource([makePointFeature('p1', { highlight: h })]);
    olMap = makeMap([makeLayer('points', pointsSrc)], view);
    mockGetOlMap.mockResolvedValue(olMap);

    await pointTextFix.enable();

    const labelsSrc = createdSources[createdSources.length - 1];
    const initial = (labelsSrc.addFeature as jest.Mock).mock.calls.length;

    pointsSrc._emit('change');
    pointsSrc._emit('change');
    expect((labelsSrc.addFeature as jest.Mock).mock.calls.length).toBe(initial);

    jest.runAllTimers();
    expect((labelsSrc.addFeature as jest.Mock).mock.calls.length).toBeGreaterThan(initial);

    jest.useRealTimers();
  });
});
