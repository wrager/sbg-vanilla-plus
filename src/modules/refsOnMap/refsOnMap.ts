import type { IFeatureModule } from '../../core/moduleRegistry';
import { $, injectStyles, removeStyles } from '../../core/dom';
import { t } from '../../core/l10n';
import { getOlMap } from '../../core/olMap';
import type { IOlFeature, IOlMap, IOlLayer, IOlMapEvent, IOlVectorSource } from '../../core/olMap';
import {
  buildLockedPointGuids,
  buildFavoritedPointGuids,
  readFullInventoryReferences,
  readInventoryCache,
  INVENTORY_CACHE_KEY,
} from '../../core/inventoryCache';
import { isInventoryReference } from '../../core/inventoryTypes';
import { getPlayerTeam } from '../../core/playerTeam';
import { syncRefsCountForPoints } from '../../core/refsHighlightSync';
import { getTextColor, getBackgroundColor } from '../../core/themeColors';
import { showToast } from '../../core/toast';
import type { IFeatureClassification } from './classifyFeatures';
import { classifyFeatures } from './classifyFeatures';
import type { OwnTeamMode } from './refsOnMapSettings';
import { loadRefsOnMapSettings, saveRefsOnMapSettings } from './refsOnMapSettings';
import css from './styles.css?inline';

const MODULE_ID = 'refsOnMap';
const REFS_TAB_INDEX = '3';
const GAME_LAYER_NAMES = ['points', 'lines', 'regions'];
const TEAM_BATCH_SIZE = 5;
const TEAM_BATCH_DELAY_MS = 100;
const AMOUNT_ZOOM = 15;
const TITLE_ZOOM = 17;
const TITLE_MAX_LENGTH = 12;
const SELECTED_COLOR = '#BB7100';
// NEUTRAL_COLOR - явный серый для team === null (нейтральная точка, сервер
// вернул te:null). Не зависит от темы - так нейтральные точки в нашем слое
// визуально отличаются от непрогруженных. Для team === undefined читаем
// --team-0 из палитры игры (там #444 на светлой / #CCC на тёмной) - такая
// точка совпадает по цвету с тем, что нативный слой points рисует под
// нашим, пока мы не знаем команду.
const NEUTRAL_COLOR = '#666666';
const INVENTORY_API = '/api/inventory';
const REFS_TAB_TYPE = 3;
const INVIEW_URL_PATTERN = /\/api\/inview(\?|$)/;

// ID элементов из модуля collapsibleTopPanel — связь закреплена явно
const COLLAPSIBLE_TOGGLE_ID = 'svp-top-toggle';
const COLLAPSIBLE_EXPAND_ID = 'svp-top-expand';

// ── team loading ─────────────────────────────────────────────────────────────

interface IPointApiResponse {
  // te: number = команда; null = нейтральная точка (нет владельца); undefined =
  // поле отсутствует (старый формат или ошибочный ответ).
  data?: { te?: number | null };
}

function isPointApiResponse(value: unknown): value is IPointApiResponse {
  return typeof value === 'object' && value !== null;
}

/**
 * Формат ответа /api/inview, выявленный из refs/game/script.js:3167-3253:
 * `response.p[]` — список точек в видимой области, у каждой `g` (guid) и
 * `t` (team). Поле team называется `t`, не `te` как в /api/point.
 */
interface IInviewPoint {
  g?: unknown;
  t?: unknown;
}
interface IInviewResponse {
  p?: IInviewPoint[];
}

function isInviewResponse(value: unknown): value is IInviewResponse {
  return typeof value === 'object' && value !== null;
}

/**
 * Result discriminated union: number (конкретная команда), null (нейтральная
 * точка - сервер ответил `te: null`, у точки нет владельца), 'failed' (fetch
 * упал или формат ответа не распознан). Различать важно: neutral - легитимное
 * состояние, точка не своя и не чужая; failed - реальная проблема загрузки,
 * UI обязан показать unknown-fallback. До разделения оба случая склеивались в
 * null, и neutral-точки попадали в protectedByUnknownTeam при keepOwnTeam=true.
 */
async function fetchPointTeam(pointGuid: string): Promise<number | null | 'failed'> {
  try {
    const response = await fetch(`/api/point?guid=${pointGuid}&status=1`);
    const json: unknown = await response.json();
    if (isPointApiResponse(json)) {
      if (typeof json.data?.te === 'number') return json.data.te;
      if (json.data?.te === null) return null;
    }
  } catch {
    // fall through to 'failed'
  }
  return 'failed';
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

// ── deletion ─────────────────────────────────────────────────────────────────

interface IDeleteApiResponse {
  count?: { total?: number };
  error?: string;
}

function isDeleteApiResponse(value: unknown): value is IDeleteApiResponse {
  return typeof value === 'object' && value !== null;
}

async function deleteRefsFromServer(items: Record<string, number>): Promise<IDeleteApiResponse> {
  // auth-токен передаётся явно, симметрично с inventoryApi.deleteInventoryItems
  // и migrationApi.postMark. Раньше fetch шёл без Authorization-заголовка и
  // полагался на cookie/session, но другие точки удаления уже используют
  // Bearer-токен; согласованность исключает класс ошибок "сервер сменил
  // механизм auth, refsOnMap молча перестал удалять".
  const token = localStorage.getItem('auth');
  if (!token) {
    return { error: 'Auth token not found' };
  }
  const response = await fetch(INVENTORY_API, {
    method: 'DELETE',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ selection: items, tab: REFS_TAB_TYPE }),
  });
  const json: unknown = await response.json();
  if (isDeleteApiResponse(json)) return json;
  return {};
}

/**
 * Синхронизирует inventory-cache после DELETE: полностью удалённые стопки
 * убирает из кэша; частично-удалённые - снижает amount до нового значения.
 * Сервер уже применил изменения; локальный кэш должен отражать факт, чтобы
 * последующий открытый inventory или другой модуль (slowRefsDelete и т.д.)
 * не использовал устаревшие данные.
 */
function removeRefsFromCacheAndUpdate(
  fullyDeletedGuids: Set<string>,
  partialUpdates: Map<string, number>,
): void {
  const raw = localStorage.getItem(INVENTORY_CACHE_KEY);
  if (!raw) return;
  let items: unknown[];
  try {
    items = JSON.parse(raw) as unknown[];
  } catch {
    return;
  }
  if (!Array.isArray(items)) return;
  const updated = items.flatMap<unknown>((item) => {
    if (typeof item !== 'object' || item === null) return [item];
    const record = item as Record<string, unknown>;
    if (record.t !== REFS_TAB_TYPE) return [item];
    if (typeof record.g !== 'string') return [item];
    if (fullyDeletedGuids.has(record.g)) return [];
    const newAmount = partialUpdates.get(record.g);
    if (typeof newAmount === 'number') {
      return [{ ...record, a: newAmount }];
    }
    return [item];
  });
  localStorage.setItem(INVENTORY_CACHE_KEY, JSON.stringify(updated));
}

function updateInventoryCounter(total: number): void {
  const counter = document.getElementById('self-info__inv');
  if (counter) counter.textContent = String(total);
}

// ── module state ─────────────────────────────────────────────────────────────

let olMap: IOlMap | null = null;
let refsSource: IOlVectorSource | null = null;
let refsLayer: IOlLayer | null = null;
let showButton: HTMLButtonElement | null = null;
let closeButton: HTMLButtonElement | null = null;
let trashButton: HTMLButtonElement | null = null;
let cancelButton: HTMLButtonElement | null = null;
// Общий fixed-контейнер в правом нижнем углу для всех viewer-блоков
// (selectionInfo / mode / trash / cancel) - flex column с gap. Поведение:
// каждый блок управляет своей visibility (display: none/'') как раньше,
// общий gap соблюдается даже при свёрнутых элементах за счёт flexbox.
let bottomStack: HTMLDivElement | null = null;
let progressContainer: HTMLDivElement | null = null;
let progressBar: HTMLDivElement | null = null;
let progressCounter: HTMLDivElement | null = null;
let modeContainer: HTMLDivElement | null = null;
let modeRadioDelete: HTMLInputElement | null = null;
let modeRadioKeep: HTMLInputElement | null = null;
let modeRadioKeepOne: HTMLInputElement | null = null;
let modeLabelDelete: HTMLSpanElement | null = null;
let modeLabelKeep: HTMLSpanElement | null = null;
let modeLabelKeepOne: HTMLSpanElement | null = null;
let selectionInfoEl: HTMLDivElement | null = null;
let selectionInfoTotalRow: HTMLDivElement | null = null;
let selectionInfoProtectedRow: HTMLDivElement | null = null;
let selectionInfoOwnRow: HTMLDivElement | null = null;
let selectionInfoUnknownRow: HTMLDivElement | null = null;
let selectionInfoKeepOneRow: HTMLDivElement | null = null;
let selectionInfoToDeleteRow: HTMLDivElement | null = null;
let tabClickHandler: ((event: Event) => void) | null = null;
let mapClickHandler: ((event: IOlMapEvent) => void) | null = null;
let viewMoveHandler: (() => void) | null = null;
let viewerOpen = false;
let beforeOpenZoom: number | undefined;
let beforeOpenRotation: number | undefined;
let beforeOpenFollow: string | null = null;
// Персистентный режим защиты своих ключей при массовом удалении. Сохраняется
// в localStorage (svp_refsOnMap.ownTeamMode), переживает закрытие viewer'а и
// перезагрузку страницы. До первого showViewer хранит дефолт keepOne. Реальное
// значение читается из loadRefsOnMapSettings при открытии viewer.
// Семантика:
// - 'delete'  - удалять все выделенные ключи, включая свои.
// - 'keep'    - не удалять ключи своей команды (полная защита).
// - 'keepOne' - у каждой своей точки оставить 1 ключ (если их больше).
let ownTeamMode: OwnTeamMode = 'keepOne';
/**
/**
 * Кэш команд точек. Ключ - pointGuid. Значения:
 * - `number` - конкретная команда (1..4).
 * - `null` - нейтральная точка: сервер ответил 200 OK с `data.te: null`,
 *   у точки нет владельца (легитимное игровое состояние).
 * - `'failed'` - fetch упал, ответ нераспознан, либо сервер не вернул
 *   ни число, ни null. Реальная проблема загрузки, требует fail-safe защиты.
 *
 * Раньше neutral и failed склеивались в `null`, и нейтральные точки попадали
 * в `protectedByUnknownTeam` при keepOwnTeam=true - пользователь видел "X
 * неизвестного цвета" после полной отработки worker'а и не понимал, почему
 * deletable не растёт. Дискриминация состояний нужна для корректного UI.
 *
 * Запись любого из трёх значений нужна для идемпотентности повторных
 * попыток: `teamCache.has(guid)` skip'ит и успешные, и нейтральные, и
 * провалившиеся, иначе каждый moveend через extent заново ставил бы их в
 * очередь и worker долбил бы /api/point бесконечно.
 *
 * feature.team устанавливается для number и null (neutral - валидное
 * состояние, partitionByLockProtection трактует null как "не своя"). Для
 * 'failed' feature.team остаётся undefined, partitionByLockProtection
 * относит такую точку в protectedByUnknownTeam fail-safe.
 */
