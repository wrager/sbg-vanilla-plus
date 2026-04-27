import {
  fontSizeForZoom,
  pointTextFix,
  wrapFeature,
  wrapLightRenderer,
  wrapStyleArray,
  unwrapFeature,
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

function makeView(zoom = 16): IOlView {
  return {
    padding: [0, 0, 0, 0],
    getCenter: () => undefined,
    setCenter: () => {},
    calculateExtent: () => [0, 0, 0, 0],
    changed: () => {},
    getRotation: () => 0,
    setRotation: () => {},
    getZoom: () => zoom,
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
  _eventListeners: Map<string, (() => void)[]>;
  getStyle(): unknown;
  on(type: string, cb: () => void): void;
  un(type: string, cb: () => void): void;
  changed(): void;
}

function makeFeature(initialStyle: unknown = null): IMockFeature {
  const listeners = new Map<string, (() => void)[]>();
  const f: IMockFeature = {
    _style: initialStyle,
    _eventListeners: listeners,
    getGeometry: () => ({ getCoordinates: () => [0, 0] }),
    getId: () => 'f-id',
    setId: jest.fn(),
    setStyle(style: unknown) {
      this._style = style;
    },
    getStyle() {
      return this._style;
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
      const arr = listeners.get('change') ?? [];
      for (const cb of arr) cb();
    },
  };
  return f;
}

// ── fontSizeForZoom ───────────────────────────────────────────────────────────

describe('fontSizeForZoom', () => {
  test('zoom 13 -> 10', () => {
    expect(fontSizeForZoom(13)).toBe(10);
  });
  test('zoom 16 -> 13', () => {
    expect(fontSizeForZoom(16)).toBe(13);
  });
  test('zoom 18 -> 15', () => {
    expect(fontSizeForZoom(18)).toBe(15);
  });
  test('zoom 20+ saturates at 16', () => {
    expect(fontSizeForZoom(20)).toBe(16);
    expect(fontSizeForZoom(25)).toBe(16);
  });
  test('zoom < 13 clamps to 10', () => {
    expect(fontSizeForZoom(5)).toBe(10);
    expect(fontSizeForZoom(0)).toBe(10);
  });
});

// ── wrapLightRenderer ─────────────────────────────────────────────────────────

describe('wrapLightRenderer', () => {
  test('font replacement at zoom=16 substitutes 32px -> 13px', () => {
    const original = jest.fn((_coords: unknown, state: { context: IMockCtx }) => {
      state.context.font = 'bold 32px "Manrope"';
    });
    const wrapped = wrapLightRenderer(original as never, () => 16);
    const ctx = makeCtx();
    wrapped(null, { context: ctx as unknown as CanvasRenderingContext2D, rotation: 0 });
    expect(ctx.font).toBe('bold 13px "Manrope"');
  });

  test('font replacement at zoom=13 substitutes 32px -> 10px', () => {
    const original = jest.fn((_coords: unknown, state: { context: IMockCtx }) => {
      state.context.font = 'bold 32px "Manrope"';
    });
    const wrapped = wrapLightRenderer(original as never, () => 13);
    const ctx = makeCtx();
    wrapped(null, { context: ctx as unknown as CanvasRenderingContext2D, rotation: 0 });
    expect(ctx.font).toBe('bold 10px "Manrope"');
  });

  test('font replacement at zoom=20 substitutes 32px -> 16px', () => {
    const original = jest.fn((_coords: unknown, state: { context: IMockCtx }) => {
      state.context.font = 'bold 32px "Manrope"';
    });
    const wrapped = wrapLightRenderer(original as never, () => 20);
    const ctx = makeCtx();
    wrapped(null, { context: ctx as unknown as CanvasRenderingContext2D, rotation: 0 });
    expect(ctx.font).toBe('bold 16px "Manrope"');
  });

  test('font without Npx is passed through unchanged', () => {
    const original = jest.fn((_coords: unknown, state: { context: IMockCtx }) => {
      state.context.font = 'italic Manrope';
    });
    const wrapped = wrapLightRenderer(original as never, () => 16);
    const ctx = makeCtx();
    wrapped(null, { context: ctx as unknown as CanvasRenderingContext2D, rotation: 0 });
    expect(ctx.font).toBe('italic Manrope');
  });

  test('font is multiplied by state.pixelRatio (mirror OL Text textScale = pixelRatio * scale)', () => {
    // На retina-устройстве (pixelRatio=2) zoom=16 даёт 13px * 2 = 26px в ctx.font.
    // OL Text style автоматически делает то же через textScale_ перед fillText.
    const original = jest.fn((_coords: unknown, state: { context: IMockCtx }) => {
      state.context.font = 'bold 32px "Manrope"';
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

  test('font with pixelRatio=3 (high-DPI) at zoom=13 -> 30px', () => {
    const original = jest.fn((_coords: unknown, state: { context: IMockCtx }) => {
      state.context.font = 'bold 32px "Manrope"';
    });
    const wrapped = wrapLightRenderer(original as never, () => 13);
    const ctx = makeCtx();
    wrapped(null, {
      context: ctx as unknown as CanvasRenderingContext2D,
      rotation: 0,
      pixelRatio: 3,
    });
    // 10 * 3 = 30
    expect(ctx.font).toBe('bold 30px "Manrope"');
  });

  test('fillText at rotation=0 is direct pass-through, no save/restore', () => {
    const original = jest.fn((_coords: unknown, state: { context: IMockCtx }) => {
      state.context.fillText('5', 100, 200);
    });
    const wrapped = wrapLightRenderer(original as never, () => 16);
    const ctx = makeCtx();
    wrapped(null, { context: ctx as unknown as CanvasRenderingContext2D, rotation: 0 });
    expect(ctx.fillText).toHaveBeenCalledWith('5', 100, 200);
    expect(ctx.save).not.toHaveBeenCalled();
    expect(ctx.restore).not.toHaveBeenCalled();
  });

  test('fillText at rotation!=0 applies rotation compensation around (x,y)', () => {
    const calls: string[] = [];
    const ctx = makeCtx();
    ctx.save.mockImplementation(() => calls.push('save'));
    ctx.translate.mockImplementation((x: number, y: number) =>
      calls.push(`translate(${String(x)},${String(y)})`),
    );
    ctx.rotate.mockImplementation((a: number) => calls.push(`rotate(${String(a)})`));
    ctx.fillText.mockImplementation((t: string, x: number, y: number) =>
      calls.push(`fillText(${t},${String(x)},${String(y)})`),
    );
    ctx.restore.mockImplementation(() => calls.push('restore'));

    const original = jest.fn((_coords: unknown, state: { context: IMockCtx }) => {
      state.context.fillText('5', 100, 200);
    });
    const wrapped = wrapLightRenderer(original as never, () => 16);
    wrapped(null, { context: ctx as unknown as CanvasRenderingContext2D, rotation: 1.57 });

    expect(calls).toEqual([
      'save',
      'translate(100,200)',
      'rotate(-1.57)',
      'translate(-100,-200)',
      'fillText(5,100,200)',
      'restore',
    ]);
  });

  test('strokeText at rotation!=0 same compensation', () => {
    const calls: string[] = [];
    const ctx = makeCtx();
    ctx.save.mockImplementation(() => calls.push('save'));
    ctx.translate.mockImplementation((x: number, y: number) =>
      calls.push(`translate(${String(x)},${String(y)})`),
    );
    ctx.rotate.mockImplementation((a: number) => calls.push(`rotate(${String(a)})`));
    ctx.strokeText.mockImplementation((t: string, x: number, y: number) =>
      calls.push(`strokeText(${t},${String(x)},${String(y)})`),
    );
    ctx.restore.mockImplementation(() => calls.push('restore'));

    const original = jest.fn((_coords: unknown, state: { context: IMockCtx }) => {
      state.context.strokeText('5', 100, 200);
    });
    const wrapped = wrapLightRenderer(original as never, () => 16);
    wrapped(null, { context: ctx as unknown as CanvasRenderingContext2D, rotation: 1.57 });

    expect(calls).toEqual([
      'save',
      'translate(100,200)',
      'rotate(-1.57)',
      'translate(-100,-200)',
      'strokeText(5,100,200)',
      'restore',
    ]);
  });

  test('non-text drawing methods pass through to real context', () => {
    const ctx = makeCtx();
    const original = jest.fn((_coords: unknown, state: { context: IMockCtx }) => {
      state.context.beginPath();
      state.context.arc(0, 0, 10, 0, Math.PI);
      state.context.moveTo(1, 1);
      state.context.lineTo(2, 2);
      state.context.stroke();
    });
    const wrapped = wrapLightRenderer(original as never, () => 16);
    wrapped(null, { context: ctx as unknown as CanvasRenderingContext2D, rotation: 1.57 });
    expect(ctx.beginPath).toHaveBeenCalledTimes(1);
    expect(ctx.arc).toHaveBeenCalledWith(0, 0, 10, 0, Math.PI);
    expect(ctx.moveTo).toHaveBeenCalledWith(1, 1);
    expect(ctx.lineTo).toHaveBeenCalledWith(2, 2);
    expect(ctx.stroke).toHaveBeenCalledTimes(1);
    // Non-text вызовы НЕ оборачиваются save/restore.
    expect(ctx.save).not.toHaveBeenCalled();
    expect(ctx.restore).not.toHaveBeenCalled();
  });

  test('color and lineWidth setters pass through unchanged (native colors preserved)', () => {
    const ctx = makeCtx();
    const original = jest.fn((_coords: unknown, state: { context: IMockCtx }) => {
      state.context.fillStyle = '#fff';
      state.context.strokeStyle = '#000';
      state.context.lineWidth = 3;
    });
    const wrapped = wrapLightRenderer(original as never, () => 16);
    wrapped(null, { context: ctx as unknown as CanvasRenderingContext2D, rotation: 0 });
    expect(ctx.fillStyle).toBe('#fff');
    expect(ctx.strokeStyle).toBe('#000');
    expect(ctx.lineWidth).toBe(3);
  });

  test('wrapped renderer carries WRAPPED_MARKER symbol', () => {
    const original = jest.fn();
    const wrapped = wrapLightRenderer(original as never, () => 16);
    const markers = Object.getOwnPropertySymbols(wrapped);
    expect(markers.length).toBeGreaterThan(0);
    const marker = markers.find((s) => s.description === WRAPPED_MARKER_DESC);
    expect(marker).toBeDefined();
    expect((wrapped as unknown as Record<symbol, unknown>)[marker as symbol]).toBe(true);
  });

  test('original receives state with proxy context, other state fields preserved', () => {
    const original = jest.fn();
    const wrapped = wrapLightRenderer(original as never, () => 16);
    const ctx = makeCtx();
    const state = {
      context: ctx as unknown as CanvasRenderingContext2D,
      rotation: 0.5,
    };
    wrapped(['coords'], state);
    expect(original).toHaveBeenCalledTimes(1);
    const callArg = (original.mock.calls[0] as unknown[])[1] as {
      context: unknown;
      rotation: number;
    };
    expect(callArg.rotation).toBe(0.5);
    // context должен быть proxy, не сам ctx.
    expect(callArg.context).not.toBe(ctx);
  });
});

// ── wrapStyleArray ────────────────────────────────────────────────────────────

describe('wrapStyleArray', () => {
  test('wraps LIGHT renderer, leaves POINT style alone', () => {
    const lightRenderer = jest.fn();
    const light = makeStyleWithRenderer(lightRenderer as never);
    const point = makeStyleWithoutRenderer();
    wrapStyleArray([point, light], () => 16);
    expect(light.setRenderer).toHaveBeenCalledTimes(1);
    expect(light._renderer).not.toBe(lightRenderer);
  });

  test('non-array input is no-op', () => {
    const lightRenderer = jest.fn();
    const light = makeStyleWithRenderer(lightRenderer as never);
    wrapStyleArray(light, () => 16);
    expect(light.setRenderer).not.toHaveBeenCalled();
  });

  test('null and undefined are no-ops', () => {
    expect(() => {
      wrapStyleArray(null, () => 16);
    }).not.toThrow();
    expect(() => {
      wrapStyleArray(undefined, () => 16);
    }).not.toThrow();
  });

  test('already-wrapped renderer is not double-wrapped', () => {
    const original = jest.fn();
    const wrappedOnce = wrapLightRenderer(original as never, () => 16);
    const style = makeStyleWithRenderer(wrappedOnce);
    wrapStyleArray([style], () => 16);
    expect(style.setRenderer).not.toHaveBeenCalled();
  });
});

// ── wrapFeature / unwrapFeature ───────────────────────────────────────────────

describe('wrapFeature / unwrapFeature', () => {
  test('after wrap, setStyle wraps LIGHT renderer in passed array', () => {
    const feature = makeFeature(null);
    wrapFeature(feature, () => 16);
    const lightRenderer = jest.fn();
    const light = makeStyleWithRenderer(lightRenderer as never);
    const point = makeStyleWithoutRenderer();
    feature.setStyle([point, light]);
    expect(light.setRenderer).toHaveBeenCalledTimes(1);
    expect(feature.getStyle()).toEqual([point, light]);
  });

  test('repeated wrapFeature on the same feature is no-op', () => {
    const feature = makeFeature(null);
    wrapFeature(feature, () => 16);
    const firstSetStyle = feature.setStyle;
    wrapFeature(feature, () => 16);
    expect(feature.setStyle).toBe(firstSetStyle);
  });

  test('current style at wrap time is wrapped immediately', () => {
    const lightRenderer = jest.fn();
    const light = makeStyleWithRenderer(lightRenderer as never);
    const feature = makeFeature([light]);
    wrapFeature(feature, () => 16);
    expect(light.setRenderer).toHaveBeenCalledTimes(1);
  });

  test('unwrapFeature restores setStyle (subsequent setStyle does not wrap)', () => {
    const feature = makeFeature(null);
    wrapFeature(feature, () => 16);
    unwrapFeature(feature);
    const lightRenderer = jest.fn();
    const light = makeStyleWithRenderer(lightRenderer as never);
    feature.setStyle([light]);
    expect(light.setRenderer).not.toHaveBeenCalled();
  });

  test('unwrapFeature restores original renderer on current LIGHT style', () => {
    const lightRenderer = jest.fn();
    const light = makeStyleWithRenderer(lightRenderer as never);
    const feature = makeFeature([light]);
    wrapFeature(feature, () => 16);
    expect(light._renderer).not.toBe(lightRenderer);
    unwrapFeature(feature);
    expect(light._renderer).toBe(lightRenderer);
  });

  test('feature.changed() after in-place style mutation re-wraps new LIGHT renderer', () => {
    // Симулируем сценарий showInfo: игра берёт style array, заменяет style[1]
    // на новый LIGHT (не через setStyle), вызывает feature.changed().
    const oldLightRenderer = jest.fn();
    const oldLight = makeStyleWithRenderer(oldLightRenderer as never);
    const feature = makeFeature([oldLight]);
    wrapFeature(feature, () => 16);
    // oldLight уже обёрнут.

    // Игра мутирует in-place: style[1] = новый LIGHT с нативным renderer.
    const newLightRenderer = jest.fn();
    const newLight = makeStyleWithRenderer(newLightRenderer as never);
    const styles = feature.getStyle() as IMockStyle[];
    styles[0] = newLight;

    // Триггерим feature.changed() - то же, что делает игра.
    feature.changed();

    // Новый LIGHT должен быть обёрнут.
    expect(newLight.setRenderer).toHaveBeenCalledTimes(1);
    expect(newLight._renderer).not.toBe(newLightRenderer);
  });

  test('unwrapFeature unsubscribes change listener (subsequent changed() does not re-wrap)', () => {
    const feature = makeFeature(null);
    wrapFeature(feature, () => 16);
    unwrapFeature(feature);

    // После unwrap кладём новый LIGHT и триггерим changed.
    const lightRenderer = jest.fn();
    const light = makeStyleWithRenderer(lightRenderer as never);
    const styles = [light];
    // Прямая мутация _style минуя setStyle, иначе wrapStyleArray не пройдёт
    // через restored нативный setStyle.
    feature._style = styles;
    feature.changed();

    expect(light.setRenderer).not.toHaveBeenCalled();
  });

  test('repeated unwrapFeature is no-op', () => {
    const feature = makeFeature(null);
    wrapFeature(feature, () => 16);
    unwrapFeature(feature);
    expect(() => {
      unwrapFeature(feature);
    }).not.toThrow();
  });
});

// ── module enable / disable ───────────────────────────────────────────────────

jest.mock('../../core/olMap', () => ({
  getOlMap: jest.fn(),
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- requireActual returns any
  findLayerByName: jest.requireActual('../../core/olMap').findLayerByName,
}));

import { getOlMap } from '../../core/olMap';

const mockGetOlMap = getOlMap as jest.MockedFunction<typeof getOlMap>;

describe('pointTextFix.enable / disable', () => {
  let pointsSrc: IMockSource;
  let olMap: IOlMap;
  let view: IOlView;

  beforeEach(() => {
    pointsSrc = makeSource();
    view = makeView(16);
    const pointsLayer = makeLayer('points', pointsSrc);
    olMap = makeMap([pointsLayer], view);
    mockGetOlMap.mockResolvedValue(olMap);
  });

  afterEach(async () => {
    await pointTextFix.disable();
  });

  test('enable subscribes to addfeature on points source', async () => {
    await pointTextFix.enable();
    expect(pointsSrc._listeners.get('addfeature')?.length).toBe(1);
  });

  test('enable wraps existing features in points source', async () => {
    const lightRenderer = jest.fn();
    const light = makeStyleWithRenderer(lightRenderer as never);
    const feature = makeFeature([light]);
    pointsSrc = makeSource([feature]);
    const pointsLayer = makeLayer('points', pointsSrc);
    olMap = makeMap([pointsLayer], view);
    mockGetOlMap.mockResolvedValue(olMap);

    await pointTextFix.enable();

    expect(light.setRenderer).toHaveBeenCalledTimes(1);
  });

  test('addfeature event after enable wraps the new feature', async () => {
    await pointTextFix.enable();
    const lightRenderer = jest.fn();
    const light = makeStyleWithRenderer(lightRenderer as never);
    const newFeature = makeFeature([light]);
    pointsSrc._emit('addfeature', { feature: newFeature });
    expect(light.setRenderer).toHaveBeenCalledTimes(1);
  });

  test('enable without points layer is no-op', async () => {
    const otherLayer = makeLayer('other', makeSource());
    olMap = makeMap([otherLayer], view);
    mockGetOlMap.mockResolvedValue(olMap);
    await pointTextFix.enable();
    expect(pointsSrc._listeners.get('addfeature')).toBeUndefined();
  });

  test('module does not add any layer (no own layer is created)', async () => {
    await pointTextFix.enable();
    expect((olMap.addLayer as jest.Mock).mock.calls.length).toBe(0);
  });

  test('disable unsubscribes addfeature listener', async () => {
    await pointTextFix.enable();
    await pointTextFix.disable();
    expect(pointsSrc._listeners.get('addfeature')?.length ?? 0).toBe(0);
  });

  test('disable restores setStyle on existing features', async () => {
    const lightRenderer = jest.fn();
    const light = makeStyleWithRenderer(lightRenderer as never);
    const feature = makeFeature([light]);
    pointsSrc = makeSource([feature]);
    const pointsLayer = makeLayer('points', pointsSrc);
    olMap = makeMap([pointsLayer], view);
    mockGetOlMap.mockResolvedValue(olMap);

    await pointTextFix.enable();
    await pointTextFix.disable();

    expect(light._renderer).toBe(lightRenderer);

    // Subsequent setStyle на feature НЕ оборачивает новый стиль.
    const newLightRenderer = jest.fn();
    const newLight = makeStyleWithRenderer(newLightRenderer as never);
    feature.setStyle([newLight]);
    expect(newLight.setRenderer).not.toHaveBeenCalled();
  });

  test('disable without enable is idempotent (no throw)', () => {
    expect(() => {
      void pointTextFix.disable();
    }).not.toThrow();
  });
});

// ── module metadata ───────────────────────────────────────────────────────────

describe('pointTextFix metadata', () => {
  test('has correct id', () => {
    expect(pointTextFix.id).toBe('pointTextFix');
  });

  test('has map category', () => {
    expect(pointTextFix.category).toBe('map');
  });

  test('is enabled by default', () => {
    expect(pointTextFix.defaultEnabled).toBe(true);
  });

  test('has localized name and description', () => {
    expect(pointTextFix.name.ru).toBeTruthy();
    expect(pointTextFix.name.en).toBeTruthy();
    expect(pointTextFix.description.ru).toBeTruthy();
    expect(pointTextFix.description.en).toBeTruthy();
  });
});
