import type { IFeatureModule } from '../../core/moduleRegistry';
import { getOlMap, findLayerByName } from '../../core/olMap';
import type { IOlMap, IOlVectorSource, IOlLayer, IOlFeature } from '../../core/olMap';
import { readInventoryReferences } from '../../core/inventoryCache';
import { getTextColor, getBackgroundColor } from '../../core/themeColors';

const MODULE_ID = 'pointTextFix';
const LABELS_LAYER_NAME = 'svp-point-text-fix';
const MAP_CONFIG_KEY = 'map-config';
const MIN_ZOOM = 13;
const DEBOUNCE_MS = 100;
const WRAPPED_MARKER = Symbol('svp.pointTextFix.wrapped');

// Каналы Layers > Text picker, для которых в FeatureStyles.LIGHT (refs/game/script.js около 269)
// рисуется текст: Levels (5), Cores (6), References (7), Guards (8).
// Channels 1-4, 9 рисуют арки/кольца/секторы/прогресс-бары и текст не выпускают.
type TextChannel = 5 | 6 | 7 | 8;
const REFS_CHANNEL: TextChannel = 7;

function clamp(low: number, value: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

/**
 * Адаптивный размер шрифта в зависимости от зума: 10px на zoom 13,
 * 16px на zoom 19+, линейная интерполяция между, фронт-стопы по краям.
 *
 * Нативный LIGHT-renderer (refs/game/script.js около 281) пишет
 * `bold 46px Manrope` константой - на zoom 13-14 числа закрывают сами
 * точки. Адаптивный размер остаётся читаемым на любом зуме.
 */
export function fontSizeForZoom(zoom: number): number {
  return Math.round(clamp(10, zoom - 3, 16));
}

// ── map-config.h ─────────────────────────────────────────────────────────────

interface IMapConfig {
  l?: number;
  h?: number;
}

/**
 * Читает поле `h` из `localStorage['map-config']` - bitfield из 3 слотов
 * по 8 бит, в каждом 0 (off) или индекс канала 1..7. Slot N извлекается
 * как `(h >> N*8) & 0xff`. Игра упаковывает значение здесь же на сохранении
 * (refs/game/script.js около 1738) и читает при создании LIGHT-стиля
 * (refs/game/script.js около 3194), передавая в closure.
 *
 * Возвращает 0 для отсутствующего/невалидного значения - совпадает с native
 * fallback `JSON.parse(...).h ?? 0`.
 */
export function readMapConfigH(): number {
  const raw = localStorage.getItem(MAP_CONFIG_KEY);
  if (!raw) return 0;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return 0;
  }
  if (typeof parsed !== 'object' || parsed === null) return 0;
  const h = (parsed as IMapConfig).h;
  return typeof h === 'number' ? h : 0;
}

/** Канал в slot 2 (центральный текст) - то, что игрок выбрал в третьем select-е Layers > Text. */
function getCenterChannel(ids: number): number {
  return (ids >>> 16) & 0xff;
}

function isTextChannel(channel: number): channel is TextChannel {
  return channel === 5 || channel === 6 || channel === 7 || channel === 8;
}

// ── Predicted text queue (counter-based фильтр в wrap) ───────────────────────

interface IPredictedTextItem {
  slot: 0 | 1 | 2;
  channel: TextChannel;
}

/**
 * Моделирует порядок ctx.strokeText/fillText вызовов нативного LIGHT-renderer
 * (refs/game/script.js около 301-378) для заданных `ids` (map-config.h) и
 * `highlight` (`prop.highlight` точки). Возвращает упорядоченный список text-пар:
 * каждая пара = одна последовательность `ctx.strokeText(value, ...)` +
 * `ctx.fillText(value, ...)`.
 *
 * Логика по слотам i=0..2:
 * - id = (ids >> i*8) & 0xff
 * - is_text = (i === 2)
 * - case 5 (Levels):  text только если is_text. value=0 не пропускается (native рисует "0").
 * - case 6 (Cores):   `if (!value) continue` ВСЯ итерация (нет ни pellets, ни text). При is_text - text.
 * - case 7 (Refs):    `if (!value) continue`. Нет is_text-проверки, text во всех слотах.
 * - case 8 (Guards):  `if (value === -1) continue`. Нет is_text-проверки.
 * - case 1-4, 9:      text не рисуют.
 *
 * Используется в Proxy на ctx внутри wrapLightRenderer для подсчёта индекса
 * пары: `pairIdx = Math.floor(textCallCounter / 2)` маппит `i`-ю пару text-вызовов
 * на её slot/channel в queue. Slot 2 пропускаем (overlay рисует), slot 0/1
 * (редкие случаи, channel 7/8 в нетипичной конфигурации) - pass-through через
 * wrap с adaptive font и поворот-compensation.
 */