const teamCache = new Map<string, number | null | 'failed'>();
let teamLoadAborted = false;
// Пока true - viewer догружает команды точек, выбор по клику и trashButton
// заблокированы. Сбрасывается в false когда очередь fallback /api/point
// выработана или когда viewer закрылся (teamLoadAborted=true).
let teamsLoading = false;
// Очередь fallback /api/point для guid'ов, чью команду /inview не вернул.
// Обрабатывается worker'ом батчами по TEAM_BATCH_SIZE. На современной игре
// (refs/game/script.js v11) /inview всегда отдаёт `t`, очередь остаётся
// пустой; fallback нужен для несовпадающих версий сервера/клиента.
const teamLoadQueue = new Set<string>();
// guid'ы, которые worker уже извлёк из очереди в batch (синхронно через
// teamLoadQueue.delete) и сейчас ожидает их fetchPointTeam в await Promise.all.
// Без отдельного in-flight Set'а enqueueVisibleForLoad на каждом moveend
// видел такой guid как "не в кэше и не в очереди" и добавлял его снова -
// teamLoadTotal++ инкрементировался лишний раз. enqueueVisibleForLoad
// пропускает guid'ы в inFlight симметрично с teamLoadQueue.has.
const teamLoadInFlight = new Set<string>();
let teamLoadInProgress = false;
let teamLoadTotal = 0;
let teamLoadDone = 0;

// ── inview fetch hook ────────────────────────────────────────────────────────

let inviewHookInstalled = false;
let inviewHookEnabled = false;
let originalFetchBeforePatch: typeof window.fetch | null = null;

function extractUrl(input: RequestInfo | URL): string | null {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return typeof input.url === 'string' ? input.url : null;
}

/**
 * Перехватывает игровой /api/inview и забирает из ответа `t` каждой видимой
 * точки. Хук устанавливается один раз за жизнь страницы (как в refsLayerSync);
 * переключение поведения - через `inviewHookEnabled`, чтобы не пересобирать
 * цепочку патчей при каждом enable/disable.
 *
 * `response.clone()` обязателен: игра тоже читает body этого ответа в
 * `drawEntities`, неклонированный read body заблокирует игровой код.
 */
export function installInviewFetchHook(): void {
  if (inviewHookInstalled) return;
  inviewHookInstalled = true;
  const originalFetch = window.fetch;
  originalFetchBeforePatch = originalFetch;
  window.fetch = function patchedFetch(
    this: typeof window,
    ...args: Parameters<typeof window.fetch>
  ): Promise<Response> {
    const responsePromise = originalFetch.apply(this, args);
    if (!inviewHookEnabled) return responsePromise;
    const url = extractUrl(args[0]);
    if (!url || !INVIEW_URL_PATTERN.test(url)) return responsePromise;
    void responsePromise.then(
      async (response) => {
        if (!response.ok) return;
        if (!inviewHookEnabled) return;
        const cloned = response.clone();
        let json: unknown;
        try {
          json = await cloned.json();
        } catch {
          return;
        }
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- inviewHookEnabled может измениться между awaits (hideViewer/disable)
        if (!inviewHookEnabled) return;
        if (!isInviewResponse(json) || !Array.isArray(json.p)) return;
        handleInviewResponse(json.p);
      },
      () => {
        // Сетевой сбой - игра уведомлена через rejection основного промиса.
      },
    );
    return responsePromise;
  };
}

/** Тестовый сброс глобального fetch-патча. Только для тестов. */
export function uninstallInviewFetchHookForTest(): void {
  if (!inviewHookInstalled) return;
  if (originalFetchBeforePatch) window.fetch = originalFetchBeforePatch;
  originalFetchBeforePatch = null;
  inviewHookInstalled = false;
}

/**
 * Обработчик /api/inview ответа: enrichment поверх active pull. Записывает
 * команды из ответа в teamCache и в feature.team всех refs-фич с
 * соответствующим pointGuid. Если guid уже был в очереди worker'а
 * /api/point - удаляем его из очереди (данные получены через /inview
 * быстрее) и инкрементируем teamLoadDone, чтобы прогресс-бар не закончил
 * раньше total.
 *
 * Fallback /api/point для guid'ов с отсутствующим `t` не нужен: active pull
 * (enqueueVisibleForLoad на showViewer + moveend) и так загружает все
 * видимые ref-точки через /api/point, дубль приведёт к race за queue.
 */
function handleInviewResponse(points: IInviewPoint[]): void {
  if (!viewerOpen || !refsSource) return;

  let queueDeleted = 0;
  for (const point of points) {
    if (typeof point.g !== 'string') continue;
    if (typeof point.t !== 'number') continue;
    teamCache.set(point.g, point.t);
    if (teamLoadQueue.has(point.g)) {
      teamLoadQueue.delete(point.g);
      queueDeleted++;
    }
    for (const feature of refsSource.getFeatures()) {
      const properties = feature.getProperties?.() ?? {};
      if (properties.pointGuid === point.g) {
        feature.set?.('team', point.t);
      }
    }
  }

  // /inview "обработал" guid'ы из очереди вместо worker'а - инкрементируем
  // teamLoadDone, чтобы прогресс-бар не закончил раньше total. Без этого
  // worker экзит при queue.size===0 с done<total, applyTeamsLoadedState
  // скрывает прогресс на "10 из 100".
  if (queueDeleted > 0) {
    teamLoadDone += queueDeleted;
    if (teamLoadTotal > 0) updateProgress(teamLoadDone, teamLoadTotal);
    if (!teamLoadInProgress && teamLoadQueue.size === 0 && teamsLoading) {
      applyTeamsLoadedState();
    }
  }
}

// ── visible-only active pull ─────────────────────────────────────────────────

function getMapExtent(): number[] | null {
  if (!olMap) return null;
  const size = olMap.getSize();
  if (!size) return null;
  const view = olMap.getView();
  const extent = view.calculateExtent(size);
  if (!Array.isArray(extent) || extent.length < 4) return null;
  return extent;
}

function isCoordinateInExtent(coord: number[], extent: number[]): boolean {
  return (
    coord[0] >= extent[0] && coord[0] <= extent[2] && coord[1] >= extent[1] && coord[1] <= extent[3]
  );
}

/**
 * GUID'ы видимых на текущем extent точек. Один pointGuid может приходиться
 * на несколько ref-фич (стопок одной точки), поэтому Set.
 */
function getVisiblePointGuids(): Set<string> {
  const extent = getMapExtent();
  if (!extent || !refsSource) return new Set();
  const visible = new Set<string>();
  for (const feature of refsSource.getFeatures()) {
    const properties = feature.getProperties?.() ?? {};
    const pointGuid = typeof properties.pointGuid === 'string' ? properties.pointGuid : null;
    if (!pointGuid) continue;
    if (visible.has(pointGuid)) continue;
    const geom = feature.getGeometry();
    const coord = geom.getCoordinates();
    if (Array.isArray(coord) && coord.length >= 2 && isCoordinateInExtent(coord, extent)) {
      visible.add(pointGuid);
    }
  }
  return visible;
}

/**
 * Active pull: догружает команды видимых ref-точек через /api/point worker.
 * /inview-перехват работает параллельно как enrichment - его ответ удаляет
 * guid из очереди, worker такие guid'ы пропускает. Без active pull точки за
 * пределами того extent'а, по которому игра последний раз дёргала /inview,
 * остаются с team=undefined; игра дёргает /inview только при moveend, до
 * первого moveend (или для не-видимых регионов) данных нет.
 *
 * Вызывается из showViewer (первичный extent) и из viewMoveHandler (на
 * каждый moveend - новые видимые точки попадают в очередь).
 */
function enqueueVisibleForLoad(): void {
  if (!viewerOpen) return;
  const visible = getVisiblePointGuids();
  let added = 0;
  for (const guid of visible) {
    if (teamCache.has(guid)) continue;
    if (teamLoadQueue.has(guid)) continue;
    if (teamLoadInFlight.has(guid)) continue;
    teamLoadQueue.add(guid);
    teamLoadTotal++;
    added++;
  }
  if (added > 0) {
    teamsLoading = true;
    showProgress(teamLoadTotal);
    updateProgress(teamLoadDone, teamLoadTotal);
    updateSelectionUi();
    if (!teamLoadInProgress) {
      void runTeamLoadWorker();
    }
  }
}

// ── style function ───────────────────────────────────────────────────────────

function expandHexColor(color: string): string {
  const match = /^#([0-9a-fA-F])([0-9a-fA-F])([0-9a-fA-F])$/.exec(color);
  if (match) return `#${match[1]}${match[1]}${match[2]}${match[2]}${match[3]}${match[3]}`;
  return color;
}

export function getTeamColor(team: number | null | undefined): string {
  if (team === null) return NEUTRAL_COLOR;
  // undefined -> --team-0 (нейтральный цвет палитры игры): пока команда не
  // загружена, наш слой совпадает по тону с нативным points под ним.
  // number -> --team-N.
  const teamIndex = team === undefined ? 0 : team;
  const property = `--team-${teamIndex}`;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(property).trim();
  return raw ? expandHexColor(raw) : NEUTRAL_COLOR;
}

/**
 * Цвет команды игрока как прилагательное мн.ч. (для подстановки в UI).
 * SBG-команды фиксированы в refs/game/css/variables.css: --team-1 красный,
 * --team-2 зелёный, --team-3 синий. Возвращает null, если getPlayerTeam()
 * не извлёкся (#self-info__name пустой / другой формат / выход из аккаунта) -
 * вызывающий обязан использовать fallback-формулировку без цвета.
 */
function getPlayerTeamColorName(): { en: string; ru: string; ruGen: string } | null {
  switch (getPlayerTeam()) {
    case 1:
      return { en: 'red', ru: 'красные', ruGen: 'красных' };
    case 2:
      return { en: 'green', ru: 'зелёные', ruGen: 'зелёных' };
    case 3:
      return { en: 'blue', ru: 'синие', ruGen: 'синих' };
    default:
      return null;
  }
}

function getModeLabelDelete(): { en: string; ru: string } {
  const color = getPlayerTeamColorName();
  if (color === null) return { en: 'Delete own team', ru: 'Удалять свои' };
  return { en: `Delete ${color.en}`, ru: `Удалять ${color.ru}` };
}

function getModeLabelKeep(): { en: string; ru: string } {
  const color = getPlayerTeamColorName();
  if (color === null) return { en: 'Keep own team', ru: 'Не удалять свои' };
  return { en: `Keep ${color.en}`, ru: `Не удалять ${color.ru}` };
}

function getModeLabelKeepOne(): { en: string; ru: string } {
  const color = getPlayerTeamColorName();
  if (color === null) {
    return { en: 'Keep 1 key of own team', ru: 'Оставлять 1 ключ для своих' };
  }
  return {
    en: `Keep 1 key of ${color.en}`,
    ru: `Оставлять 1 ключ для ${color.ruGen}`,
  };
}

function getOwnRowText(points: number, keys: number): { en: string; ru: string } {
  const color = getPlayerTeamColorName();
  if (color === null) {
    return {
      en: `${points} (${keys} keys) own team and unprotected, won't be deleted`,
      ru: `${points} (${keys} ключей) своего цвета и незащищённые, но не удалятся`,
    };
  }
  return {
    en: `${points} (${keys} keys) ${color.en} and unprotected, won't be deleted`,
    ru: `${points} (${keys} ключей) ${color.ru} и незащищённые, но не удалятся`,
  };
}

