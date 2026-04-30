import type { IFeatureModule } from '../../core/moduleRegistry';
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

// ── refs channel sync (бaгфикс «после discover не обновляется текст») ────────

// Канал references в маске Text-слоя. Совпадает с option value="7" в
// refs/game/index.html:289 и case 7 в FeatureStyles.LIGHT renderer
// (refs/game/script.js:374-377). Сервер кладёт сюда количество ключей
// игрока на эту точку в момент /api/inview ответа; игра не обновляет
// значение при последующих изменениях инвентаря (discover, удаление,
// recycle), поэтому подпись остаётся stale до следующего drawEntities
// (movemend на >30 м или 5-минутный таймер).
const REFS_CHANNEL_INDEX = 7;
const DISCOVER_URL_PATTERN = /\/api\/discover(\?|$)/;
const REF_ITEM_TYPE = 3;

let discoverFetchInstalled = false;
let originalFetchBeforePatch: typeof window.fetch | null = null;

// ── Диагностика (временная, для отладки бага «refs не обновляются после
// discover»). Вшита в скрипт; после определения root cause - удаляется одним
// коммитом. Тестируется на мобильнике без DevTools: при тапе по кнопке
// discover (в попапе точки) накапливаем checkpoint-данные, через 3 секунды
// показываем alert со сводкой - пользователь делает скриншот.
//
// Триггеры старта diagnostic-сессии: (a) клик по любой кнопке внутри
// `.discover` контейнера попапа (`#discover` и `.discover-mod` - игра
// привязывает doDiscovery к обоим, refs/game/script.js:878-879); (b)
// перехват /api/discover в нашем patchedFetch если сессия ещё не активна
// (страховка на случай если кнопка discover не сработала trigger - например,
// если игра поменяла DOM-структуру). Сессия идёт 3000мс, накапливая данные;
// в конце - alert.

interface IDiagSession {
  triggerSource: string;
  startTimestamp: number;
  fetchEntered: boolean;
  hookActive: boolean | null;
  urlMatched: boolean;
  guid: string | null;
  guidExtractionFailed: boolean;
  bodyPreview: string | null;
  responseStatus: number | null;
  fetchRejectedError: string | null;
  jsonParsed: boolean | null;
  jsonParseError: string | null;
  gain: number | null;
  bodyShape: string | null;
  featureFound: boolean | null;
  pointsSourceMissing: boolean;
  highlightShape: string | null;
  beforeRefs: unknown;
  afterRefs: unknown;
}

let diagSession: IDiagSession | null = null;
let diagSessionTimer: ReturnType<typeof setTimeout> | null = null;
let diagDocumentClickHandler: ((event: Event) => void) | null = null;

function makeEmptySession(triggerSource: string): IDiagSession {
  return {
    triggerSource,
    startTimestamp: Date.now(),
    fetchEntered: false,
    hookActive: null,
    urlMatched: false,
    guid: null,
    guidExtractionFailed: false,
    bodyPreview: null,
    responseStatus: null,
    fetchRejectedError: null,
    jsonParsed: null,
    jsonParseError: null,
    gain: null,
    bodyShape: null,
    featureFound: null,
    pointsSourceMissing: false,
    highlightShape: null,
    beforeRefs: undefined,
    afterRefs: undefined,
  };
}

function startDiagSession(triggerSource: string): void {
  if (diagSession !== null) return;
  diagSession = makeEmptySession(triggerSource);
  diagSessionTimer = setTimeout(showDiagAlert, 3000);
}

function fmt(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return '-';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  // Объекты/массивы маловероятны (мы кладём только примитивы), но JSON.stringify
  // безопаснее чем дефолтный toString '[object Object]'.
  try {
    return JSON.stringify(value);
  } catch {
    return '(unstringifiable)';
  }
}

