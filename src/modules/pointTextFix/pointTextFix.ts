import type { IFeatureModule } from '../../core/moduleRegistry';
import { getOlMap, findLayerByName } from '../../core/olMap';
import type { IOlMap, IOlVectorSource, IOlLayer, IOlFeature } from '../../core/olMap';
import { readInventoryReferences } from '../../core/inventoryCache';
import { getTextColor, getBackgroundColor } from '../../core/themeColors';

const MODULE_ID = 'pointTextFix';
const LABELS_LAYER_NAME = 'svp-point-text-fix';
// Канал references в FeatureStyles.LIGHT (case 7 в refs/game/script.js около 374)
// и индекс в массиве `prop.highlight`. Native renderer на этом канале рисует
// число, в нашей реализации native пропускается, а число берётся из inventory-cache
// и рисуется на отдельном overlay-слое.
const REFS_CHANNEL_INDEX = 7;
const MIN_ZOOM = 13;
const DEBOUNCE_MS = 100;
const WRAPPED_MARKER = Symbol('svp.pointTextFix.wrapped');

function clamp(low: number, value: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

/**
 * Адаптивный размер шрифта в зависимости от зума: 10px на zoom 13,
 * 16px на zoom 19+, линейная интерполяция между, фронт-стопы по краям.
 *
 * Нативный LIGHT-renderer (refs/game/script.js около 281) пишет
 * `bold 46px Manrope` константой - на zoom 13-14 числа закрывают сами
 * точки. Наш меньший адаптивный размер остаётся читаемым на любом зуме.
 */
export function fontSizeForZoom(zoom: number): number {
  return Math.round(clamp(10, zoom - 3, 16));
}

// ── Wrap нативного LIGHT-renderer ────────────────────────────────────────────

interface IRendererState {
  context: CanvasRenderingContext2D;
  rotation?: number;
  pixelRatio?: number;
  feature?: IOlFeature;
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
 * Оборачивает нативный LIGHT-renderer. На каждом render call:
 *
 * 1. Перед вызовом original временно подменяет `feature.get('highlight')[7]`
 *    на undefined и восстанавливает после вызова. Native LIGHT-renderer на
 *    case 7 (refs) имеет ранний `if (typeof value === 'undefined') continue`,
 *    поэтому при undefined-значении text для канала refs не рисуется ни в
 *    одном из 3 слотов. Наш overlay-слой рисует это число из inventory-cache.
 *    Backup нужен, чтобы другие места игры (showInfo, attack response,
 *    requestEntities при следующем drawEntities), читающие `prop.highlight`,
 *    видели исходные данные без пропуска нашей подмены.
 *
 * 2. Создаёт Proxy вокруг `state.context`:
 *    - Подменяет любое `Npx` в `ctx.font` на адаптивный размер, умноженный
 *      на `state.pixelRatio`. Множитель повторяет поведение OL Text style
 *      (refs/ol/ol.js около 8841): textScale = pixelRatio * scale, далее
 *      ctx.scale(textScale) перед fillText. Custom renderer вызывается с
 *      уже подготовленным контекстом БЕЗ этой scale-трансформации, поэтому
 *      без ручного умножения на pixelRatio текст выходит в pixelRatio раз
 *      меньше эквивалентного OL Text style того же размера.
 *    - Оборачивает `ctx.fillText`/`ctx.strokeText` в save -> translate(x,y) ->
 *      rotate(-state.rotation) -> translate(-x,-y) -> orig -> restore.
 *      Компенсирует поворот канваса OL под map rotation, текст остаётся
 *      горизонтальным независимо от поворота карты. При rotation=0 - прямой
 *      pass-through без save/restore.
 *    - Все прочие методы и поля - проброс на реальный context (методы через
 *      bind, чтобы CanvasRenderingContext2D работал на своём this).
 *
 * Цвета (fillStyle, strokeStyle), геометрия (beginPath, arc, stroke),
 * остальные text-каналы (Levels, Deployment, Guards) идут нативно. Только
 * канал refs (7) подавляется через backup/restore highlight[7].
 */
export function wrapLightRenderer(original: RendererFn, getZoom: () => number): WrappedRenderer {
  const wrapped: WrappedRenderer = (coordinates, state) => {
    const realCtx = state.context;
    const rotation = state.rotation ?? 0;
    const pixelRatio = state.pixelRatio ?? 1;
    const fontPx = Math.round(fontSizeForZoom(getZoom()) * pixelRatio);

    // Backup и nullify highlight[7] для подавления native channel refs.
    let highlight: unknown[] | null = null;
    let refsBackup: unknown = undefined;
    let refsBackedUp = false;
    const feature = state.feature;
    if (feature && typeof feature.get === 'function') {
      const value: unknown = feature.get('highlight');
      if (Array.isArray(value)) {
        highlight = value;
        refsBackup = value[REFS_CHANNEL_INDEX];
        value[REFS_CHANNEL_INDEX] = undefined;
        refsBackedUp = true;
      }
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

    try {
      original(coordinates, { ...state, context: proxyCtx });
    } finally {
      if (refsBackedUp && highlight) {
        highlight[REFS_CHANNEL_INDEX] = refsBackup;
      }
    }
  };
  wrapped[WRAPPED_MARKER] = true;
  originalRenderers.set(wrapped, original);
  return wrapped;
}

/**
 * В массиве стилей находит те, у которых есть custom renderer (LIGHT-стиль),
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
 * (refs/game/script.js около 2789-2796) и attack response мутирует style[1]
 * в-место (style[1] = FeatureStyles.LIGHT(...)) и вызывает feature.changed()
 * без setStyle. Без обработки 'change' этот новый LIGHT остаётся с нативным
 * renderer, и текст после открытия/закрытия попапа возвращается к 46px.
 * В обработчике повторно прогоняем wrapStyleArray по getStyle() - уже
 * обёрнутые renderer пропускаются по WRAPPED_MARKER, накладные расходы
 * минимальны.
 *
 * После установки обёртки вызываем feature.changed(): style.setRenderer()
 * мутирует функцию рендера in-place, но НЕ диспатчит change-event
 * (refs/ol/ol.js около 6842-6843, setRenderer присваивает renderer_ без
 * changed()). Layer кеширует execution plan по revision counter feature;
 * без явного changed() новый renderer не попадает в plan до внешнего
 * trigger'а (move, zoom, click). Это и есть причина "не применяется до
 * ререндера" на enable.
 */
export function wrapFeature(feature: IOlFeature, getZoom: () => number): void {
  if (wrappedFeatures.has(feature)) return;
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
 * нативный 46px-текст и нативный канал refs снова появится.
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
  if (typeof feature.changed === 'function') feature.changed();
}

// ── Overlay-слой для refs из inventory-cache ─────────────────────────────────

/**
 * Считает суммарное количество ключей на каждой точке из inventory-cache.
 * Ключ ассоциирован с точкой через поле `l` (guid точки) и количеством `a`
 * в стопке. Несколько стопок одной точки складываются.
 */
export function buildRefCounts(): Map<string, number> {
  const refs = readInventoryReferences();
  const counts = new Map<string, number>();
  for (const ref of refs) {
    counts.set(ref.l, (counts.get(ref.l) ?? 0) + ref.a);
  }
  return counts;
}

let map: IOlMap | null = null;
let pointsSource: IOlVectorSource | null = null;
let labelsSource: IOlVectorSource | null = null;
let labelsLayer: IOlLayer | null = null;
let onAddFeature: ((...args: unknown[]) => void) | null = null;
let onPointsChange: (() => void) | null = null;
let onZoomChange: (() => void) | null = null;
let mutationObserver: MutationObserver | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
// installGeneration защищает от race условий между async enable и быстрым
// disable. enable содержит await getOlMap(); если disable отработал во время
// await, мы должны выйти из enable до создания layer и подписок. Тот же
// паттерн в popoverCloser и nativeGarbageGuard.
let installGeneration = 0;

function renderLabels(): void {
  if (!labelsSource || !map || !pointsSource) return;
  labelsSource.clear();

  const zoom = map.getView().getZoom?.() ?? 0;
  if (zoom < MIN_ZOOM) return;

  const counts = buildRefCounts();
  if (counts.size === 0) return;

  const ol = window.ol;
  const OlFeature = ol?.Feature;
  const OlPoint = ol?.geom?.Point;
  const OlStyle = ol?.style?.Style;
  const OlText = ol?.style?.Text;
  const OlFill = ol?.style?.Fill;
  const OlStroke = ol?.style?.Stroke;
  if (!OlFeature || !OlPoint || !OlStyle || !OlText || !OlFill || !OlStroke) return;

  const textColor = getTextColor();
  const bgColor = getBackgroundColor();
  const font = `${String(fontSizeForZoom(zoom))}px Manrope`;

  for (const feature of pointsSource.getFeatures()) {
    const id = feature.getId();
    if (typeof id !== 'string') continue;
    const count = counts.get(id);
    if (!count || count <= 0) continue;
    const coords = feature.getGeometry().getCoordinates();
    const label = new OlFeature({ geometry: new OlPoint(coords) });
    label.setId(id + ':svp-pt-label');
    label.setStyle(
      new OlStyle({
        text: new OlText({
          font,
          text: String(count),
          fill: new OlFill({ color: textColor }),
          stroke: new OlStroke({ color: bgColor, width: 3 }),
        }),
        zIndex: 5,
      }),
    );
    labelsSource.addFeature(label);
  }
}

function scheduleRender(): void {
  if (debounceTimer !== null) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(renderLabels, DEBOUNCE_MS);
}

// ── Module ───────────────────────────────────────────────────────────────────

export const pointTextFix: IFeatureModule = {
  id: MODULE_ID,
  name: { en: 'Point text labels', ru: 'Подписи на точках' },
  description: {
    en: 'Adaptive font (10-16px) for point text in Layers > Text: readable at any zoom and stays horizontal regardless of map rotation. Works for all channels (Levels, Deployment, Guards). For the References channel the count is read directly from your inventory and rendered on a separate overlay layer, so the label updates immediately after discover/recycle without waiting for the next map data refresh.',
    ru: 'Адаптивный размер шрифта (10-16 пикселей) для текста подсветки точек в Layers > Text: читаемо на любом зуме, не вращается вместе с картой. Работает для всех каналов (Levels, Deployment, Guards). Для канала References количество ключей берётся напрямую из инвентаря и рисуется на отдельном overlay-слое, поэтому подпись обновляется сразу после изучения/переработки точки, без ожидания следующего перезапроса карты.',
  },
  defaultEnabled: true,
  category: 'map',

  init() {},

  async enable(): Promise<void> {
    installGeneration++;
    const myGeneration = installGeneration;
    const olMap = await getOlMap();
    if (myGeneration !== installGeneration) return;

    const ol = window.ol;
    const OlVectorSource = ol?.source?.Vector;
    const OlVectorLayer = ol?.layer?.Vector;
    if (!OlVectorSource || !OlVectorLayer) return;

    const pointsLayer = findLayerByName(olMap, 'points');
    if (!pointsLayer) return;
    const src = pointsLayer.getSource();
    if (!src) return;

    map = olMap;
    pointsSource = src;
    const getZoom = (): number => map?.getView().getZoom?.() ?? 0;

    // Wrap LIGHT-renderer'ов на всех существующих и будущих features.
    for (const feature of src.getFeatures()) {
      wrapFeature(feature, getZoom);
    }
    onAddFeature = (...args: unknown[]): void => {
      const event = args[0];
      if (typeof event !== 'object' || event === null) return;
      if (!('feature' in event)) return;
      const candidate = event.feature;
      if (typeof candidate !== 'object' || candidate === null) return;
      // candidate приходит из OL VectorSource - объект с тем же контрактом, что
      // у IOlFeature. Приведение без cast: WeakSet/WeakMap ключей ниже не
      // различает источник, для них достаточно ссылки на объект.
      wrapFeature(candidate as IOlFeature, getZoom);
    };
    src.on('addfeature', onAddFeature);

    // Overlay-слой для refs из inventory-cache.
    labelsSource = new OlVectorSource();
    labelsLayer = new OlVectorLayer({
      // as unknown as: OL Vector constructor accepts a generic options bag;
      // IOlVectorSource cannot be narrowed to Record<string, unknown> without a guard
      source: labelsSource as unknown as Record<string, unknown>,
      name: LABELS_LAYER_NAME,
      zIndex: 5,
    });
    olMap.addLayer(labelsLayer);

    onPointsChange = scheduleRender;
    src.on('change', onPointsChange);

    onZoomChange = renderLabels;
    olMap.getView().on?.('change:resolution', onZoomChange);

    const invEl = document.getElementById('self-info__inv');
    if (invEl) {
      mutationObserver = new MutationObserver(renderLabels);
      mutationObserver.observe(invEl, { characterData: true, childList: true, subtree: true });
    }

    renderLabels();
  },

  disable(): void {
    installGeneration++;

    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    if (mutationObserver) {
      mutationObserver.disconnect();
      mutationObserver = null;
    }
    if (pointsSource && onPointsChange) {
      pointsSource.un('change', onPointsChange);
      onPointsChange = null;
    }
    if (map && onZoomChange) {
      map.getView().un?.('change:resolution', onZoomChange);
      onZoomChange = null;
    }
    if (pointsSource && onAddFeature) {
      pointsSource.un('addfeature', onAddFeature);
      for (const feature of pointsSource.getFeatures()) {
        unwrapFeature(feature);
      }
      onAddFeature = null;
    }
    if (map && labelsLayer) {
      map.removeLayer(labelsLayer);
    }
    map = null;
    pointsSource = null;
    labelsSource = null;
    labelsLayer = null;
  },
};