// SVG path'ы из Lucide (https://lucide.dev): lock + star. ViewBox 0..24.
// Цвета фиксированы: белая заливка + чёрный outline 1.5px - такая иконка
// читается на любом фоне точки (зелёный team-цвет, серый neutral,
// оранжевый selected). Симметрично с текстом amount, у которого тот же
// приём (fill white + stroke black width 3).
const LOCK_ICON_SVG_PATH =
  '<rect x="3" y="11" width="18" height="11" rx="2" fill="white" stroke="black" stroke-width="1.5"/>' +
  '<path d="M7 11V7a5 5 0 0 1 10 0v4" fill="none" stroke="black" stroke-width="1.5"/>';
const STAR_ICON_SVG_PATH =
  '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" fill="white" stroke="black" stroke-width="1.5"/>';

// SVG имеет явный width/height (24x24), чтобы у браузера не было сомнений
// в естественном размере. Без size-атрибутов SVG-data-URL в OL Icon
// измеряется в 0px и иконка не рисуется. imgSize в OlIcon - legacy-вариант
// сообщить OL размер для масштабирования; работает в любой версии OL,
// в отличие от width/height (Available since OL 6.5).
const ICON_NATURAL_SIZE = 24;
const ICON_DISPLAY_SIZE = 18;

function buildIconDataUrl(path: string): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" ` +
    `width="${ICON_NATURAL_SIZE}" height="${ICON_NATURAL_SIZE}" ` +
    `viewBox="0 0 ${ICON_NATURAL_SIZE} ${ICON_NATURAL_SIZE}">${path}</svg>`;
  return 'data:image/svg+xml;base64,' + btoa(svg);
}

function createLayerStyleFunction(): (feature: IOlFeature) => unknown[] {
  return (feature: IOlFeature) => {
    const olStyle = window.ol?.style;
    if (!olStyle?.Style || !olStyle.Text || !olStyle.Fill || !olStyle.Stroke || !olStyle.Circle) {
      return [];
    }
    const {
      Style: OlStyle,
      Text: OlText,
      Fill: OlFill,
      Stroke: OlStroke,
      Circle: OlCircle,
      Icon: OlIcon,
    } = olStyle;

    const properties = feature.getProperties?.() ?? {};
    const amount = typeof properties.amount === 'number' ? properties.amount : 0;
    const title = typeof properties.title === 'string' ? properties.title : '';
    const team: number | null | undefined =
      typeof properties.team === 'number'
        ? properties.team
        : properties.team === null
          ? null
          : undefined;
    const isSelected = properties.isSelected === true;
    const isLocked = properties.isLocked === true;
    const isFavorited = properties.isFavorited === true;
    const deletionState =
      typeof properties.deletionState === 'string' ? properties.deletionState : '';
    const toDelete = typeof properties.toDelete === 'number' ? properties.toDelete : 0;
    const toSurvive = typeof properties.toSurvive === 'number' ? properties.toSurvive : 0;
    // Выделенная точка, у которой по итогу удаления НЕ уйдёт ни одного
    // ключа: locked/own/unknown-защищена либо keepOne-полностью защищена
    // (правило не позволило обрезать). Для них fill полностью прозрачный -
    // только обводка выделения держит индикацию "selected", оранжевый под
    // заливкой не намекает на "к удалению".
    const willNotBeDeleted =
      isSelected &&
      (deletionState === 'lockedProtected' ||
        deletionState === 'ownProtected' ||
        deletionState === 'unknownProtected' ||
        (deletionState === 'keepOneTrimmed' && toDelete === 0));
    // Item 6b: текст "=1" для выделенных, у которых правило keepOne после
    // удаления оставит ровно 1 ключ (deletion=keepOneTrimmed и toSurvive=1).
    const showOneSurvived = isSelected && deletionState === 'keepOneTrimmed' && toSurvive === 1;

    const zoom = olMap?.getView().getZoom?.() ?? 0;
    const teamColor = getTeamColor(team);
    const baseRadius = zoom >= 16 ? 10 : 8;
    const radius = isSelected ? baseRadius * 1.4 : baseRadius;

    // CUI style: transparent fill + colored stroke. Выделенный кружок,
    // который реально пойдёт в удаление - fill полупрозрачный SELECTED_COLOR
    // (alpha 50%, видно "к удалению"). Выделенный защищённый (не пойдёт
    // в payload) - fill полностью прозрачный: только обводка держит
    // индикацию selected-state, оранжевый не намекает на удаление.
    const selectedFillAlpha = willNotBeDeleted ? '00' : '80';
    const fillColor = isSelected ? SELECTED_COLOR + selectedFillAlpha : teamColor + '40';
    const strokeColor = isSelected ? SELECTED_COLOR : teamColor;
    const strokeWidth = isSelected ? 4 : 3;

    const textColor = getTextColor();
    const backgroundColor = getBackgroundColor();

    const styles: unknown[] = [
      new OlStyle({
        image: new OlCircle({
          radius,
          fill: new OlFill({ color: fillColor }),
          stroke: new OlStroke({ color: strokeColor, width: strokeWidth }),
        }),
        zIndex: isSelected ? 3 : 1,
      }),
    ];

    // Item 6b: один слот в центре точки. Приоритет:
    // 1. lock + favorited - обе иконки, каждая alpha 50% (наложены).
    // 2. lock - только замок (alpha 100%).
    // 3. favorited - только звезда (alpha 100%).
    // 4. =1 (для выделенных с keepOneTrimmed+toSurvive=1) - текст =1.
    // 5. amount (zoom >= AMOUNT_ZOOM) - текущее поведение.
    if (isLocked && isFavorited && OlIcon) {
      styles.push(
        new OlStyle({
          image: new OlIcon({
            src: buildIconDataUrl(LOCK_ICON_SVG_PATH),
            imgSize: [ICON_NATURAL_SIZE, ICON_NATURAL_SIZE],
            scale: ICON_DISPLAY_SIZE / ICON_NATURAL_SIZE,
            opacity: 0.5,
          }),
          zIndex: 4,
        }),
        new OlStyle({
          image: new OlIcon({
            src: buildIconDataUrl(STAR_ICON_SVG_PATH),
            imgSize: [ICON_NATURAL_SIZE, ICON_NATURAL_SIZE],
            scale: ICON_DISPLAY_SIZE / ICON_NATURAL_SIZE,
            opacity: 0.5,
          }),
          zIndex: 4,
        }),
      );
    } else if (isLocked && OlIcon) {
      styles.push(
        new OlStyle({
          image: new OlIcon({
            src: buildIconDataUrl(LOCK_ICON_SVG_PATH),
            imgSize: [ICON_NATURAL_SIZE, ICON_NATURAL_SIZE],
            scale: ICON_DISPLAY_SIZE / ICON_NATURAL_SIZE,
          }),
          zIndex: 4,
        }),
      );
    } else if (isFavorited && OlIcon) {
      styles.push(
        new OlStyle({
          image: new OlIcon({
            src: buildIconDataUrl(STAR_ICON_SVG_PATH),
            imgSize: [ICON_NATURAL_SIZE, ICON_NATURAL_SIZE],
            scale: ICON_DISPLAY_SIZE / ICON_NATURAL_SIZE,
          }),
          zIndex: 4,
        }),
      );
    } else if (showOneSurvived) {
      styles.push(
        new OlStyle({
          text: new OlText({
            font: `${zoom >= 15 ? 14 : 12}px Manrope`,
            text: '=1',
            fill: new OlFill({ color: textColor }),
            stroke: new OlStroke({ color: backgroundColor, width: 3 }),
          }),
          // Выше круга выделения (zIndex=3) - "=1" остаётся читаемым поверх
          // оранжевого fill, не теряется под ним.
          zIndex: 4,
        }),
      );
    } else if (zoom >= AMOUNT_ZOOM) {
      // amount показывается на крупных масштабах ВСЕГДА, когда центральный
      // слот не занят иконкой/"=1". Раньше скрывался для выделенных в режиме
      // keep, но пользователь видит на крупных масштабах ожидание полного
      // числа ключей на точке - amount информативен независимо от mode.
      styles.push(
        new OlStyle({
          text: new OlText({
            font: `${zoom >= 15 ? 14 : 12}px Manrope`,
            text: String(amount),
            fill: new OlFill({ color: textColor }),
            stroke: new OlStroke({ color: backgroundColor, width: 3 }),
          }),
          zIndex: 2,
        }),
      );
    }

    if (zoom >= TITLE_ZOOM) {
      const displayTitle =
        title.length <= TITLE_MAX_LENGTH
          ? title
          : title.slice(0, TITLE_MAX_LENGTH - 2).trim() + '...';
      styles.push(
        new OlStyle({
          text: new OlText({
            font: '12px Manrope',
            text: displayTitle,
            fill: new OlFill({ color: textColor }),
            stroke: new OlStroke({ color: backgroundColor, width: 3 }),
            offsetY: 18,
            textBaseline: 'top',
          }),
          zIndex: 2,
        }),
      );
    }

    return styles;
  };
}

// ── selection breakdown ──────────────────────────────────────────────────────

interface ISelectionBreakdown {
  selectedPoints: number;
  selectedKeys: number;
  // deletable: точки, по которым в DELETE-payload >0 ключей. deletableKeys -
  // сумма payload (фактическое число удаляемых ключей). Учитывает keepOneKey.
  deletablePoints: number;
  deletableKeys: number;
  lockPoints: number;
  lockKeys: number;
  ownPoints: number;
  ownKeys: number;
  unknownPoints: number;
  unknownKeys: number;
  // keepOneKey: точки, у которых правило "Оставлять 1 ключ" сохранило хотя
  // бы 1 ключ (полностью защищена + частично удалена). keepOneKeyKeys -
  // сумма этих сохранённых ключей.
  keepOneKeyPoints: number;
  keepOneKeyKeys: number;
}

const EMPTY_BREAKDOWN: ISelectionBreakdown = {
  selectedPoints: 0,
  selectedKeys: 0,
  deletablePoints: 0,
  deletableKeys: 0,
  lockPoints: 0,
  lockKeys: 0,
  ownPoints: 0,
  ownKeys: 0,
  unknownPoints: 0,
  unknownKeys: 0,
  keepOneKeyPoints: 0,
  keepOneKeyKeys: 0,
};

function getPointGuid(feature: IOlFeature): string | null {
  const properties = feature.getProperties?.() ?? {};
  return typeof properties.pointGuid === 'string' ? properties.pointGuid : null;
}

function uniquePointCount(features: IOlFeature[]): number {
  const set = new Set<string>();
  for (const feature of features) {
    const guid = getPointGuid(feature);
    if (guid !== null) set.add(guid);
  }
  return set.size;
}

/**
 * true если среди выбранных есть хоть одна точка, чья команда сейчас
 * загружается (guid в teamLoadQueue или teamLoadInFlight). Используется
 * для решения, надо ли блокировать trashButton при keepOwnTeam: общая
 * фоновая загрузка для невыбранных точек удалению не мешает - lock
 * защищается через inventory-cache.f, а фильтр свои читает team только
 * у выбранных. Заменяет старую проверку global teamsLoading, которая
 * блокировала кнопку при любой фоновой загрузке.
 */
