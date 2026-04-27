import type { IFeatureModule } from '../../core/moduleRegistry';
import { getOlMap, findLayerByName } from '../../core/olMap';
import type { IOlMap, IOlVectorSource, IOlFeature } from '../../core/olMap';

const MODULE_ID = 'pointTextFix';
const WRAPPED_MARKER = Symbol('svp.pointTextFix.wrapped');

interface IRendererState {
  context: CanvasRenderingContext2D;
  rotation?: number;
  pixelRatio?: number;
}

type RendererFn = (coordinates: unknown, state: IRendererState) => void;
type WrappedRenderer = RendererFn & { [WRAPPED_MARKER]?: true };

interface IOlStyle {
  getRenderer(): RendererFn | null | undefined;
  setRenderer(fn: RendererFn): void;
}

interface IFeatureWithStyle extends IOlFeature {
  getStyle(): unknown;
}

interface IAddFeatureEvent {
  feature: IOlFeature;
}

interface IFeatureWithEvents extends IOlFeature {
  on(type: string, listener: () => void): void;
  un(type: string, listener: () => void): void;
}

const wrappedFeatures = new WeakSet<IOlFeature>();
const originalSetStyles = new WeakMap<IOlFeature, (style: unknown) => void>();
const originalRenderers = new WeakMap<WrappedRenderer, RendererFn>();
const featureChangeListeners = new WeakMap<IOlFeature, () => void>();

let map: IOlMap | null = null;
let pointsSource: IOlVectorSource | null = null;
let onAddFeature: ((e: IAddFeatureEvent) => void) | null = null;

