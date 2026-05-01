import type { IFeatureModule } from '../../core/moduleRegistry';
import { diagAlert } from '../../core/diagAlert';
import { getOlMap, findLayerByName } from '../../core/olMap';
import type { IOlMap, IOlVectorSource, IOlFeature } from '../../core/olMap';

const MODULE_ID = 'improvedPointText';
const WRAPPED_MARKER = Symbol('svp.improvedPointText.wrapped');

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

const wrappedFeatures = new WeakSet<IOlFeature>();
const originalSetStyles = new WeakMap<IOlFeature, (style: unknown) => void>();
const originalRenderers = new WeakMap<WrappedRenderer, RendererFn>();
const featureChangeListeners = new WeakMap<IOlFeature, () => void>();

let map: IOlMap | null = null;
let pointsSource: IOlVectorSource | null = null;
let onAddFeature: ((...args: unknown[]) => void) | null = null;

// DIAGNOSTIC (beta.12): счётчик создания Proxy в wrapped renderer для оценки
// перформанс-нагрузки. Один alert через 5 сек после первого render frame с
// rate Proxy/sec. Удалить после анализа.
let diagProxyCount = 0;
let diagProxyStartedAt = 0;
let diagProxyAlertShown = false;
// installGeneration защищает от race условий между async enable и быстрым
// disable. enable содержит await getOlMap() - если disable отработал во время
// await, мы должны выйти из enable до записи map/pointsSource и подписки на
// addfeature, иначе подписка остаётся вечно. См. тот же паттерн в popoverCloser
// и nativeGarbageGuard.
let installGeneration = 0;

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
  if (!('getRenderer' in value) || typeof value.getRenderer !== 'function') return false;
  if (!('setRenderer' in value) || typeof value.setRenderer !== 'function') return false;
  return true;
}