function hasSelectedPointsLoadingTeam(): boolean {
  if (!refsSource) return false;
  for (const feature of refsSource.getFeatures()) {
    const properties = feature.getProperties?.() ?? {};
    if (properties.isSelected !== true) continue;
    const guid = typeof properties.pointGuid === 'string' ? properties.pointGuid : null;
    if (guid === null) continue;
    if (teamLoadQueue.has(guid) || teamLoadInFlight.has(guid)) return true;
  }
  return false;
}

/**
 * Per-feature разбивка текущего selection'а через classifyFeatures - единый
 * источник правды, общий с handleDeleteClick. UI всегда показывает реальный
 * исход кнопки (что попадёт в DELETE-payload, что защищено).
 *
 * Defensive case: ownTeamMode='keep'|'keepOne' И playerTeam=null -
 * handleDeleteClick блокирует удаление тостом. classifyFeatures сам возвращает
 * для team=undefined -> unknownProtected при protective-mode; для team=number
 * (своя) при playerTeam=null соответствие не определяется -> fullyDeletable.
 * В этом состоянии UI показывает deletable>0 для своих, но handleDeleteClick
 * блокирует - это компромисс: иначе пользователь видит "0 ключей" и не
 * понимает, почему DELETE заблокирован. Текст тоста-блокировки явный.
 */
function computeSelectionBreakdown(): ISelectionBreakdown {
  if (!refsSource) return EMPTY_BREAKDOWN;
  const selected = refsSource.getFeatures().filter((feature) => {
    const properties = feature.getProperties?.();
    return properties !== undefined && properties.isSelected === true;
  });
  if (selected.length === 0) return EMPTY_BREAKDOWN;

  const { classifications, lockBucket, ownBucket, unknownBucket, keepOneBucket, payload } =
    classifySelection(selected);

  let deletableKeysFinal = 0;
  const pointsInPayload = new Set<string>();
  for (const [feature, deleteAmount] of payload) {
    deletableKeysFinal += deleteAmount;
    const guid = getPointGuid(feature);
    if (guid !== null) pointsInPayload.add(guid);
  }
  // keepOneKeyKeys считается per-feature: сумма toSurvive у всех фич, чья
  // классификация keepOneTrimmed (включая защищённые точки с 1 ключом и
  // частично удалённые стопки, где toSurvive=1).
  let keepOneKeyKeysFinal = 0;
  const keepOneKeyPointGuids = new Set<string>();
  for (const feature of keepOneBucket) {
    const cls = classifications.get(feature);
    if (!cls) continue;
    keepOneKeyKeysFinal += cls.toSurvive;
    const guid = getPointGuid(feature);
    if (guid !== null) keepOneKeyPointGuids.add(guid);
  }
  return {
    selectedPoints: uniquePointCount(selected),
    selectedKeys: sumAmount(selected),
    deletablePoints: pointsInPayload.size,
    deletableKeys: deletableKeysFinal,
    lockPoints: uniquePointCount(lockBucket),
    lockKeys: sumAmount(lockBucket),
    ownPoints: uniquePointCount(ownBucket),
    ownKeys: sumAmount(ownBucket),
    unknownPoints: uniquePointCount(unknownBucket),
    unknownKeys: sumAmount(unknownBucket),
    keepOneKeyPoints: keepOneKeyPointGuids.size,
    keepOneKeyKeys: keepOneKeyKeysFinal,
  };
}

/**
 * Обновляет UI выбора: текст кнопки удаления (deletable ключи / точки),
 * блок-инфо рядом (сводка + breakdown по bucket'ам), видимость radio-блока.
 * Вызывается при каждом изменении selection, при смене ownTeamMode и после
 * успешного delete (когда часть features удалена).
 */
// updateSelectionUi вызывается из team-load worker после каждого batch'а
// /api/point. Содержимое UI при этом часто НЕ меняется (selection-info
// зависит от selectedPoints/Keys, кнопка trash - тоже). Запись одних и тех
// же значений в DOM на каждом batch'е - лишний reflow и сброс текстового
// выделения пользователя. Эти хелперы пишут только при фактическом
// отличии текущего значения от нового.
function setTextIfChanged(el: HTMLElement | null, text: string): void {
  if (el && el.textContent !== text) el.textContent = text;
}
function setStylePropIfChanged(
  el: HTMLElement | null,
  prop: 'display' | 'visibility',
  value: string,
): void {
  if (el && el.style[prop] !== value) el.style[prop] = value;
}
function setBoolPropIfChanged(el: HTMLButtonElement | null, value: boolean): void {
  if (el && el.disabled !== value) el.disabled = value;
}
function setDataLoadingIfChanged(el: HTMLElement | null, value: string): void {
  if (el && el.dataset.loading !== value) el.dataset.loading = value;
}

function updateSelectionUi(): void {
  // Перед чтением UI-сводки прокидываем актуальную классификацию на сами
  // фичи - стилевая функция читает isLocked/isFavorited/deletionState
  // через feature.get() и рисует иконки/=1/alpha. Один путь обновления
  // правды для UI-сводки и для карты.
  refreshFeatureClassifications();
  const breakdown = computeSelectionBreakdown();
  const hasSelection = breakdown.selectedPoints > 0;
  const protectiveMode = ownTeamMode === 'keep' || ownTeamMode === 'keepOne';

  if (trashButton) {
    const trashLabel = trashButton.querySelector<HTMLSpanElement>('.svp-refs-on-map-trash-label');
    setTextIfChanged(
      trashLabel,
      hasSelection
        ? t({
            en: `${breakdown.deletablePoints} (${breakdown.deletableKeys} keys)`,
            ru: `${breakdown.deletablePoints} (${breakdown.deletableKeys} ключей)`,
          })
        : '',
    );
    setStylePropIfChanged(trashButton, 'visibility', hasSelection ? 'visible' : 'hidden');
    const isLoading = protectiveMode && hasSelectedPointsLoadingTeam();
    const nothingToDelete = breakdown.deletableKeys === 0;
    setBoolPropIfChanged(trashButton, isLoading || nothingToDelete);
    setDataLoadingIfChanged(trashButton, isLoading ? 'true' : 'false');
  }

  // Radio-блок mode показывается только при наличии выбора - до выбора
  // пользовательские фильтры не имеют смысла, лишний UI-шум.
  setStylePropIfChanged(modeContainer, 'display', viewerOpen && hasSelection ? '' : 'none');

  // Кнопка "Отменить" снимает выделение всех точек. Видна только при
  // наличии выбора - симметрично с trashButton.
  setStylePropIfChanged(cancelButton, 'visibility', hasSelection ? 'visible' : 'hidden');

  setStylePropIfChanged(selectionInfoEl, 'display', hasSelection ? '' : 'none');
  if (hasSelection) {
    // "Из них:" - только когда после total идёт хотя бы одна под-строка
    // (lock / own / unknown / keepOne). Иначе total оканчивается точкой
    // без продолжения, чтобы не висел сирота-двоеточие в UI.
    const hasAnySubrow =
      breakdown.lockPoints > 0 ||
      (protectiveMode && breakdown.ownPoints > 0) ||
      (protectiveMode && breakdown.unknownPoints > 0) ||
      (ownTeamMode === 'keepOne' && breakdown.keepOneKeyPoints > 0);
    setTextIfChanged(
      selectionInfoTotalRow,
      hasAnySubrow
        ? t({
            en: `Selected: ${breakdown.selectedPoints} (${breakdown.selectedKeys} keys). Of them:`,
            ru: `Выделено: ${breakdown.selectedPoints} (${breakdown.selectedKeys} ключей). Из них:`,
          })
        : t({
            en: `Selected: ${breakdown.selectedPoints} (${breakdown.selectedKeys} keys)`,
            ru: `Выделено: ${breakdown.selectedPoints} (${breakdown.selectedKeys} ключей)`,
          }),
    );
    if (selectionInfoProtectedRow) {
      const showLock = breakdown.lockPoints > 0;
      setStylePropIfChanged(selectionInfoProtectedRow, 'display', showLock ? '' : 'none');
      if (showLock) {
        setTextIfChanged(
          selectionInfoProtectedRow,
          t({
            en: `${breakdown.lockPoints} (${breakdown.lockKeys} keys) protected`,
            ru: `${breakdown.lockPoints} (${breakdown.lockKeys} ключей) защищено`,
          }),
        );
      }
    }
    if (selectionInfoOwnRow) {
      const showOwn = protectiveMode && breakdown.ownPoints > 0;
      setStylePropIfChanged(selectionInfoOwnRow, 'display', showOwn ? '' : 'none');
      if (showOwn) {
        setTextIfChanged(
          selectionInfoOwnRow,
          t(getOwnRowText(breakdown.ownPoints, breakdown.ownKeys)),
        );
      }
    }
    if (selectionInfoUnknownRow) {
      const showUnknown = protectiveMode && breakdown.unknownPoints > 0;
      setStylePropIfChanged(selectionInfoUnknownRow, 'display', showUnknown ? '' : 'none');
      if (showUnknown) {
        setTextIfChanged(
          selectionInfoUnknownRow,
          t({
            en: `${breakdown.unknownPoints} (${breakdown.unknownKeys} keys) unknown team`,
            ru: `${breakdown.unknownPoints} (${breakdown.unknownKeys} ключей) неизвестного цвета`,
          }),
        );
      }
    }
    if (selectionInfoKeepOneRow) {
      const showKeepOne = ownTeamMode === 'keepOne' && breakdown.keepOneKeyPoints > 0;
      setStylePropIfChanged(selectionInfoKeepOneRow, 'display', showKeepOne ? '' : 'none');
      if (showKeepOne) {
        setTextIfChanged(
          selectionInfoKeepOneRow,
          t({
            en: `${breakdown.keepOneKeyKeys} last key(s) will stay`,
            ru: `${breakdown.keepOneKeyKeys} последних ключей останутся`,
          }),
        );
      }
    }
    setTextIfChanged(
      selectionInfoToDeleteRow,
      t({
        en: `To delete: ${breakdown.deletablePoints} (${breakdown.deletableKeys} keys)`,
        ru: `К удалению: ${breakdown.deletablePoints} (${breakdown.deletableKeys} ключей)`,
      }),
    );
  }
}

function updateProgress(done: number, total: number): void {
  if (!progressBar || !progressCounter) return;
  const percent = total === 0 ? 100 : Math.round((done / total) * 100);
  progressBar.style.width = `${percent}%`;
  progressCounter.textContent = `${done} / ${total}`;
}

function showProgress(total: number): void {
  if (!progressContainer) return;
  progressContainer.style.display = total > 0 ? '' : 'none';
  updateProgress(0, total);
}

function hideProgress(): void {
  if (!progressContainer) return;
  progressContainer.style.display = 'none';
}

/**
 * Снимает блокировки, поставленные на момент догрузки команд: trashButton
 * становится active (если есть выбор), прогресс-бар скрывается, mapClick
 * начинает работать. Сбрасывает total/done в 0 - следующий fallback из
 * handleInviewResponse стартует с чистого счётчика.
 */
function applyTeamsLoadedState(): void {
  teamsLoading = false;
  hideProgress();
  updateSelectionUi();
  teamLoadTotal = 0;
  teamLoadDone = 0;
}