function showDiagAlert(): void {
  diagSessionTimer = null;
  const session = diagSession;
  diagSession = null;
  if (!session) return;
  const elapsed = Date.now() - session.startTimestamp;
  const lines = [
    `improvedPointText diag (${String(elapsed)}ms)`,
    `trigger: ${session.triggerSource}`,
    `fetchPatched: ${String(discoverFetchInstalled)}`,
    `hookEnabled: ${String(discoverHookEnabled)}`,
    `pointsSourceSet: ${String(pointsSource !== null)}`,
    `--- fetch hook ---`,
    `fetchEntered: ${fmt(session.fetchEntered)}`,
    `urlMatched: ${fmt(session.urlMatched)}`,
    `guid: ${fmt(session.guid) || '(empty)'}`,
    session.guidExtractionFailed ? `guidExtractionFailed, body: ${fmt(session.bodyPreview)}` : null,
    `--- response ---`,
    `respStatus: ${fmt(session.responseStatus)}`,
    session.fetchRejectedError ? `fetchRejected: ${session.fetchRejectedError}` : null,
    `jsonParsed: ${fmt(session.jsonParsed)}`,
    session.jsonParseError ? `jsonErr: ${session.jsonParseError}` : null,
    `bodyShape: ${fmt(session.bodyShape)}`,
    `gain: ${fmt(session.gain)}`,
    `--- feature ---`,
    `featureFound: ${fmt(session.featureFound)}`,
    `highlightShape: ${fmt(session.highlightShape)}`,
    `refs[7]: ${fmt(session.beforeRefs)} -> ${fmt(session.afterRefs)}`,
  ].filter((line): line is string => line !== null);
  // alert блокирует UI - даёт пользователю время сделать скриншот.
  alert(lines.join('\n'));
}

function isDiscoverButtonClick(event: Event): boolean {
  const target = event.target;
  if (!(target instanceof Element)) return false;
  // refs/game/script.js:878-879: doDiscovery привязан к #discover и
  // .discover-mod (внутри #i-discover-actions). Дочерние клики
  // (например, span внутри button) тоже считаем триггером.
  return target.closest('#discover, .discover-mod, .discover button') !== null;
}

function startDiscoverClickListener(): void {
  if (diagDocumentClickHandler) return;
  diagDocumentClickHandler = (event: Event): void => {
    if (!isDiscoverButtonClick(event)) return;
    startDiagSession('discover-click');
  };
  document.addEventListener('click', diagDocumentClickHandler, true);
}

function stopDiscoverClickListener(): void {
  if (!diagDocumentClickHandler) return;
  document.removeEventListener('click', diagDocumentClickHandler, true);
  diagDocumentClickHandler = null;
}

/** Сброс диагностической сессии. Только для тестов. */
export function resetDiagnosticSessionForTest(): void {
  if (diagSessionTimer !== null) {
    clearTimeout(diagSessionTimer);
    diagSessionTimer = null;
  }
  diagSession = null;
  stopDiscoverClickListener();
}

interface IDiscoverLootItem {
  t?: number;
  l?: string;
  a?: number;
}

interface IDiscoverResponseShape {
  response?: {
    loot?: IDiscoverLootItem[];
  };
}

function isDiscoverResponseShape(value: unknown): value is IDiscoverResponseShape {
  return typeof value === 'object' && value !== null;
}

/**
 * Считает суммарный прирост ключей конкретной точки из массива loot ответа
 * /api/discover. В loot могут лежать предметы разных типов; refs - это
 * t === 3, l === guid дискаверенной точки. Игра использует тот же предикат
 * (refs/game/script.js:816 - `cache.find(f => f.t === 3 && f.l === guid)`).
 */
export function computeRefsGainFromDiscover(body: unknown, targetGuid: string): number {
  if (!isDiscoverResponseShape(body)) return 0;
  const loot = body.response?.loot;
  if (!Array.isArray(loot)) return 0;
  let gain = 0;
  for (const item of loot) {
    if (item.t !== REF_ITEM_TYPE) continue;
    if (item.l !== targetGuid) continue;
    if (typeof item.a !== 'number') continue;
    gain += item.a;
  }
  return gain;
}

/**
 * Извлекает guid целевой точки из RequestInit body. /api/discover - POST
 * с JSON-payload `{position, guid, wish}` (refs/game/script.js:797-801).
 * Возвращает null, если body отсутствует, не строка, не парсится или не
 * содержит guid - фолбек на `.info[data-guid]` оставлен в обработчике.
 */
