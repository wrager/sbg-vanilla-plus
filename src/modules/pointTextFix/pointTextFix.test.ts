import {
  buildRefCounts,
  fontSizeForZoom,
  pointTextFix,
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

function makePointFeature(id: string): IOlFeature {
  return {
    getGeometry: () => ({ getCoordinates: () => [0, 0] }),
    getId: () => id,
    setId: jest.fn(),
    setStyle: jest.fn(),
  };
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

// ── wrapLightRenderer ─────────────────────────────────────────────────────────

describe('wrapLightRenderer', () => {
  test('font 46px при zoom=16 заменяется на 13px (адаптивный)', () => {
    const original = jest.fn((_coords: unknown, state: { context: IMockCtx }) => {
      state.context.font = 'bold 46px "Manrope"';
    });
    const wrapped = wrapLightRenderer(original as never, () => 16);
    const ctx = makeCtx();
    wrapped(null, { context: ctx as unknown as CanvasRenderingContext2D, rotation: 0 });
    expect(ctx.font).toBe('bold 13px "Manrope"');
  });

  test('font на zoom=13 -> 10px', () => {
    const original = jest.fn((_coords: unknown, state: { context: IMockCtx }) => {
      state.context.font = 'bold 46px "Manrope"';
    });
    const wrapped = wrapLightRenderer(original as never, () => 13);
    const ctx = makeCtx();
    wrapped(null, { context: ctx as unknown as CanvasRenderingContext2D, rotation: 0 });
    expect(ctx.font).toBe('bold 10px "Manrope"');
  });

  test('font множится на pixelRatio (зеркало OL Text textScale = pixelRatio * scale)', () => {
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

  test('font без Npx проходит без изменений', () => {
    const original = jest.fn((_coords: unknown, state: { context: IMockCtx }) => {
      state.context.font = 'italic Manrope';
    });
    const wrapped = wrapLightRenderer(original as never, () => 16);
    const ctx = makeCtx();
    wrapped(null, { context: ctx as unknown as CanvasRenderingContext2D, rotation: 0 });
    expect(ctx.font).toBe('italic Manrope');
  });

  test('fillText при rotation=0 - прямой pass-through, без save/restore', () => {
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

  test('fillText при rotation!=0 компенсирует поворот вокруг (x,y)', () => {
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

  test('strokeText при rotation!=0 - та же compensation', () => {
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

  test('non-text методы проходят на реальный context без обёртки', () => {
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
    expect(ctx.save).not.toHaveBeenCalled();
    expect(ctx.restore).not.toHaveBeenCalled();
  });

  test('fillStyle/strokeStyle/lineWidth setters проходят без изменений (нативные цвета сохранены)', () => {
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

  test('обёрнутый renderer несёт WRAPPED_MARKER symbol', () => {
    const original = jest.fn();
    const wrapped = wrapLightRenderer(original as never, () => 16);
    const markers = Object.getOwnPropertySymbols(wrapped);
    expect(markers.length).toBeGreaterThan(0);
    const marker = markers.find((s) => s.description === WRAPPED_MARKER_DESC);
    expect(marker).toBeDefined();
    expect((wrapped as unknown as Record<symbol, unknown>)[marker as symbol]).toBe(true);
  });

  test('original получает state с proxy context, остальные поля сохранены', () => {
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
    expect(callArg.context).not.toBe(ctx);
  });
});

// ── Backup/restore highlight[7] для подавления native channel refs ───────────

describe('wrapLightRenderer: подавление native channel refs (highlight[7])', () => {
  test('перед вызовом original highlight[7] = undefined; после восстанавливается', () => {
    const highlight: unknown[] = [];
    highlight[5] = 3;
    highlight[7] = 12;
    const feature = makeFeature(null, { highlight });

    let valueDuringRender: unknown = 'NOT-CAPTURED';
    const original = jest.fn((_coords: unknown, state: { context: IMockCtx }) => {
      // Внутри renderer'а игра делает `values[id]` где values = highlight.
      // Для id=7 (refs) это значение должно быть undefined.
      valueDuringRender = highlight[7];
      state.context.fillText('whatever', 0, 0);
    });
    const wrapped = wrapLightRenderer(original as never, () => 16);
    const ctx = makeCtx();

    wrapped(null, {
      context: ctx as unknown as CanvasRenderingContext2D,
      rotation: 0,
      feature,
    });

    expect(valueDuringRender).toBeUndefined();
    // После - восстановлено для других потребителей prop.highlight (showInfo, attack).
    expect(highlight[7]).toBe(12);
  });

  test('значения других каналов не трогаются (Levels = highlight[5], Cores = highlight[6], Guards = highlight[8])', () => {
    const highlight: unknown[] = [];
    highlight[5] = 3;
    highlight[6] = 2;
    highlight[7] = 12;
    highlight[8] = 1;
    const feature = makeFeature(null, { highlight });

    const captured: Record<number, unknown> = {};
    const original = jest.fn(() => {
      for (let i = 0; i < 10; i++) captured[i] = highlight[i];
    });
    const wrapped = wrapLightRenderer(original as never, () => 16);
    const ctx = makeCtx();

    wrapped(null, {
      context: ctx as unknown as CanvasRenderingContext2D,
      rotation: 0,
      feature,
    });

    expect(captured[5]).toBe(3);
    expect(captured[6]).toBe(2);
    expect(captured[7]).toBeUndefined();
    expect(captured[8]).toBe(1);
  });

  test('feature без highlight prop - не падает, original вызывается', () => {
    const feature = makeFeature(null, {});
    const original = jest.fn();
    const wrapped = wrapLightRenderer(original as never, () => 16);
    const ctx = makeCtx();
    expect(() => {
      wrapped(null, {
        context: ctx as unknown as CanvasRenderingContext2D,
        rotation: 0,
        feature,
      });
    }).not.toThrow();
    expect(original).toHaveBeenCalledTimes(1);
  });

  test('non-array highlight - не падает, original вызывается', () => {
    const feature = makeFeature(null, { highlight: 'not-an-array' });
    const original = jest.fn();
    const wrapped = wrapLightRenderer(original as never, () => 16);
    const ctx = makeCtx();
    expect(() => {
      wrapped(null, {
        context: ctx as unknown as CanvasRenderingContext2D,
        rotation: 0,
        feature,
      });
    }).not.toThrow();
    expect(original).toHaveBeenCalledTimes(1);
  });

  test('state без feature - не падает, backup отсутствует, original вызывается', () => {
    const original = jest.fn();
    const wrapped = wrapLightRenderer(original as never, () => 16);
    const ctx = makeCtx();
    expect(() => {
      wrapped(null, { context: ctx as unknown as CanvasRenderingContext2D, rotation: 0 });
    }).not.toThrow();
    expect(original).toHaveBeenCalledTimes(1);
  });

  test('исключение в original не оставляет highlight[7] в состоянии undefined', () => {
    const highlight: unknown[] = [];
    highlight[7] = 42;
    const feature = makeFeature(null, { highlight });
    const original = jest.fn(() => {
      throw new Error('boom');
    });
    const wrapped = wrapLightRenderer(original as never, () => 16);
    const ctx = makeCtx();
    expect(() => {
      wrapped(null, {
        context: ctx as unknown as CanvasRenderingContext2D,
        rotation: 0,
        feature,
      });
    }).toThrow('boom');
    expect(highlight[7]).toBe(42);
  });
});

// ── wrapStyleArray ────────────────────────────────────────────────────────────

describe('wrapStyleArray', () => {
  test('оборачивает LIGHT renderer, не трогает POINT-стиль', () => {
    const lightRenderer = jest.fn();
    const light = makeStyleWithRenderer(lightRenderer as never);
    const point = makeStyleWithoutRenderer();
    wrapStyleArray([point, light], () => 16);
    expect(light.setRenderer).toHaveBeenCalledTimes(1);
    expect(light._renderer).not.toBe(lightRenderer);
  });

  test('non-array вход - no-op', () => {
    const lightRenderer = jest.fn();
    const light = makeStyleWithRenderer(lightRenderer as never);
    wrapStyleArray(light, () => 16);
    expect(light.setRenderer).not.toHaveBeenCalled();
  });

  test('null и undefined - no-op', () => {
    expect(() => {
      wrapStyleArray(null, () => 16);
    }).not.toThrow();
    expect(() => {
      wrapStyleArray(undefined, () => 16);
    }).not.toThrow();
  });

  test('уже обёрнутый renderer не оборачивается повторно', () => {
    const original = jest.fn();
    const wrappedOnce = wrapLightRenderer(original as never, () => 16);
    const style = makeStyleWithRenderer(wrappedOnce);
    wrapStyleArray([style], () => 16);
    expect(style.setRenderer).not.toHaveBeenCalled();
  });
});

// ── wrapFeature / unwrapFeature ───────────────────────────────────────────────

describe('wrapFeature / unwrapFeature', () => {
  test('после wrap setStyle оборачивает LIGHT renderer в переданном массиве', () => {
    const feature = makeFeature(null);
    wrapFeature(feature, () => 16);
    const lightRenderer = jest.fn();
    const light = makeStyleWithRenderer(lightRenderer as never);
    const point = makeStyleWithoutRenderer();
    feature.setStyle([point, light]);
    expect(light.setRenderer).toHaveBeenCalledTimes(1);
    expect(feature.getStyle()).toEqual([point, light]);
  });

  test('повторный wrapFeature на ту же feature - no-op', () => {
    const feature = makeFeature(null);
    wrapFeature(feature, () => 16);
    const firstSetStyle = feature.setStyle;
    wrapFeature(feature, () => 16);
    expect(feature.setStyle).toBe(firstSetStyle);
  });

  test('текущий стиль во время wrap оборачивается сразу', () => {
    const lightRenderer = jest.fn();
    const light = makeStyleWithRenderer(lightRenderer as never);
    const feature = makeFeature([light]);
    wrapFeature(feature, () => 16);
    expect(light.setRenderer).toHaveBeenCalledTimes(1);
  });

  test('unwrapFeature восстанавливает setStyle (последующий setStyle не оборачивает)', () => {
    const feature = makeFeature(null);
    wrapFeature(feature, () => 16);
    unwrapFeature(feature);
    const lightRenderer = jest.fn();
    const light = makeStyleWithRenderer(lightRenderer as never);
    feature.setStyle([light]);
    expect(light.setRenderer).not.toHaveBeenCalled();
  });

  test('unwrapFeature восстанавливает оригинальный renderer на текущем LIGHT-стиле', () => {
    const lightRenderer = jest.fn();
    const light = makeStyleWithRenderer(lightRenderer as never);
    const feature = makeFeature([light]);
    wrapFeature(feature, () => 16);
    expect(light._renderer).not.toBe(lightRenderer);
    unwrapFeature(feature);
    expect(light._renderer).toBe(lightRenderer);
  });

  test('feature.changed() после in-place мутации стиля заново оборачивает новый LIGHT', () => {
    const oldLightRenderer = jest.fn();
    const oldLight = makeStyleWithRenderer(oldLightRenderer as never);
    const feature = makeFeature([oldLight]);
    wrapFeature(feature, () => 16);

    // Игра мутирует in-place: style[1] = новый LIGHT с нативным renderer.
    const newLightRenderer = jest.fn();
    const newLight = makeStyleWithRenderer(newLightRenderer as never);
    const styles = feature.getStyle() as IMockStyle[];
    styles[0] = newLight;

    feature.changed();

    expect(newLight.setRenderer).toHaveBeenCalledTimes(1);
    expect(newLight._renderer).not.toBe(newLightRenderer);
  });

  test('unwrapFeature отписывается от change (последующий changed не оборачивает)', () => {
    const feature = makeFeature(null);
    wrapFeature(feature, () => 16);
    unwrapFeature(feature);

    const lightRenderer = jest.fn();
    const light = makeStyleWithRenderer(lightRenderer as never);
    feature._style = [light];
    feature.changed();

    expect(light.setRenderer).not.toHaveBeenCalled();
  });

  test('повторный unwrapFeature - no-op', () => {
    const feature = makeFeature(null);
    wrapFeature(feature, () => 16);
    unwrapFeature(feature);
    expect(() => {
      unwrapFeature(feature);
    }).not.toThrow();
  });

  test('feature.changed вызывается после wrap для инвалидации render plan', () => {
    const feature = makeFeature(null);
    const before = feature._changedCalls;
    wrapFeature(feature, () => 16);
    expect(feature._changedCalls).toBeGreaterThan(before);
  });

  test('feature.changed вызывается после unwrap для возврата нативного render plan', () => {
    const feature = makeFeature(null);
    wrapFeature(feature, () => 16);
    const before = feature._changedCalls;
    unwrapFeature(feature);
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

  test('агрегирует количество ключей по точке', () => {
    const items = [
      { g: 'r1', t: 3, l: 'point-1', a: 2 },
      { g: 'r2', t: 3, l: 'point-1', a: 1 },
      { g: 'r3', t: 3, l: 'point-2', a: 3 },
    ];
    localStorage.setItem('inventory-cache', JSON.stringify(items));
    const counts = buildRefCounts();
    expect(counts.get('point-1')).toBe(3);
    expect(counts.get('point-2')).toBe(3);
  });

  test('игнорирует не-ref предметы', () => {
    const items = [
      { g: 'c1', t: 1, l: 5, a: 5 },
      { g: 'r1', t: 3, l: 'point-2', a: 2 },
    ];
    localStorage.setItem('inventory-cache', JSON.stringify(items));
    const counts = buildRefCounts();
    expect(counts.has('point-1')).toBe(false);
    expect(counts.get('point-2')).toBe(2);
  });
});

// ── module metadata ───────────────────────────────────────────────────────────

describe('pointTextFix metadata', () => {
  test('id = pointTextFix (без миграции settings)', () => {
    expect(pointTextFix.id).toBe('pointTextFix');
  });

  test('категория map', () => {
    expect(pointTextFix.category).toBe('map');
  });

  test('включён по умолчанию', () => {
    expect(pointTextFix.defaultEnabled).toBe(true);
  });

  test('имеет локализованные name и description', () => {
    expect(pointTextFix.name.ru).toBeTruthy();
    expect(pointTextFix.name.en).toBeTruthy();
    expect(pointTextFix.description.ru).toBeTruthy();
    expect(pointTextFix.description.en).toBeTruthy();
  });
});

// ── enable / disable ──────────────────────────────────────────────────────────

jest.mock('../../core/olMap', () => ({
  getOlMap: jest.fn(),
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- requireActual returns any
  findLayerByName: jest.requireActual('../../core/olMap').findLayerByName,
}));

import { getOlMap } from '../../core/olMap';

const mockGetOlMap = getOlMap as jest.MockedFunction<typeof getOlMap>;

describe('pointTextFix enable / disable - wrap pipeline', () => {
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

  test('enable подписывается на addfeature points source', async () => {
    await pointTextFix.enable();
    expect(pointsSrc._listeners.get('addfeature')?.length).toBe(1);
  });

  test('enable оборачивает существующие features в points source', async () => {
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

  test('addfeature event после enable оборачивает новую feature', async () => {
    await pointTextFix.enable();
    const lightRenderer = jest.fn();
    const light = makeStyleWithRenderer(lightRenderer as never);
    const newFeature = makeFeature([light]);
    pointsSrc._emit('addfeature', { feature: newFeature });
    expect(light.setRenderer).toHaveBeenCalledTimes(1);
  });

  test('disable отписывается от addfeature и unwrap-ает features', async () => {
    const lightRenderer = jest.fn();
    const light = makeStyleWithRenderer(lightRenderer as never);
    const feature = makeFeature([light]);
    pointsSrc = makeSource([feature]);
    const pointsLayer = makeLayer('points', pointsSrc);
    olMap = makeMap([pointsLayer], view);
    mockGetOlMap.mockResolvedValue(olMap);

    await pointTextFix.enable();
    await pointTextFix.disable();

    expect(pointsSrc._listeners.get('addfeature')?.length ?? 0).toBe(0);
    expect(light._renderer).toBe(lightRenderer);
  });

  test('enable без points layer - no-op', async () => {
    const otherLayer = makeLayer('other', makeSource());
    olMap = makeMap([otherLayer], view);
    mockGetOlMap.mockResolvedValue(olMap);
    await pointTextFix.enable();
    expect(pointsSrc._listeners.get('addfeature')).toBeUndefined();
  });

  test('disable без enable идемпотентен', () => {
    expect(() => {
      void pointTextFix.disable();
    }).not.toThrow();
  });

  test('race-disable во время await getOlMap не оставляет вечную подписку addfeature', async () => {
    let resolveGetOlMap: ((value: IOlMap) => void) | undefined;
    const pendingMap = new Promise<IOlMap>((resolve) => {
      resolveGetOlMap = resolve;
    });
    mockGetOlMap.mockReturnValueOnce(pendingMap);

    const enablePromise = pointTextFix.enable();
    void pointTextFix.disable();
    resolveGetOlMap?.(olMap);
    await enablePromise;

    expect(pointsSrc._listeners.get('addfeature')?.length ?? 0).toBe(0);
    expect(pointsSrc._listeners.get('change')?.length ?? 0).toBe(0);
  });
});

// ── enable / disable - overlay pipeline ───────────────────────────────────────

describe('pointTextFix enable / disable - overlay pipeline', () => {
  let pointsSrc: IMockSource;
  let view: IMockView;
  let olMap: IOlMap;
  let createdSources: IOlVectorSource[];

  beforeEach(() => {
    localStorage.clear();
    pointsSrc = makeSource([makePointFeature('p1'), makePointFeature('p2')]);
    view = makeView(16);
    const pointsLayer = makeLayer('points', pointsSrc);
    olMap = makeMap([pointsLayer], view);
    mockGetOlMap.mockResolvedValue(olMap);
    ({ createdSources } = mockOl());
  });

  afterEach(async () => {
    await pointTextFix.disable();
    delete window.ol;
  });

  test('добавляет own layer на enable, удаляет на disable', async () => {
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

  test('подписывается на change у points source и change:resolution у view', async () => {
    await pointTextFix.enable();
    expect(pointsSrc._listeners.get('change')?.length).toBeGreaterThan(0);
    expect(view._listeners.get('change:resolution')?.length).toBeGreaterThan(0);
  });

  test('disable отписывается от change и change:resolution', async () => {
    await pointTextFix.enable();
    await pointTextFix.disable();
    expect(pointsSrc._listeners.get('change')?.length ?? 0).toBe(0);
    expect(view._listeners.get('change:resolution')?.length ?? 0).toBe(0);
  });

  test('рисует label для каждой точки с refs > 0, остальные пропускает', async () => {
    localStorage.setItem(
      'inventory-cache',
      JSON.stringify([
        { g: 'r1', t: 3, l: 'p1', a: 5 },
        { g: 'r2', t: 3, l: 'p3', a: 7 },
      ]),
    );

    await pointTextFix.enable();

    const labelsSrc = createdSources[createdSources.length - 1];
    expect((labelsSrc.addFeature as jest.Mock).mock.calls.length).toBe(1);
  });

  test('не рисует labels на zoom < MIN_ZOOM', async () => {
    view._setZoom(12);
    localStorage.setItem('inventory-cache', JSON.stringify([{ g: 'r1', t: 3, l: 'p1', a: 5 }]));

    await pointTextFix.enable();

    const labelsSrc = createdSources[createdSources.length - 1];
    expect((labelsSrc.addFeature as jest.Mock).mock.calls.length).toBe(0);
  });

  test('source change event перерисовывает labels через debounce', async () => {
    jest.useFakeTimers();
    localStorage.setItem('inventory-cache', JSON.stringify([{ g: 'r1', t: 3, l: 'p1', a: 5 }]));

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

  test('change:resolution event перерисовывает labels (без debounce)', async () => {
    localStorage.setItem('inventory-cache', JSON.stringify([{ g: 'r1', t: 3, l: 'p1', a: 5 }]));
    await pointTextFix.enable();

    const labelsSrc = createdSources[createdSources.length - 1];
    const initial = (labelsSrc.addFeature as jest.Mock).mock.calls.length;

    const cb = view._listeners.get('change:resolution')?.[0];
    cb?.();

    expect((labelsSrc.addFeature as jest.Mock).mock.calls.length).toBe(initial + 1);
  });

  test('MutationObserver на #self-info__inv ререндерит при изменении инвентаря', async () => {
    const inv = document.createElement('span');
    inv.id = 'self-info__inv';
    inv.textContent = '0';
    document.body.appendChild(inv);

    localStorage.setItem('inventory-cache', JSON.stringify([{ g: 'r1', t: 3, l: 'p1', a: 5 }]));

    await pointTextFix.enable();

    const labelsSrc = createdSources[createdSources.length - 1];
    const initial = (labelsSrc.addFeature as jest.Mock).mock.calls.length;

    inv.textContent = '12';
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));

    expect((labelsSrc.addFeature as jest.Mock).mock.calls.length).toBeGreaterThan(initial);

    inv.remove();
  });
});