function requestTeamLoadForFeatureIfNeeded(feature: IOlFeature): void {
  const properties = feature.getProperties?.() ?? {};
  const pointGuid = typeof properties.pointGuid === 'string' ? properties.pointGuid : null;
  if (pointGuid === null) return;
  const teamIsLoaded = typeof properties.team === 'number' || properties.team === null;
  if (!teamIsLoaded) requestTeamLoad(pointGuid);
}

/**
 * Ставит pointGuid в teamLoadQueue если команда ещё не известна, не в
 * очереди и не в-полёте. Запускает worker если он не крутится. Общая
 * точка между active pull по visible-extent (enqueueVisibleForLoad) и
 * selection-driven загрузкой (toggleFeatureSelection).
 */
function requestTeamLoad(pointGuid: string): void {
  if (teamCache.has(pointGuid)) return;
  if (teamLoadQueue.has(pointGuid)) return;
  if (teamLoadInFlight.has(pointGuid)) return;
  teamLoadQueue.add(pointGuid);
  teamLoadTotal++;
  teamsLoading = true;
  showProgress(teamLoadTotal);
  updateProgress(teamLoadDone, teamLoadTotal);
  if (!teamLoadInProgress) {
    void runTeamLoadWorker();
  }
}

function clearSelection(): void {
  if (!refsSource) return;
  for (const feature of refsSource.getFeatures()) {
    const properties = feature.getProperties?.() ?? {};
    if (properties.isSelected === true) {
      feature.set?.('isSelected', false);
    }
  }
  updateSelectionUi();
}

function handleMapClick(event: IOlMapEvent): void {
  if (!olMap?.forEachFeatureAtPixel) return;
  // Item 1: при перекрытии точек под пикселем клик ВЫБИРАЕТ все, никогда
  // не снимает. Раньше каждая фича toggle'илась независимо, и две
  // перекрывающихся точки переключались "в разные стороны". Снять
  // выделение можно только Cancel-кнопкой (clearSelection).
  //
  // Клик-выбор работает при любом mode: при keep/keepOne выбранная точка
  // с team=undefined попадёт в unknownProtected (fail-safe), удаление её
  // защитит. При delete фильтра нет - team не нужен для payload.
  // Блокировка по teamsLoading ушла из selection в trashButton.
  const underPixel: IOlFeature[] = [];
  olMap.forEachFeatureAtPixel(
    event.pixel,
    (feature: IOlFeature) => {
      underPixel.push(feature);
    },
    {
      layerFilter: (layer: IOlLayer) => layer.get('name') === 'svp-refs-on-map',
    },
  );
  if (underPixel.length === 0) return;
  let changed = false;
  for (const feature of underPixel) {
    const properties = feature.getProperties?.() ?? {};
    if (properties.isSelected === true) continue;
    feature.set?.('isSelected', true);
    requestTeamLoadForFeatureIfNeeded(feature);
    changed = true;
  }
  if (changed) updateSelectionUi();
}

// ── deletion UI ──────────────────────────────────────────────────────────────

/**
 * Удаление ключей разрешено, только если ВСЕ реф-стопки в кэше имеют поле
 * `f`. На 0.6.0 поле отсутствует целиком - `buildLockedPointGuids` возвращает
 * пустой Set и locked-семантики нет. На mix-кэше (часть стопок с `f`, часть
 * без) `buildLockedPointGuids` пропускает стопки без `f` (`if (item.f ===
 * undefined) continue`), и точка по факту locked не попала бы в защищённые -
 * её ключи могли быть удалены вслепую. `every` исключает этот класс ошибок
 * целиком, симметрично с `cleanupCalculator`, `slowRefsDelete` и финальным
 * guard'ом в `inventoryApi.deleteInventoryItems`.
 */
export function isLockSupportAvailable(cache: readonly unknown[]): boolean {
  const refStacks = cache.filter(isInventoryReference);
  if (refStacks.length === 0) return false;
  return refStacks.every((item) => item.f !== undefined);
}

function sumAmount(features: IOlFeature[]): number {
  let total = 0;
  for (const feature of features) {
    const properties = feature.getProperties?.() ?? {};
    if (typeof properties.amount === 'number') total += properties.amount;
  }
  return total;
}

/**
 * Собирает контекст для classifyFeatures из текущего состояния модуля. Один
 * чтение inventory-cache на вызов: lockedSet/favoritedSet/inventoryTotals
 * строятся из общего массива стопок, чтобы сэкономить на повторных JSON.parse.
 */
function buildClassificationContext(): {
  mode: OwnTeamMode;
  playerTeam: number | null;
  lockedPointGuids: ReadonlySet<string>;
  favoritedPointGuids: ReadonlySet<string>;
  inventoryTotals: ReadonlyMap<string, number>;
} {
  const cache = readInventoryCache();
  const lockedPointGuids = buildLockedPointGuids(cache);
  const favoritedPointGuids = buildFavoritedPointGuids(cache);
  const inventoryTotals = new Map<string, number>();
  for (const item of cache) {
    if (!isInventoryReference(item)) continue;
    inventoryTotals.set(item.l, (inventoryTotals.get(item.l) ?? 0) + item.a);
  }
  return {
    mode: ownTeamMode,
    playerTeam: getPlayerTeam(),
    lockedPointGuids,
    favoritedPointGuids,
    inventoryTotals,
  };
}

/**
 * Применяет classifyFeatures ко ВСЕМ фичам refsSource и пишет результат в
 * properties каждой фичи: isLocked / isFavorited / deletionState /
 * toSurvive. Стилевая функция OL читает эти свойства и рисует иконку
 * замка / звезды / цифру "=1" / alpha-варианты выделения.
 *
 * Перерисовка фич триггерится через refsSource.changed() - OL обходит все
 * features и зовёт style function с новыми properties.
 *
 * Вызывается при: смене selection (handleMapClick / clearSelection), смене
 * mode (radio onChange), обновлении inventory-cache (после успешного DELETE
 * через removeRefsFromCacheAndUpdate). Один путь обновления = один источник
 * правды, см. секцию "Единая классификация фичи" в плане.
 */
function refreshFeatureClassifications(): void {
  if (!refsSource) return;
  const allFeatures = refsSource.getFeatures();
  const context = buildClassificationContext();
  const classifications = classifyFeatures(allFeatures, context);
  for (const feature of allFeatures) {
    const cls = classifications.get(feature);
    if (!cls) continue;
    feature.set?.('isLocked', cls.isLocked);
    feature.set?.('isFavorited', cls.isFavorited);
    feature.set?.('deletionState', cls.deletion);
    feature.set?.('toDelete', cls.toDelete);
    feature.set?.('toSurvive', cls.toSurvive);
  }
  refsSource.changed?.();
}

/**
 * Собирает payload, bucket'ы для тоста/сводки и классификации фич за один
 * проход classifyFeatures. Вызывается из computeSelectionBreakdown и
 * handleDeleteClick - возвращает единое представление, на основе которого
 * строятся ВСЕ зависимые UI-выводы (счётчики, тост, иконки), чтобы исключить
 * рассинхрон между «что вижу в сводке» / «что удалится» / «что нарисовано».
 */
function classifySelection(selected: IOlFeature[]): {
  classifications: Map<IOlFeature, IFeatureClassification>;
  lockBucket: IOlFeature[];
  ownBucket: IOlFeature[];
  unknownBucket: IOlFeature[];
  keepOneBucket: IOlFeature[];
  payload: Map<IOlFeature, number>;
} {
  const context = buildClassificationContext();
  const classifications = classifyFeatures(selected, context);
  const lockBucket: IOlFeature[] = [];
  const ownBucket: IOlFeature[] = [];
  const unknownBucket: IOlFeature[] = [];
  const keepOneBucket: IOlFeature[] = [];
  const payload = new Map<IOlFeature, number>();
  for (const feature of selected) {
    const cls = classifications.get(feature);
    if (!cls) continue;
    switch (cls.deletion) {
      case 'lockedProtected':
        lockBucket.push(feature);
        break;
      case 'ownProtected':
        ownBucket.push(feature);
        break;
      case 'unknownProtected':
        unknownBucket.push(feature);
        break;
      case 'keepOneTrimmed':
        keepOneBucket.push(feature);
        if (cls.toDelete > 0) payload.set(feature, cls.toDelete);
        break;
      case 'fullyDeletable':
        if (cls.toDelete > 0) payload.set(feature, cls.toDelete);
        break;
      case 'nothingToDelete':
        break;
    }
  }
  return { classifications, lockBucket, ownBucket, unknownBucket, keepOneBucket, payload };
}