function extractDiscoverGuidFromInit(init: RequestInit | undefined): string | null {
  const body = init?.body;
  if (typeof body !== 'string') return null;
  try {
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed === 'object' && parsed !== null && 'guid' in parsed) {
      const guid = (parsed as { guid: unknown }).guid;
      if (typeof guid === 'string') return guid;
    }
  } catch {
    // невалидный JSON - не наш случай.
  }
  return null;
}

function extractUrl(input: RequestInfo | URL): string | null {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  // Request: у него поле `url: string` в DOM lib; null - страховка для моков
  // в тестах, где может прийти неполный объект без url.
  return typeof input.url === 'string' ? input.url : null;
}

/**
 * Применяет refsGain к feature: in-place мутация массива highlight по
 * индексу REFS_CHANNEL_INDEX. LIGHT-стиль закрыт closure'ом над тем же
 * массивом (refs/game/script.js:269-270, 303), поэтому изменение по
 * reference читается следующим вызовом renderer'а. feature.changed()
 * инвалидирует execution plan layer'а и запускает ререндер.
 *
 * Если highlight отсутствует или не массив - игнорируем: точка
 * нарисована без LIGHT-стиля (или ещё не получила prop через
 * setProperties), наша правка не нужна.
 */
export function applyRefsGainToFeature(feature: IOlFeature, gain: number): void {
  if (gain <= 0) return;
  if (typeof feature.get !== 'function') return;
  const highlight = feature.get('highlight');
  if (!Array.isArray(highlight)) return;
  const current =
    typeof highlight[REFS_CHANNEL_INDEX] === 'number' ? highlight[REFS_CHANNEL_INDEX] : 0;
  highlight[REFS_CHANNEL_INDEX] = current + gain;
  if (typeof feature.changed === 'function') feature.changed();
}

function handleDiscoverResponse(response: Response, targetGuid: string): void {
  if (diagSession) diagSession.responseStatus = response.status;
  if (!response.ok) return;
  if (!pointsSource) {
    if (diagSession) diagSession.pointsSourceMissing = true;
    return;
  }
  response
    .clone()
    .json()
    .then((body: unknown) => {
      if (diagSession) {
        diagSession.jsonParsed = true;
        diagSession.bodyShape =
          typeof body === 'object' && body !== null
            ? Object.keys(body as Record<string, unknown>).join(',')
            : typeof body;
      }
      if (!pointsSource) {
        if (diagSession) diagSession.pointsSourceMissing = true;
        return;
      }
      const gain = computeRefsGainFromDiscover(body, targetGuid);
      if (diagSession) diagSession.gain = gain;
      if (gain <= 0) return;
      const feature =
        typeof pointsSource.getFeatureById === 'function'
          ? pointsSource.getFeatureById(targetGuid)
          : null;
      if (diagSession) diagSession.featureFound = feature !== null;
      if (!feature) return;
      const highlightBefore: unknown = feature.get?.('highlight');
      if (diagSession) {
        diagSession.highlightShape = Array.isArray(highlightBefore)
          ? `array[${String(highlightBefore.length)}]`
          : typeof highlightBefore;
        diagSession.beforeRefs = Array.isArray(highlightBefore)
          ? highlightBefore[REFS_CHANNEL_INDEX]
          : null;
      }
      applyRefsGainToFeature(feature, gain);
      if (diagSession) {
        const highlightAfter: unknown = feature.get?.('highlight');
        diagSession.afterRefs = Array.isArray(highlightAfter)
          ? highlightAfter[REFS_CHANNEL_INDEX]
          : null;
      }
    })
    .catch((error: unknown) => {
      if (diagSession) {
        diagSession.jsonParsed = false;
        diagSession.jsonParseError = error instanceof Error ? error.message : String(error);
      }
    });
}

/**
 * Ставит monkey-patch на window.fetch один раз за жизнь страницы. Перехват
 * пропускает все запросы кроме /api/discover; для них клонирует Response
 * (чтобы не блокировать игру), парсит loot и обновляет refs-канал на
 * целевой feature. Срабатывает только пока модуль enabled - флаг
 * проверяется внутри обработчика.
 */