function clamp(low: number, value: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

/**
 * Адаптивный размер шрифта в зависимости от зума. На MIN_ZOOM (13) - 10px,
 * на zoom 18+ - 16px. Линейная интерполяция, фронт-стопы по краям.
 *
 * Нативный игровой LIGHT-renderer (refs/game-beta/script.js:570) пишет
 * `bold 32px Manrope` константой - на zoom 13-14 числа заслоняют сами
 * точки. Наш меньший масштабируемый размер остаётся читаемым на любом
 * зуме.
 */
export function fontSizeForZoom(zoom: number): number {
  return Math.round(clamp(10, zoom - 3, 16));
}

function isStyleWithRenderer(value: unknown): value is IOlStyle {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return typeof obj.getRenderer === 'function' && typeof obj.setRenderer === 'function';
}

function isWrappedRenderer(fn: RendererFn): fn is WrappedRenderer {
  return (fn as WrappedRenderer)[WRAPPED_MARKER] === true;
}

/**
 * Оборачивает нативный LIGHT-renderer. На каждом render call создаёт Proxy
 * вокруг state.context, который:
 *
 * - Подменяет любое выражение `Npx` в ctx.font на адаптивный размер,
 *   умноженный на state.pixelRatio. Множитель повторяет поведение OL Text
 *   style (refs/ol/ol.js:8841): textScale = pixelRatio * scale, далее
 *   ctx.scale(textScale) перед fillText. Custom renderer вызывается с уже
 *   подготовленным контекстом БЕЗ этой scale-трансформации, поэтому без
 *   ручного умножения на pixelRatio текст выходит в pixelRatio раз меньше,
 *   чем у эквивалентного OL Text style того же размера.
 * - Оборачивает ctx.fillText / ctx.strokeText в save -> translate(x,y) ->
 *   rotate(-state.rotation) -> translate(-x,-y) -> orig -> restore.
 *   Компенсирует поворот канваса OL под map rotation, текст остаётся
 *   горизонтальным независимо от поворота карты. При rotation=0 - прямой
 *   pass-through без save/restore.
 * - Все прочие методы и поля - проброс на реальный context (методы через
 *   bind, чтобы CanvasRenderingContext2D работал на своём this).
 *
 * Цвета (fillStyle, strokeStyle) и геометрические вызовы (beginPath, arc,
 * stroke) идут нативно - кольца, сектора, прогресс-бары рисуются как у игры.
 */
export function wrapLightRenderer(original: RendererFn, getZoom: () => number): WrappedRenderer {
  const wrapped: WrappedRenderer = (coordinates, state) => {
    const realCtx = state.context;
    const rotation = state.rotation ?? 0;
    const pixelRatio = state.pixelRatio ?? 1;
    const fontPx = Math.round(fontSizeForZoom(getZoom()) * pixelRatio);

    const proxyCtx = new Proxy(realCtx, {
      set(target, prop, value: unknown): boolean {
        if (prop === 'font' && typeof value === 'string') {
          value = value.replace(/\d+px/, `${String(fontPx)}px`);
        }
        Reflect.set(target, prop, value);
        return true;
      },
      get(target, prop): unknown {
        if ((prop === 'fillText' || prop === 'strokeText') && rotation !== 0) {
          return (text: string, x: number, y: number, maxWidth?: number): void => {
            target.save();
            target.translate(x, y);
            target.rotate(-rotation);
            target.translate(-x, -y);
            if (prop === 'fillText') target.fillText(text, x, y, maxWidth);
            else target.strokeText(text, x, y, maxWidth);
            target.restore();
          };
        }
        const value: unknown = Reflect.get(target, prop, target);
        if (typeof value === 'function') {
          return (value as (...args: unknown[]) => unknown).bind(target);
        }
        return value;
      },
    });

    original(coordinates, { ...state, context: proxyCtx });
  };
  wrapped[WRAPPED_MARKER] = true;
  originalRenderers.set(wrapped, original);
  return wrapped;
}

/**
 * Находит в массиве стилей те, у которых есть custom renderer (LIGHT-стиль),
 * и заменяет их renderer на нашу обёртку через style.setRenderer. Стили без
 * renderer (POINT, TEXT) не трогаются. Уже обёрнутые - не оборачиваются
 * повторно (Symbol-маркер на wrapped-функции).
 */
export function wrapStyleArray(styles: unknown, getZoom: () => number): void {
  if (!Array.isArray(styles)) return;
  for (const style of styles) {
    if (!isStyleWithRenderer(style)) continue;
    const renderer = style.getRenderer();
    if (typeof renderer !== 'function') continue;
    if (isWrappedRenderer(renderer)) continue;
    style.setRenderer(wrapLightRenderer(renderer, getZoom));
  }
}

/**
 * Перехватывает feature.setStyle: каждый новый style array (включая тот,
 * что игра передаёт при attack response через FeatureStyles.LIGHT
 * пересоздание) проходит через wrapStyleArray до установки. Дополнительно
 * оборачивает текущий стиль feature, который уже был установлен ранее.
 *
 * Per-feature override (не Feature.prototype) - чтобы не задевать
 * player/lines/regions, которые setStyle тоже могут вызывать.
 *
 * Дополнительно подписываемся на feature 'change' event: игра в showInfo
 * (refs/game-beta/script.js:2789-2796) и attack response мутирует style[1]
 * в-место (style[1] = FeatureStyles.LIGHT(...)) и вызывает feature.changed()
 * без setStyle. Без обработки 'change' этот новый LIGHT остаётся с нативным
 * renderer, и текст после открытия/закрытия попапа возвращается к 32px.
 * В обработчике повторно прогоняем wrapStyleArray по getStyle() - уже
 * обёрнутые renderer пропускаются по WRAPPED_MARKER, накладные расходы
 * минимальны.
 */
export function wrapFeature(feature: IOlFeature, getZoom: () => number): void {
  if (wrappedFeatures.has(feature)) return;
  const f = feature as IFeatureWithStyle;
  const original = f.setStyle.bind(f) as (style: unknown) => void;
  originalSetStyles.set(feature, original);
  f.setStyle = (style: unknown): void => {
    wrapStyleArray(style, getZoom);
    original(style);
  };
  wrappedFeatures.add(feature);
  wrapStyleArray(f.getStyle(), getZoom);

  const onChange = (): void => {
    wrapStyleArray(f.getStyle(), getZoom);
  };
  featureChangeListeners.set(feature, onChange);
  (f as unknown as IFeatureWithEvents).on('change', onChange);
}

/**
 * Снимает обёртку: восстанавливает оригинальный feature.setStyle и заменяет
 * обёрнутый renderer на текущем LIGHT-стиле обратно на нативный (через
 * WeakMap wrapped -> original). После этого следующий рендер выдаст
 * нативный 32px-текст.
 */
export function unwrapFeature(feature: IOlFeature): void {
  if (!wrappedFeatures.has(feature)) return;
  const f = feature as IFeatureWithStyle;
  const onChange = featureChangeListeners.get(feature);
  if (onChange) {
    (f as unknown as IFeatureWithEvents).un('change', onChange);
    featureChangeListeners.delete(feature);
  }
  const original = originalSetStyles.get(feature);
  if (original) {
    f.setStyle = original;
    originalSetStyles.delete(feature);
  }
  const styles = f.getStyle();
  if (Array.isArray(styles)) {
    for (const style of styles) {
      if (!isStyleWithRenderer(style)) continue;
      const renderer = style.getRenderer();
      if (typeof renderer !== 'function') continue;
      if (!isWrappedRenderer(renderer)) continue;
      const orig = originalRenderers.get(renderer);
      if (orig) style.setRenderer(orig);
    }
  }
  wrappedFeatures.delete(feature);
}

export const pointTextFix: IFeatureModule = {
  id: MODULE_ID,
  name: { en: 'Point text labels', ru: 'Подписи на точках' },
  description: {
    en: 'Replaces native fixed 32px highlighter text on points with adaptive size that stays readable at low zoom and does not rotate with the map. Applies to all text channels in Layers > Text (Levels, Deployment, References, Guards).',
    ru: 'Заменяет нативный фиксированный 32px-текст подсветки точек адаптивным размером: читаемо на любом зуме, текст не вращается вместе с картой. Работает для всех каналов в Layers > Text (Levels, Deployment, References, Guards).',
  },
  defaultEnabled: true,
  category: 'map',

  init() {},

  async enable(): Promise<void> {
    const olMap = await getOlMap();
    const pointsLayer = findLayerByName(olMap, 'points');
    if (!pointsLayer) return;
    const source = pointsLayer.getSource();
    if (!source) return;

    map = olMap;
    pointsSource = source;
    const getZoom = (): number => map?.getView().getZoom?.() ?? 0;

    for (const feature of source.getFeatures()) {
      wrapFeature(feature, getZoom);
    }

    onAddFeature = (e: IAddFeatureEvent): void => {
      wrapFeature(e.feature, getZoom);
    };
    source.on('addfeature', onAddFeature as unknown as () => void);
  },

  disable(): void {
    if (pointsSource && onAddFeature) {
      pointsSource.un('addfeature', onAddFeature as unknown as () => void);
      for (const feature of pointsSource.getFeatures()) {
        unwrapFeature(feature);
      }
    }
    onAddFeature = null;
    pointsSource = null;
    map = null;
  },
};