async function handleDeleteClick(): Promise<void> {
  if (!refsSource) return;
  const selected = refsSource.getFeatures().filter((feature) => {
    const properties = feature.getProperties?.();
    return properties !== undefined && properties.isSelected === true;
  });
  if (selected.length === 0) return;

  const protectiveMode = ownTeamMode === 'keep' || ownTeamMode === 'keepOne';

  // Дополнительный guard поверх UI-блокировки: если по любой причине клик
  // прошёл во время загрузки команды для одной из выбранных точек И при
  // protective-mode - удаление запрещено, потому что фильтр свои читает
  // feature.team у selected, и до резолва точка с team=undefined могла бы
  // попасть в payload. Фоновая загрузка для невыбранных не блокирует.
  if (protectiveMode && hasSelectedPointsLoadingTeam()) {
    showToast(
      t({
        en: 'Loading team data, please wait',
        ru: 'Загружаются данные о командах, подождите',
      }),
    );
    return;
  }

  // Защита mix-кэша: если хоть одна реф-стопка без поля `f`, нельзя
  // полагаться на нативный lock - стопки без `f` не попадут в
  // lockedPointGuids и точки по факту locked могут быть удалены вслепую.
  // Симметрично с slowRefsDelete и cleanupCalculator. На 0.6.0 (нет `f`
  // целиком) удаление через viewer тоже блокируется - пользователь не
  // должен лишиться ключей из-за того что версия игры не поддерживает lock.
  if (!isLockSupportAvailable(readInventoryCache())) {
    showToast(
      t({
        en: 'Native lock support unavailable: server returned no f-flags. Deletion blocked.',
        ru: 'Нативный lock недоступен (сервер не отдал поле f). Удаление заблокировано.',
      }),
    );
    return;
  }

  // При protective-mode и playerTeam=null - жёсткий блок: режим заявлен
  // пользователем, выполнить его мы не можем (не знаем свою команду),
  // удалять без фильтра нельзя - это нарушение явного намерения.
  if (protectiveMode && getPlayerTeam() === null) {
    showToast(
      t({
        en: 'Cannot determine player team. Deletion blocked (switch to "Delete" mode to proceed).',
        ru: 'Не удалось определить команду игрока. Удаление заблокировано (переключите режим на "Удалять", чтобы продолжить).',
      }),
    );
    return;
  }

  // Единый источник: классификатор делит выделение на bucket'ы lock / own /
  // unknown / keepOne и собирает DELETE-payload. UI-сводка уже использует
  // тот же путь, поэтому "что вижу" = "что удалится".
  const { lockBucket, ownBucket, unknownBucket, keepOneBucket, payload } =
    classifySelection(selected);

  if (payload.size === 0) {
    // Нечего удалять: все защищены. Один информативный тост перечислением
    // категорий, не отдельные для каждой - см. Item 3.
    showToast(buildAllProtectedToast(lockBucket, ownBucket, unknownBucket, keepOneBucket));
    return;
  }

  const pointsInPayload = new Set<string>();
  let overallToDelete = 0;
  for (const [feature, deleteAmount] of payload) {
    overallToDelete += deleteAmount;
    const guid = getPointGuid(feature);
    if (guid !== null) pointsInPayload.add(guid);
  }
  const message = t({
    en: `Delete ${overallToDelete} ref(s) from ${pointsInPayload.size} point(s)?`,
    ru: `Удалить ${overallToDelete} ключ(ей) от ${pointsInPayload.size} точ(ек)?`,
  });

  if (!confirm(message)) return;

  // items: refGuid -> deleteAmount. Для частично-удалённых стопок (payload
  // < amount) сервер обновит amount, а не удалит item. removeRefsFromCache
  // ниже синхронизирует локальный кэш аналогично.
  const items: Record<string, number> = {};
  const fullyDeletedGuids = new Set<string>();
  const partialUpdates = new Map<string, number>();
  for (const [feature, deleteAmount] of payload) {
    const id = feature.getId();
    const amount = (feature.getProperties?.() ?? {}).amount;
    if (typeof id !== 'string' || typeof amount !== 'number') continue;
    items[id] = deleteAmount;
    if (deleteAmount >= amount) {
      fullyDeletedGuids.add(id);
    } else {
      partialUpdates.set(id, amount - deleteAmount);
    }
  }

  try {
    const response = await deleteRefsFromServer(items);
    if (response.error) {
      console.error(`[SVP] ${MODULE_ID}: deletion error:`, response.error);
      // Сервер вернул ошибку - НИЧЕГО не удалилось. Показываем тост с
      // только error-строкой, deleted-часть = 0.
      showToast(buildPostDeleteToast(0, 0, overallToDelete, pointsInPayload.size));
      return;
    }

    // Полностью удалённые фичи убираем из source; частично-удалённые
    // обновляем amount.
    for (const [feature, deleteAmount] of payload) {
      const amount = (feature.getProperties?.() ?? {}).amount;
      if (typeof amount !== 'number') continue;
      if (deleteAmount >= amount) {
        refsSource.removeFeature?.(feature);
      } else {
        feature.set?.('amount', amount - deleteAmount);
      }
    }

    // Item 2: после успешного удаления снимаем isSelected у ВСЕХ оставшихся
    // в source фич (защищённые точки видны, но больше не выделены - готовы
    // к новому циклу выбора).
    for (const feature of refsSource.getFeatures()) {
      if ((feature.getProperties?.() ?? {}).isSelected === true) {
        feature.set?.('isSelected', false);
      }
    }

    // Update local cache: полностью удалённые стопки убираются, частично
    // обновлённые - меняют amount.
    removeRefsFromCacheAndUpdate(fullyDeletedGuids, partialUpdates);

    // Sync счётчика ключей на подписи затронутых точек на основной карте.
    const affectedPointGuids = Array.from(pointsInPayload);
    if (affectedPointGuids.length > 0) {
      void syncRefsCountForPoints(affectedPointGuids);
    }

    if (typeof response.count?.total === 'number') {
      updateInventoryCounter(response.count.total);
    }

    showToast(buildPostDeleteToast(overallToDelete, pointsInPayload.size, 0, 0));

    updateSelectionUi();
  } catch (error) {
    console.error(`[SVP] ${MODULE_ID}: deletion failed:`, error);
    showToast(buildPostDeleteToast(0, 0, overallToDelete, pointsInPayload.size));
  }
}

/**
 * Тост по итогу удаления. Сервер возвращает либо 200 OK на весь запрос,
 * либо ошибку - частичного успеха не бывает, поэтому failed либо 0 (тогда
 * deletedKeys=всё), либо =overallToDelete (тогда deletedKeys=0). Один из
 * двух текстов: успех или ошибка - без двухстрочного смешения.
 */
function buildPostDeleteToast(
  deletedKeys: number,
  deletedPoints: number,
  failedKeys: number,
  failedPoints: number,
): string {
  if (failedKeys === 0) {
    return t({
      en: `${deletedKeys} key(s) from ${deletedPoints} point(s) deleted successfully.`,
      ru: `${deletedKeys} ключ(ей) от ${deletedPoints} точ(ек) успешно удалены.`,
    });
  }
  return t({
    en: `⚠️ Failed to delete ${failedKeys} key(s) from ${failedPoints} point(s)`,
    ru: `⚠️ Ошибка удаления ${failedKeys} ключ(ей) от ${failedPoints} точ(ек)`,
  });
}

/**
 * Текст тоста "все выбранные защищены": честно отражает категории защиты.
 * Только одна категория - конкретный текст; смешанные - перечисление
 * количеств. Цель - пользователь видит почему ничего не удалилось и какое
 * действие предпринять.
 */
function buildAllProtectedToast(
  protectedByLock: IOlFeature[],
  protectedByOwnTeam: IOlFeature[],
  protectedByUnknownTeam: IOlFeature[],
  protectedByKeepOne: IOlFeature[],
): string {
  const lockN = protectedByLock.length;
  const ownN = protectedByOwnTeam.length;
  const unknownN = protectedByUnknownTeam.length;
  const keepOneN = protectedByKeepOne.length;
  const totalN = lockN + ownN + unknownN + keepOneN;
  const onlyLock = lockN === totalN && lockN > 0;
  const onlyOwn = ownN === totalN && ownN > 0;
  const onlyUnknown = unknownN === totalN && unknownN > 0;
  const onlyKeepOne = keepOneN === totalN && keepOneN > 0;
  if (onlyLock) {
    return t({
      en: 'All selected keys belong to locked points and cannot be deleted',
      ru: 'Все выбранные ключи относятся к locked-точкам и не могут быть удалены',
    });
  }
  if (onlyOwn) {
    return t({
      en: 'All selected keys belong to your team and were kept',
      ru: 'Все выбранные ключи - свои, оставлены',
    });
  }
  if (onlyUnknown) {
    return t({
      en: 'All selected keys have unknown team color (try reopening or panning to load colors)',
      ru: 'У всех выбранных ключей не загружен цвет команды (откройте viewer заново или передвиньте карту)',
    });
  }
  if (onlyKeepOne) {
    return t({
      en: 'Keep 1 key kept every selected point intact',
      ru: '"Оставлять 1 ключ" сохранил все выбранные точки',
    });
  }
  // Смешанные категории: перечисление с количествами.
  const parts: string[] = [];
  if (lockN > 0) {
    parts.push(t({ en: `lock: ${lockN}`, ru: `locked: ${lockN}` }));
  }
  if (ownN > 0) {
    parts.push(t({ en: `own team: ${ownN}`, ru: `свои: ${ownN}` }));
  }
  if (unknownN > 0) {
    parts.push(t({ en: `unknown color: ${unknownN}`, ru: `цвет не загружен: ${unknownN}` }));
  }
  if (keepOneN > 0) {
    parts.push(t({ en: `keep 1 key: ${keepOneN}`, ru: `оставлять 1 ключ: ${keepOneN}` }));
  }
  const breakdown = parts.join(', ');
  return t({
    en: `All selected keys are protected (${breakdown}) and cannot be deleted`,
    ru: `Все выбранные ключи защищены (${breakdown}) и не могут быть удалены`,
  });
}

// ── fallback team loading worker ─────────────────────────────────────────────

/**
 * Worker очереди fallback /api/point. Берёт по TEAM_BATCH_SIZE из очереди,
 * запрашивает /api/point параллельно, пишет результат в teamCache и в
 * feature.team. Между батчами ждёт TEAM_BATCH_DELAY_MS чтобы не задавить
 * сервер. На abort (hideViewer) прерывается, applyTeamsLoadedState не
 * вызывается - hideViewer сам очистит state.
 *
 * Очередь заполняется только из handleInviewResponse для guid'ов, чью
 * команду /inview не вернул (рассогласование версий сервер/клиент). На
 * современной игре worker фактически не запускается.
 */
async function runTeamLoadWorker(): Promise<void> {
  if (teamLoadInProgress) return;
  teamLoadInProgress = true;

  while (teamLoadQueue.size > 0 && !teamLoadAborted) {
    const batch: string[] = [];
    for (const guid of teamLoadQueue) {
      batch.push(guid);
      teamLoadQueue.delete(guid);
      // guid в-полёте до завершения Promise.all - enqueueVisibleForLoad
      // не должен добавить его повторно.
      teamLoadInFlight.add(guid);
      if (batch.length >= TEAM_BATCH_SIZE) break;
    }
    const results = await Promise.all(
      batch.map(async (pointGuid) => {
        // Double-check teamCache: между извлечением guid'а из очереди и
        // fetch'ем /inview-hook мог уже принести команду этой точки.
        // Перепрос /api/point был бы лишней нагрузкой и race за write
        // в teamCache. См. README - active pull + /inview enrichment.
        const cached = teamCache.get(pointGuid);
        if (cached !== undefined) return { pointGuid, team: cached };
        const team = await fetchPointTeam(pointGuid);
        return { pointGuid, team };
      }),
    );
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- checked between awaits, hideViewer мог выставить
    if (teamLoadAborted) break;
    for (const { pointGuid, team } of results) {
      // Пишем результат в teamCache ВСЕГДА - и number, и null (neutral), и
      // 'failed'. teamCache.has(guid) skip'ит и успешные, и нейтральные, и
      // провалившиеся - иначе каждый moveend через extent заново ставил бы
      // их в очередь, и worker долбил бы /api/point бесконечно.
      teamCache.set(pointGuid, team);
      teamLoadInFlight.delete(pointGuid);
      // feature.team устанавливается для number и null (neutral - валидный
      // ответ "у точки нет владельца"). Для 'failed' оставляем undefined,
      // чтобы partitionByLockProtection отнёс точку в protectedByUnknownTeam.
      if (team !== 'failed' && refsSource) {
        for (const feature of refsSource.getFeatures()) {
          const properties = feature.getProperties?.() ?? {};
          if (properties.pointGuid === pointGuid) {
            feature.set?.('team', team);
          }
        }
      }
      teamLoadDone++;
    }
    updateProgress(teamLoadDone, teamLoadTotal);
    // Trash.disabled зависит от teamLoadQueue/teamLoadInFlight для selected
    // точек. После batch'а guid'ы выбранных точек могут уйти из in-flight -
    // надо переоценить состояние кнопки, не дожидаясь следующего toggle.
    updateSelectionUi();
    if (teamLoadQueue.size > 0) await delay(TEAM_BATCH_DELAY_MS);
  }

  teamLoadInProgress = false;
  if (!teamLoadAborted && teamLoadQueue.size === 0) {
    applyTeamsLoadedState();
  }
}

function resetTeamLoadState(): void {
  teamLoadQueue.clear();
  teamLoadInFlight.clear();
  teamLoadTotal = 0;
  teamLoadDone = 0;
  teamLoadInProgress = false;
}

// ── game state management ────────────────────────────────────────────────────

function setGameLayersVisible(visible: boolean): void {
  if (!olMap) return;
  for (const layer of olMap.getLayers().getArray()) {
    const name = layer.get('name');
    if (typeof name === 'string' && GAME_LAYER_NAMES.some((n) => name.startsWith(n))) {
      layer.setVisible?.(visible);
    }
  }
}