export function installDiscoverFetchHook(): void {
  if (discoverFetchInstalled) return;
  discoverFetchInstalled = true;
  const originalFetch = window.fetch;
  originalFetchBeforePatch = originalFetch;
  window.fetch = function patchedFetch(
    this: typeof window,
    ...args: Parameters<typeof window.fetch>
  ): Promise<Response> {
    const responsePromise = originalFetch.apply(this, args);
    const url = extractUrl(args[0]);
    const isDiscoverUrl = url !== null && DISCOVER_URL_PATTERN.test(url);
    if (isDiscoverUrl) {
      // Страховочный триггер сессии: если discover-click listener не сработал
      // (например, игра поменяла DOM-структуру кнопки), сессия всё равно
      // запустится при перехвате fetch.
      if (diagSession === null) startDiagSession('fetch-intercept');
      if (diagSession) {
        diagSession.fetchEntered = true;
        diagSession.urlMatched = true;
        diagSession.hookActive = discoverHookEnabled;
      }
    }
    if (!discoverHookEnabled) return responsePromise;
    if (!isDiscoverUrl) return responsePromise;
    const targetGuid = extractDiscoverGuidFromInit(args[1]);
    if (!targetGuid) {
      if (diagSession) {
        diagSession.guidExtractionFailed = true;
        const body = args[1]?.body;
        diagSession.bodyPreview =
          typeof body === 'string' ? body.slice(0, 100) : `(${typeof body})`;
      }
      return responsePromise;
    }
    if (diagSession) diagSession.guid = targetGuid;
    void responsePromise.then(
      (response) => {
        handleDiscoverResponse(response, targetGuid);
      },
      (error: unknown) => {
        if (diagSession) {
          diagSession.fetchRejectedError = error instanceof Error ? error.message : String(error);
        }
      },
    );
    return responsePromise;
  };
}

/** Тестовый сброс глобального fetch-патча. Только для тестов. */
export function uninstallDiscoverFetchHookForTest(): void {
  if (!discoverFetchInstalled) return;
  if (originalFetchBeforePatch) window.fetch = originalFetchBeforePatch;
  originalFetchBeforePatch = null;
  discoverFetchInstalled = false;
}

let discoverHookEnabled = false;

export const improvedPointText: IFeatureModule = {
  id: MODULE_ID,
  name: { en: 'Improved point text', ru: 'Улучшенный текст на точках' },
  description: {
    en: 'Adaptive font for the point text label selected in Layers > Text. The label stays horizontal regardless of map rotation. For the References channel the count updates immediately after discover.',
    ru: 'Адаптивный размер шрифта для текста подсветки точек, выбранного в Layers > Text. Подпись не вращается вместе с картой. Для канала ключей значение обновляется сразу после изучения точки.',
  },
  defaultEnabled: true,
  category: 'map',

  init() {
    // installDiscoverFetchHook раньше вызывался здесь, но это ставило
    // monkey-patch на window.fetch для всех пользователей независимо от того,
    // включён ли модуль. Каждый /api/* запрос проходил через нашу обёртку
    // (внутри она быстро no-op'ит при discoverHookEnabled=false), но это
    // глобальный side-effect, невидимый в DevTools. Переносим установку в
    // enable: если пользователь отключил improvedPointText - патч вообще никогда
    // не появляется. Сам патч после первого enable остаётся жить до конца
    // сессии (повторные enable/disable идемпотентны через discoverFetchInstalled),
    // потому что снятие требует проверить, что между install и uninstall
    // никто не переписал fetch поверх - архитектурно дороже выгод.
  },

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
    // Lazy install: первый enable ставит fetch-patch; повторные no-op через
    // discoverFetchInstalled внутри installDiscoverFetchHook.
    installDiscoverFetchHook();
    discoverHookEnabled = true;
    startDiscoverClickListener();
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
    discoverHookEnabled = false;
    stopDiscoverClickListener();
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