export function predictTextQueue(ids: number, highlight: readonly unknown[]): IPredictedTextItem[] {
  const queue: IPredictedTextItem[] = [];
  for (let i = 0; i < 3; i++) {
    const slot = i as 0 | 1 | 2;
    const id = (ids >>> (slot * 8)) & 0xff;
    const value = highlight[id];
    if (typeof value === 'undefined') continue;
    const isText = slot === 2;
    if (id === 5) {
      if (isText) queue.push({ slot, channel: 5 });
    } else if (id === 6) {
      if (!value) continue;
      if (isText) queue.push({ slot, channel: 6 });
    } else if (id === 7) {
      if (!value) continue;
      queue.push({ slot, channel: 7 });
    } else if (id === 8) {
      if (value === -1) continue;
      queue.push({ slot, channel: 8 });
    }
  }
  return queue;
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
 * 1. `ctx.font` - подмена `Npx` на `fontSizeForZoom(zoom) * pixelRatio`.
 *    Множитель повторяет поведение OL Text style (refs/ol/ol.js около 8841):
 *    textScale = pixelRatio * scale; без него на retina-устройстве текст
 *    выходит в `pixelRatio` раз меньше эквивалентного OL Text.
 *
 * 2. `ctx.fillText`/`ctx.strokeText` - counter-based filter:
 *    - Считает порядок вызовов и сопоставляет с predicted-queue (см.
 *      `predictTextQueue`).
 *    - Если text-вызов соответствует slot 2 (центр) - пропускается. Наш
 *      overlay-слой рисует значение этого канала сам с adaptive шрифтом и
 *      theme-цветами.
 *    - Иначе (slot 0/1, нетипичная конфигурация channel 7/8 в нецентральном
 *      слоте) - pass-through на реальный context с поворот-compensation
 *      (`save -> translate(x,y) -> rotate(-state.rotation) -> translate(-x,-y)
 *      -> orig -> restore`); при rotation=0 - прямой вызов без save/restore.
 *
 *    Counter работает потому, что native LIGHT всегда выпускает text парой
 *    (strokeText сразу после fillText или наоборот - в коде пара
 *    `ctx.strokeText(value, xc, yc); ctx.fillText(value, xc, yc)` подряд),
 *    а порядок пар детерминирован по `for (i=0..2)` в renderer'е.
 *
 * 3. Все прочие методы и поля (fillStyle, strokeStyle, beginPath, arc,
 *    stroke и т.д.) - проброс на реальный context. Native рисует кольца,
 *    арки, прогресс-бары как обычно.
 *
 * `idsAtWrapTime` - снапшот `map-config.h` на момент wrap-а, синхронизирован
 * с `ids` в closure native LIGHT-стиля (игра передаёт его в FeatureStyles.LIGHT
 * при drawEntities; refs/game/script.js около 3194). Если игрок изменит
 * Layers > Text picker позже, native LIGHT не пересобирается до следующего
 * `requestEntities`, поэтому frozen ids в closure остаются - и `idsAtWrapTime`
 * остаётся синхронным с фактической последовательностью text-вызовов.
 * predictTextQueue использует тот же snapshot.
 */
export function wrapLightRenderer(original: RendererFn, getZoom: () => number): WrappedRenderer {
  const idsAtWrapTime = readMapConfigH();

  const wrapped: WrappedRenderer = (coordinates, state) => {
    const realCtx = state.context;
    const rotation = state.rotation ?? 0;
    const pixelRatio = state.pixelRatio ?? 1;
    const fontPx = Math.round(fontSizeForZoom(getZoom()) * pixelRatio);

    let queue: IPredictedTextItem[] = [];
    const feature = state.feature;
    if (feature && typeof feature.get === 'function') {
      const highlight: unknown = feature.get('highlight');
      if (Array.isArray(highlight)) {
        queue = predictTextQueue(idsAtWrapTime, highlight);
      }
    }

    let textCallCounter = 0;

    const proxyCtx = new Proxy(realCtx, {
      set(target, prop, value: unknown): boolean {
        if (prop === 'font' && typeof value === 'string') {
          value = value.replace(/\d+px/, `${String(fontPx)}px`);
        }
        Reflect.set(target, prop, value);
        return true;
      },
      get(target, prop): unknown {
        if (prop === 'fillText' || prop === 'strokeText') {
          return (text: string, x: number, y: number, maxWidth?: number): void => {
            const pairIdx = Math.floor(textCallCounter / 2);
            textCallCounter++;

            if (pairIdx < queue.length && queue[pairIdx].slot === 2) return;

            if (rotation !== 0) {
              target.save();
              target.translate(x, y);
              target.rotate(-rotation);
              target.translate(-x, -y);
              if (prop === 'fillText') target.fillText(text, x, y, maxWidth);
              else target.strokeText(text, x, y, maxWidth);
              target.restore();
            } else if (prop === 'fillText') {
              target.fillText(text, x, y, maxWidth);
            } else {
              target.strokeText(text, x, y, maxWidth);
            }
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
 *
 * После установки обёртки вызываем feature.changed(): style.setRenderer()
 * мутирует функцию рендера in-place, но НЕ диспатчит change-event
 * (refs/ol/ol.js около 6842, setRenderer присваивает renderer_ без changed()).
 * Layer кеширует execution plan по revision counter feature; без явного
 * changed() новый renderer не попадает в plan до внешнего trigger'а.
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
 * WeakMap wrapped -> original). После этого следующий рендер выдаёт
 * нативный 46px-текст и нативный текст центрального канала снова появится.
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

// ── Overlay-слой: рисует значение выбранного канала ──────────────────────────

/**
 * Считает суммарное количество ключей на каждой точке из inventory-cache.
 * Используется только когда slot 2 выбранного канала = References (7),
 * иначе значения берутся из feature.get('highlight').
 */
export function buildRefCounts(): Map<string, number> {
  const refs = readInventoryReferences();
  const counts = new Map<string, number>();
  for (const ref of refs) {
    counts.set(ref.l, (counts.get(ref.l) ?? 0) + ref.a);
  }
  return counts;
}

/**
 * Возвращает текст для overlay-label данной точки в зависимости от того,
 * какой канал игрок выбрал в slot 2 Layers > Text picker. Логика
 * соответствует нативному LIGHT renderer-у на refs/game/script.js около
 * 316-383 в is_text-ветке: case 5 рисует любое определённое value (включая
 * 0); case 6 пропускает 0; case 7 берёт значение из inventory-cache (мы
 * читаем точно тот же агрегат, что отображал бы native, но обновляем сразу
 * после изменения инвентаря); case 8 пропускает -1.
 */
export function computeLabelText(
  feature: IOlFeature,
  slot2Channel: TextChannel,
  refCounts: Map<string, number> | null,
): string | null {
  if (slot2Channel === REFS_CHANNEL) {
    const id = feature.getId();
    if (typeof id !== 'string' || !refCounts) return null;
    const count = refCounts.get(id) ?? 0;
    if (count <= 0) return null;
    return String(count);
  }

  if (typeof feature.get !== 'function') return null;
  const highlight: unknown = feature.get('highlight');
  if (!Array.isArray(highlight)) return null;
  const value: unknown = highlight[slot2Channel];

  if (slot2Channel === 5) {
    if (typeof value !== 'number') return null;
    return String(value);
  }
  if (slot2Channel === 6) {
    if (typeof value !== 'number' || value === 0) return null;
    return String(value);
  }
  // slot2Channel === 8
  if (typeof value !== 'number' || value === -1) return null;
  return String(value);
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

  const slot2 = getCenterChannel(readMapConfigH());
  if (!isTextChannel(slot2)) return;

  const refCounts = slot2 === REFS_CHANNEL ? buildRefCounts() : null;

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
    const text = computeLabelText(feature, slot2, refCounts);
    if (text === null) continue;
    const coords = feature.getGeometry().getCoordinates();
    const label = new OlFeature({ geometry: new OlPoint(coords) });
    label.setId(id + ':svp-pt-label');
    label.setStyle(
      new OlStyle({
        text: new OlText({
          font,
          text,
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
    en: 'Adaptive font for the point text label selected in Layers > Text. The label stays horizontal regardless of map rotation. For the References channel the count is read from your inventory and updates immediately.',
    ru: 'Адаптивный размер шрифта для текста подсветки точек, выбранного в Layers > Text. Подпись не вращается вместе с картой. Для канала ключей значение берётся из инвентаря и обновляется сразу.',
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

    for (const feature of src.getFeatures()) {
      wrapFeature(feature, getZoom);
    }
    onAddFeature = (...args: unknown[]): void => {
      const event = args[0];
      if (typeof event !== 'object' || event === null) return;
      if (!('feature' in event)) return;
      const candidate = event.feature;
      if (typeof candidate !== 'object' || candidate === null) return;
      wrapFeature(candidate as IOlFeature, getZoom);
    };
    src.on('addfeature', onAddFeature);

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