function disableFollowMode(): void {
  localStorage.setItem('follow', 'false');
  const checkbox = document.querySelector('#toggle-follow');
  if (checkbox instanceof HTMLInputElement) checkbox.checked = false;
}

function restoreFollowMode(): void {
  if (beforeOpenFollow === null || beforeOpenFollow === 'false') return;
  localStorage.setItem('follow', beforeOpenFollow);
  const checkbox = document.querySelector('#toggle-follow');
  if (checkbox instanceof HTMLInputElement) checkbox.checked = true;
  beforeOpenFollow = null;
}

function hideGameUi(): void {
  const inventory = $('.inventory');
  if (inventory instanceof HTMLElement) inventory.classList.add('hidden');

  const bottomContainer = $('.bottom-container');
  if (bottomContainer instanceof HTMLElement) bottomContainer.style.display = 'none';

  const topLeft = $('.topleft-container');
  if (topLeft instanceof HTMLElement) topLeft.style.display = 'none';

  const toggle = document.getElementById(COLLAPSIBLE_TOGGLE_ID);
  if (toggle instanceof HTMLElement) toggle.style.display = 'none';

  const expand = document.getElementById(COLLAPSIBLE_EXPAND_ID);
  if (expand instanceof HTMLElement) expand.style.display = 'none';

  const layers = document.getElementById('layers');
  if (layers instanceof HTMLElement) layers.style.display = 'none';
}

function restoreGameUi(): void {
  const bottomContainer = $('.bottom-container');
  if (bottomContainer instanceof HTMLElement) bottomContainer.style.display = '';

  const topLeft = $('.topleft-container');
  if (topLeft instanceof HTMLElement) topLeft.style.display = '';

  const toggle = document.getElementById(COLLAPSIBLE_TOGGLE_ID);
  if (toggle instanceof HTMLElement) toggle.style.display = '';

  const expand = document.getElementById(COLLAPSIBLE_EXPAND_ID);
  if (expand instanceof HTMLElement) expand.style.display = '';

  const layers = document.getElementById('layers');
  if (layers instanceof HTMLElement) layers.style.display = '';
}

// ── viewer ───────────────────────────────────────────────────────────────────

function showViewer(): void {
  if (viewerOpen || !olMap || !refsSource) return;

  const refs = readFullInventoryReferences();
  if (refs.length === 0) return;

  const ol = window.ol;
  const OlFeature = ol?.Feature;
  const OlPoint = ol?.geom?.Point;
  const olProj = ol?.proj;
  if (!OlFeature || !OlPoint || !olProj?.fromLonLat) return;

  viewerOpen = true;
  // Загружаем ownTeamMode из localStorage. Radio ниже получают .checked перед
  // показом - пользователь видит свой выбор из прошлой сессии. По умолчанию
  // 'keepOne' (см. refsOnMapSettings).
  ownTeamMode = loadRefsOnMapSettings().ownTeamMode;
  const view = olMap.getView();
  beforeOpenZoom = view.getZoom?.();
  beforeOpenRotation = view.getRotation();
  beforeOpenFollow = localStorage.getItem('follow');

  disableFollowMode();
  view.setRotation(0);
  hideGameUi();
  setGameLayersVisible(false);

  // Create one feature per ref (not per point)
  for (const ref of refs) {
    const mapCoords = olProj.fromLonLat(ref.c);
    const feature = new OlFeature({ geometry: new OlPoint(mapCoords) });
    feature.setId(ref.g);
    feature.set?.('amount', ref.a);
    feature.set?.('title', ref.ti);
    feature.set?.('pointGuid', ref.l);
    feature.set?.('isSelected', false);

    // teamCache хранит number | null (neutral) | 'failed'. Для number и null
    // ставим feature.team; для 'failed' и missing - оставляем undefined,
    // partitionByLockProtection отнесёт точку в protectedByUnknownTeam fail-safe.
    const cachedTeam = teamCache.get(ref.l);
    if (typeof cachedTeam === 'number' || cachedTeam === null) {
      feature.set?.('team', cachedTeam);
    }

    refsSource.addFeature(feature);
  }

  teamLoadAborted = false;
  resetTeamLoadState();
  // Команды грузятся через перехват /api/inview, который игра дёрнет при
  // ближайшем moveend (или уже дёрнула - команды попали в teamCache). Очередь
  // fallback /api/point пуста - teamsLoading=false с самого старта; если
  // /inview не вернёт `t` для каких-то точек, handleInviewResponse поднимет
  // teamsLoading=true и покажет прогресс-бар.
  teamsLoading = false;
  if (closeButton) closeButton.style.display = '';
  if (trashButton) {
    trashButton.style.visibility = 'hidden';
    trashButton.style.display = '';
    trashButton.disabled = false;
  }
  if (cancelButton) {
    cancelButton.style.visibility = 'hidden';
    cancelButton.style.display = '';
  }
  // Тексты radio-меток зависят от цвета команды игрока. Перечитываем при
  // каждом showViewer: между сессиями команда могла измениться.
  if (modeLabelDelete) modeLabelDelete.textContent = t(getModeLabelDelete());
  if (modeLabelKeep) modeLabelKeep.textContent = t(getModeLabelKeep());
  if (modeLabelKeepOne) modeLabelKeepOne.textContent = t(getModeLabelKeepOne());
  if (modeRadioDelete) modeRadioDelete.checked = ownTeamMode === 'delete';
  if (modeRadioKeep) modeRadioKeep.checked = ownTeamMode === 'keep';
  if (modeRadioKeepOne) modeRadioKeepOne.checked = ownTeamMode === 'keepOne';
  if (modeContainer) modeContainer.style.display = 'none';
  hideProgress();

  // Включаем перехват /api/inview только пока viewer открыт. Перехватчик
  // ставится один раз за page lifetime в enable(); тут только переключаем
  // флаг inviewHookEnabled.
  inviewHookEnabled = true;

  mapClickHandler = handleMapClick;
  olMap.on?.('click', mapClickHandler);

  // Active pull для видимых точек: /inview ловит игровые ответы пассивно,
  // но игра дёргает /inview только на moveend, и /inview возвращает лишь
  // текущий extent. Точки за пределами активного extent остаются без
  // team. Запускаем worker на первичный extent и подписываемся на moveend.
  //
  // ВАЖНО: в OL `moveend` - событие Map, не View. View поддерживает только
  // `change:*`-события (center, resolution, rotation), а map-level moveend
  // fires когда движение карты завершено. Игра подписывается так же
  // (refs/game/script.js: map.on('moveend', requestEntities)).
  enqueueVisibleForLoad();
  viewMoveHandler = (): void => {
    enqueueVisibleForLoad();
  };
  olMap.on?.('moveend', viewMoveHandler);
}

function hideViewer(): void {
  if (!viewerOpen) return;
  viewerOpen = false;
  teamLoadAborted = true;
  teamsLoading = false;
  inviewHookEnabled = false;
  // ownTeamMode НЕ сбрасываем: настройка персистентна, следующий showViewer
  // перечитает её через loadRefsOnMapSettings.
  hideProgress();
  resetTeamLoadState();

  if (olMap && mapClickHandler) {
    olMap.un?.('click', mapClickHandler);
    mapClickHandler = null;
  }

  if (olMap && viewMoveHandler) {
    olMap.un?.('moveend', viewMoveHandler);
    viewMoveHandler = null;
  }

  // refsSource.clear() удаляет все features - breakdown станет пуст,
  // updateSelectionUi спрячет trashButton/selectionInfo через hasSelection=0.
  refsSource?.clear();
  updateSelectionUi();

  setGameLayersVisible(true);
  restoreGameUi();

  if (closeButton) closeButton.style.display = 'none';
  if (trashButton) trashButton.style.display = 'none';
  if (cancelButton) cancelButton.style.display = 'none';
  if (selectionInfoEl) selectionInfoEl.style.display = 'none';
  if (modeContainer) modeContainer.style.display = 'none';
  // .checked у radio НЕ сбрасываем: настройка персистентна, следующий
  // showViewer всё равно перепишет из loadRefsOnMapSettings.

  const view = olMap?.getView();
  if (view) {
    if (beforeOpenZoom !== undefined) {
      view.setZoom?.(beforeOpenZoom);
      beforeOpenZoom = undefined;
    }
    if (beforeOpenRotation !== undefined) {
      view.setRotation(beforeOpenRotation);
      beforeOpenRotation = undefined;
    }
  }

  restoreFollowMode();
}

// ── tab visibility ───────────────────────────────────────────────────────────

function updateButtonVisibility(): void {
  if (!showButton) return;
  const activeTab = $('.inventory__tab.active');
  const tabIndex = activeTab instanceof HTMLElement ? activeTab.dataset.tab : null;
  showButton.style.display = tabIndex === REFS_TAB_INDEX ? '' : 'none';
}

// ── module ───────────────────────────────────────────────────────────────────