function isWrappedRenderer(fn: RendererFn): fn is WrappedRenderer {
  return (fn as Partial<WrappedRenderer>)[WRAPPED_MARKER] === true;
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

    // DIAGNOSTIC (beta.12): первая запись стартует таймер; через 5 сек один
    // alert с накопленным count и rate. Удалить после анализа.
    diagProxyCount++;
    if (diagProxyStartedAt === 0) {
      diagProxyStartedAt = Date.now();
      setTimeout(() => {
        if (diagProxyAlertShown) return;
        diagProxyAlertShown = true;
        const elapsed = Date.now() - diagProxyStartedAt;
        const rate = elapsed > 0 ? Math.round((diagProxyCount * 1000) / elapsed) : 0;
        diagAlert(
          `SVP improvedPointText\n` +
            `proxies: ${String(diagProxyCount)}\n` +
            `elapsed: ${String(elapsed)}ms\n` +
            `rate: ${String(rate)}/sec`,
        );
      }, 5000);
    }

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
 *
 * После установки обёртки вызываем feature.changed(): style.setRenderer()
 * мутирует функцию рендера in-place, но НЕ диспатчит change-event
 * (refs/ol/ol.js:6842-6843, setRenderer присваивает renderer_ без changed()).
 * Layer кеширует execution plan по revision counter feature; без явного
 * changed() новый renderer не попадает в plan до внешнего trigger'а
 * (move, zoom, click). Это и есть причина «не применяется до ререндера»
 * на enable и «не отрисовывается при движении» на addfeature - оба пути
 * обворачивают renderer без своего changed().
 */
export function wrapFeature(feature: IOlFeature, getZoom: () => number): void {
  if (wrappedFeatures.has(feature)) return;
  // getStyle/on/un - опциональные методы IOlFeature; в реальном OL они есть
  // у любой фичи. Пропускаем фичу, если рантайм не предоставил их (мок-сценарии,
  // частично инициализированный объект) - хуже остаться без подписи, чем
  // упасть на null.
  if (typeof feature.getStyle !== 'function') return;
  if (typeof feature.on !== 'function' || typeof feature.un !== 'function') return;
  const originalSetStyle = feature.setStyle.bind(feature);
  originalSetStyles.set(feature, originalSetStyle);
  feature.setStyle = (style: unknown): void => {
    wrapStyleArray(style, getZoom);
    originalSetStyle(style);
  };
  wrappedFeatures.add(feature);
  wrapStyleArray(feature.getStyle(), getZoom);

  const onChange = (): void => {
    if (typeof feature.getStyle === 'function') {
      wrapStyleArray(feature.getStyle(), getZoom);
    }
  };
  featureChangeListeners.set(feature, onChange);
  feature.on('change', onChange);

  if (typeof feature.changed === 'function') feature.changed();
}

/**
 * Снимает обёртку: восстанавливает оригинальный feature.setStyle и заменяет
 * обёрнутый renderer на текущем LIGHT-стиле обратно на нативный (через
 * WeakMap wrapped -> original). После этого следующий рендер выдаст
 * нативный 32px-текст.
 */
export function unwrapFeature(feature: IOlFeature): void {
  if (!wrappedFeatures.has(feature)) return;
  const onChange = featureChangeListeners.get(feature);
  if (onChange && typeof feature.un === 'function') {
    feature.un('change', onChange);
    featureChangeListeners.delete(feature);
  }
  const originalSetStyle = originalSetStyles.get(feature);
  if (originalSetStyle) {
    feature.setStyle = originalSetStyle;
    originalSetStyles.delete(feature);
  }
  const styles = typeof feature.getStyle === 'function' ? feature.getStyle() : null;
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
  // Invalidate cached render plan: OL держит execution plan с нашим wrapped
  // renderer и продолжит его использовать пока feature не invalidate-нется
  // (move/zoom карты, server update). Без явного changed() пользователь после
  // disable модуля видит наш текст до следующего ререндера. feature.changed()
  // ставит флаг "нужен фреш plan", и на следующем render OL вызовет уже
  // оригинальный renderer.
  feature.changed?.();
}

export const improvedPointText: IFeatureModule = {
  id: MODULE_ID,
  name: { en: 'Improved point text', ru: 'Улучшенный текст на точках' },
  description: {
    en: 'Adaptive font for the point text label selected in Layers > Text. The label stays horizontal regardless of map rotation.',
    ru: 'Адаптивный размер шрифта для текста подсветки точек, выбранного в Layers > Text. Подпись не вращается вместе с картой.',
  },
  defaultEnabled: true,
  category: 'map',

  init() {},

  async enable(): Promise<void> {
    installGeneration++;
    const myGeneration = installGeneration;
    const olMap = await getOlMap();
    // disable отработал между стартом enable и резолвом getOlMap - выходим до
    // подписки на addfeature, чтобы не оставить вечный обработчик.
    if (myGeneration !== installGeneration) return;
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

    onAddFeature = (...args: unknown[]): void => {
      const event = args[0];
      if (typeof event !== 'object' || event === null) return;
      if (!('feature' in event)) return;
      const candidate = event.feature;
      if (typeof candidate !== 'object' || candidate === null) return;
      // `feature` приходит из OL VectorSource - объект с тем же контрактом, что
      // у IOlFeature (getStyle, on, un, setStyle опциональны на уровне типа,
      // но фактически есть). Приведение к IOlFeature без cast: WeakSet/WeakMap
      // ключей ниже не различает источник, для них достаточно ссылки на объект.
      wrapFeature(candidate as IOlFeature, getZoom);
    };
    source.on('addfeature', onAddFeature);
  },

  disable(): void {
    installGeneration++;
    if (pointsSource && onAddFeature) {
      pointsSource.un('addfeature', onAddFeature);
      for (const feature of pointsSource.getFeatures()) {
        unwrapFeature(feature);
      }
    }
    onAddFeature = null;
    pointsSource = null;
    map = null;
  },
};