export const refsOnMap: IFeatureModule = {
  id: MODULE_ID,
  name: { en: 'Refs on map', ru: 'Ключи на карте' },
  description: {
    en: 'View and manage points with collected keys on the map at any zoom level. Keys of points marked with the native SBG lock are protected.',
    ru: 'Просмотр и управление точками с ключами на карте на любом масштабе. Ключи точек, помеченных нативным замочком SBG, защищены.',
  },
  defaultEnabled: true,
  category: 'feature',

  init() {},

  enable() {
    injectStyles(css, MODULE_ID);
    installInviewFetchHook();

    return getOlMap().then(
      (map) => {
        try {
          const ol = window.ol;
          const OlVectorSource = ol?.source?.Vector;
          const OlVectorLayer = ol?.layer?.Vector;
          if (!OlVectorSource || !OlVectorLayer) {
            removeStyles(MODULE_ID);
            return;
          }

          olMap = map;
          refsSource = new OlVectorSource();
          refsLayer = new OlVectorLayer({
            // as unknown as: OL Vector constructor accepts a generic options bag;
            // IOlVectorSource cannot be narrowed to Record<string, unknown> without a guard
            source: refsSource as unknown as Record<string, unknown>,
            name: 'svp-refs-on-map',
            zIndex: 8,
            minZoom: 0,
            style: createLayerStyleFunction() as unknown as Record<string, unknown>,
          });
          map.addLayer(refsLayer);

          // "On map" button - вставляется после нативной кнопки #inventory-sort
          // (рядом, чтобы две инвентарные операции жили в одном слоте). Слот
          // около #inventory-delete освобождается под кнопку медленной очистки.
          showButton = document.createElement('button');
          showButton.className = 'svp-refs-on-map-button';
          showButton.textContent = t({ en: 'On map', ru: 'На карте' });
          showButton.addEventListener('click', showViewer);
          showButton.style.display = 'none';

          const inventorySort = $('#inventory-sort');
          if (inventorySort?.parentElement) {
            inventorySort.parentElement.insertBefore(showButton, inventorySort.nextSibling);
          }

          // Track active tab
          tabClickHandler = () => {
            updateButtonVisibility();
          };
          const tabContainer = $('.inventory__tabs');
          if (tabContainer) {
            tabContainer.addEventListener('click', tabClickHandler);
          }

          updateButtonVisibility();

          // Close button — собственный класс, не popup-close, чтобы не триггерить игровой closePopup
          closeButton = document.createElement('button');
          closeButton.className = 'svp-refs-on-map-close';
          closeButton.textContent = '[x]';
          closeButton.style.display = 'none';
          closeButton.addEventListener('click', hideViewer);
          document.body.appendChild(closeButton);

          // Trash/delete button. Структура - icon-default span (эмодзи) +
          // icon-loading span (SVG-спиннер) + label span. Один из icon
          // span'ов видим в зависимости от data-loading атрибута. SVG
          // создаётся один раз, поэтому CSS animation крутится непрерывно
          // (innerHTML на каждом updateSelectionUi пересоздавал бы node и
          // перезапускал бы keyframe).
          // bottomStack создаётся до trash/cancel/mode/selectionInfo и
          // принимает их через appendChild в конце enable - один контейнер
          // в правом нижнем углу с flex-column. Порядок детей фиксируется
          // явным порядком appendChild ниже, а не порядком создания.
          bottomStack = document.createElement('div');
          bottomStack.className = 'svp-refs-on-map-bottom-stack';
          document.body.appendChild(bottomStack);

          trashButton = document.createElement('button');
          trashButton.className = 'svp-refs-on-map-trash';
          trashButton.dataset.loading = 'false';
          trashButton.style.display = 'none';
          trashButton.addEventListener('click', () => {
            void handleDeleteClick();
          });
          const trashIconDefault = document.createElement('span');
          trashIconDefault.className = 'svp-refs-on-map-trash-icon-default';
          trashIconDefault.textContent = '🗑️';
          // Loader span пустой - крутилка рисуется через ::before
          // (border-trick), повторяет нативный лоадер стартового экрана
          // игры: .loading-screen__task.loading::before.
          const trashIconLoading = document.createElement('span');
          trashIconLoading.className = 'svp-refs-on-map-trash-icon-loading';
          const trashLabel = document.createElement('span');
          trashLabel.className = 'svp-refs-on-map-trash-label';
          trashButton.appendChild(trashIconDefault);
          trashButton.appendChild(trashIconLoading);
          trashButton.appendChild(trashLabel);

          // Cancel button - снимает выделение всех выбранных точек. Видна
          // только при наличии выбора (updateSelectionUi).
          cancelButton = document.createElement('button');
          cancelButton.className = 'svp-refs-on-map-cancel';
          cancelButton.textContent = t({ en: 'Cancel', ru: 'Отменить' });
          cancelButton.style.visibility = 'hidden';
          cancelButton.addEventListener('click', clearSelection);

          // Прогресс-бар fallback /api/point: виден пока teamsLoading=true,
          // после полной загрузки скрывается (applyTeamsLoadedState). Пока
          // виден, выбор по клику и trashButton заблокированы - keepOwnTeam
          // фильтру нужны финальные значения `team` у фич.
          progressContainer = document.createElement('div');
          progressContainer.className = 'svp-refs-on-map-progress';
          progressContainer.style.display = 'none';
          const progressLabel = document.createElement('div');
          progressLabel.className = 'svp-refs-on-map-progress-label';
          progressLabel.textContent = t({
            en: 'Loading team data...',
            ru: 'Загрузка данных о командах...',
          });
          progressContainer.appendChild(progressLabel);
          const progressTrack = document.createElement('div');
          progressTrack.className = 'svp-refs-on-map-progress-track';
          progressBar = document.createElement('div');
          progressBar.className = 'svp-refs-on-map-progress-bar';
          progressBar.style.width = '0%';
          progressTrack.appendChild(progressBar);
          progressContainer.appendChild(progressTrack);
          progressCounter = document.createElement('div');
          progressCounter.className = 'svp-refs-on-map-progress-counter';
          progressCounter.textContent = '0 / 0';
          progressContainer.appendChild(progressCounter);
          document.body.appendChild(progressContainer);

          // Radio-блок "Режим защиты своих": 3 варианта (delete / keepOne /
          // keep) в порядке возрастания защиты. State персистентный через
          // localStorage (refsOnMapSettings): showViewer загружает значение,
          // onChange сохраняет. Цвет команды (зелёные/красные/синие) в метках
          // обновляется в showViewer через getModeLabelXxx().
          modeContainer = document.createElement('div');
          modeContainer.className = 'svp-refs-on-map-mode';
          modeContainer.style.display = 'none';
          const modeBuilders: Array<{
            mode: OwnTeamMode;
            ref: (input: HTMLInputElement, label: HTMLSpanElement) => void;
            text: { en: string; ru: string };
          }> = [
            {
              mode: 'delete',
              ref: (input, label) => {
                modeRadioDelete = input;
                modeLabelDelete = label;
              },
              text: getModeLabelDelete(),
            },
            {
              mode: 'keepOne',
              ref: (input, label) => {
                modeRadioKeepOne = input;
                modeLabelKeepOne = label;
              },
              text: getModeLabelKeepOne(),
            },
            {
              mode: 'keep',
              ref: (input, label) => {
                modeRadioKeep = input;
                modeLabelKeep = label;
              },
              text: getModeLabelKeep(),
            },
          ];
          for (const builder of modeBuilders) {
            const optionLabel = document.createElement('label');
            optionLabel.className = `svp-refs-on-map-mode__option svp-refs-on-map-mode__option--${builder.mode}`;
            const input = document.createElement('input');
            input.type = 'radio';
            input.name = 'svp-refs-on-map-mode';
            input.value = builder.mode;
            input.checked = ownTeamMode === builder.mode;
            input.addEventListener('change', () => {
              if (!input.checked) return;
              ownTeamMode = builder.mode;
              saveRefsOnMapSettings({ ownTeamMode });
              updateSelectionUi();
            });
            const textSpan = document.createElement('span');
            textSpan.textContent = t(builder.text);
            optionLabel.appendChild(input);
            optionLabel.appendChild(textSpan);
            modeContainer.appendChild(optionLabel);
            builder.ref(input, textSpan);
          }
          // appendChild к bottomStack делается ниже в нужном порядке.

          // Selection info: до 4 строк - total + protected (lock) + own +
          // unknown (последние две только при keepOwnTeam=true). Каждая
          // строка кроме total опциональна - hide когда bucket пуст.
          // Кнопка "Корзина" имеет свой счётчик удаляемых ключей; правило
          // keepOneKey работает под капотом без отдельной строки в сводке.
          selectionInfoEl = document.createElement('div');
          selectionInfoEl.className = 'svp-refs-on-map-selection-info';
          selectionInfoEl.style.display = 'none';
          selectionInfoTotalRow = document.createElement('div');
          selectionInfoTotalRow.className = 'svp-refs-on-map-selection-info__total';
          selectionInfoProtectedRow = document.createElement('div');
          selectionInfoProtectedRow.className = 'svp-refs-on-map-selection-info__protected';
          selectionInfoProtectedRow.style.display = 'none';
          selectionInfoOwnRow = document.createElement('div');
          selectionInfoOwnRow.className = 'svp-refs-on-map-selection-info__own';
          selectionInfoOwnRow.style.display = 'none';
          selectionInfoUnknownRow = document.createElement('div');
          selectionInfoUnknownRow.className = 'svp-refs-on-map-selection-info__unknown';
          selectionInfoUnknownRow.style.display = 'none';
          selectionInfoKeepOneRow = document.createElement('div');
          selectionInfoKeepOneRow.className = 'svp-refs-on-map-selection-info__keepone';
          selectionInfoKeepOneRow.style.display = 'none';
          selectionInfoToDeleteRow = document.createElement('div');
          selectionInfoToDeleteRow.className = 'svp-refs-on-map-selection-info__todelete';
          selectionInfoEl.appendChild(selectionInfoTotalRow);
          selectionInfoEl.appendChild(selectionInfoProtectedRow);
          selectionInfoEl.appendChild(selectionInfoOwnRow);
          selectionInfoEl.appendChild(selectionInfoUnknownRow);
          selectionInfoEl.appendChild(selectionInfoKeepOneRow);
          selectionInfoEl.appendChild(selectionInfoToDeleteRow);

          // Окончательный порядок детей bottomStack (flex column сверху
          // вниз): selectionInfo, mode, trash, cancel.
          bottomStack.appendChild(selectionInfoEl);
          bottomStack.appendChild(modeContainer);
          bottomStack.appendChild(trashButton);
          bottomStack.appendChild(cancelButton);
        } catch (error) {
          // Частичный успех enable() оставил бы hidden-кнопки/слой в DOM
          // (модуль помечен failed, но disable() автоматически не вызывается).
          // Сворачиваем всё, что успели создать, чтобы DOM остался чистым.
          cleanupEnableSideEffects();
          throw error;
        }
      },
      (error: unknown) => {
        // getOlMap отказался — откатываем injectStyles(), иначе стиль
        // остался бы в head даже после пометки модуля failed.
        removeStyles(MODULE_ID);
        throw error;
      },
    );
  },

  disable() {
    cleanupEnableSideEffects();
  },
};

/**
 * Снимает все side-effects, которые enable() мог успеть сделать: слой OL,
 * hidden-кнопки в DOM, listener на табах инвентаря, инжекцию стилей,
 * team-кеш. Идемпотентна — безопасно вызывать на любом промежуточном
 * состоянии enable (частичный успех при throw) или из disable() после
 * полного enable.
 */
function cleanupEnableSideEffects(): void {
  if (viewerOpen) hideViewer();
  teamLoadAborted = true;
  teamsLoading = false;
  inviewHookEnabled = false;
  ownTeamMode = 'keepOne';
  viewMoveHandler = null;
  resetTeamLoadState();

  if (olMap && refsLayer) {
    olMap.removeLayer(refsLayer);
  }

  if (showButton) {
    showButton.removeEventListener('click', showViewer);
    showButton.remove();
    showButton = null;
  }

  if (closeButton) {
    closeButton.removeEventListener('click', hideViewer);
    closeButton.remove();
    closeButton = null;
  }

  if (trashButton) {
    trashButton.remove();
    trashButton = null;
  }

  if (cancelButton) {
    cancelButton.removeEventListener('click', clearSelection);
    cancelButton.remove();
    cancelButton = null;
  }

  if (progressContainer) {
    progressContainer.remove();
    progressContainer = null;
  }
  progressBar = null;
  progressCounter = null;

  if (modeContainer) {
    modeContainer.remove();
    modeContainer = null;
  }
  modeRadioDelete = null;
  modeRadioKeep = null;
  modeRadioKeepOne = null;
  modeLabelDelete = null;
  modeLabelKeep = null;
  modeLabelKeepOne = null;

  if (selectionInfoEl) {
    selectionInfoEl.remove();
    selectionInfoEl = null;
  }
  selectionInfoTotalRow = null;
  selectionInfoProtectedRow = null;
  selectionInfoOwnRow = null;
  selectionInfoUnknownRow = null;
  selectionInfoKeepOneRow = null;
  selectionInfoToDeleteRow = null;

  if (bottomStack) {
    bottomStack.remove();
    bottomStack = null;
  }

  if (tabClickHandler) {
    const tabContainer = $('.inventory__tabs');
    if (tabContainer) {
      tabContainer.removeEventListener('click', tabClickHandler);
    }
    tabClickHandler = null;
  }

  removeStyles(MODULE_ID);
  teamCache.clear();
  olMap = null;
  refsSource = null;
  refsLayer = null;
}
