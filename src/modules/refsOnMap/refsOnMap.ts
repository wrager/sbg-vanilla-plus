import type { IFeatureModule } from '../../core/moduleRegistry';
import { $, injectStyles, removeStyles } from '../../core/dom';
import { t } from '../../core/l10n';
import { getOlMap } from '../../core/olMap';
import type { IOlFeature, IOlMap, IOlLayer, IOlMapEvent, IOlVectorSource } from '../../core/olMap';
import {
  buildLockedPointGuids,
  readFullInventoryReferences,
  readInventoryCache,
  INVENTORY_CACHE_KEY,
} from '../../core/inventoryCache';
import { isInventoryReference } from '../../core/inventoryTypes';
import { getPlayerTeam } from '../../core/playerTeam';
import { syncRefsCountForPoints } from '../../core/refsHighlightSync';
import { getTextColor, getBackgroundColor } from '../../core/themeColors';
import { showToast } from '../../core/toast';
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
let progressContainer: HTMLDivElement | null = null;
let progressBar: HTMLDivElement | null = null;
let progressCounter: HTMLDivElement | null = null;
let keepOwnTeamCheckbox: HTMLInputElement | null = null;
let keepOwnTeamLabel: HTMLLabelElement | null = null;
let keepOwnTeamTextSpan: HTMLSpanElement | null = null;
let keepOneKeyCheckbox: HTMLInputElement | null = null;
let keepOneKeyLabel: HTMLLabelElement | null = null;
let selectionInfoEl: HTMLDivElement | null = null;
let selectionInfoTotalRow: HTMLDivElement | null = null;
let selectionInfoProtectedRow: HTMLDivElement | null = null;
let selectionInfoOwnRow: HTMLDivElement | null = null;
let selectionInfoUnknownRow: HTMLDivElement | null = null;
let selectionInfoKeepOneRow: HTMLDivElement | null = null;
let selectionInfoDeletableRow: HTMLDivElement | null = null;
let tabClickHandler: ((event: Event) => void) | null = null;
let mapClickHandler: ((event: IOlMapEvent) => void) | null = null;
let viewMoveHandler: (() => void) | null = null;
let viewerOpen = false;
let beforeOpenZoom: number | undefined;
let beforeOpenRotation: number | undefined;
let beforeOpenFollow: string | null = null;
// Персистентный флаг: сохраняется в localStorage (svp_refsOnMap.keepOwnTeam)
// и переживает закрытие viewer'а / перезагрузку страницы. Загружается из
// storage в showViewer, сохраняется в onChange чекбокса. До первого
// showViewer хранит дефолт (false); реальное значение читается из
// loadRefsOnMapSettings при открытии viewer.
let keepOwnTeam = false;
// Персистентный флаг "Оставлять 1 ключ": при включённом удаление выделенных
// точек гарантирует, что в инвентаре по каждой точке останется минимум 1
// ключ. Дефолт - true (защитный): новый пользователь должен быть защищён от
// случайного полного удаления ключей. До первого showViewer хранит дефолт.
let keepOneKey = true;
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

function getTeamColor(team: number | undefined): string {
  if (team === undefined) return NEUTRAL_COLOR;
  const property = `--team-${team}`;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(property).trim();
  return raw ? expandHexColor(raw) : NEUTRAL_COLOR;
}

/**
 * Текст чекбокса "Не удалять <цвет>" под цвет команды игрока. SBG-команды
 * фиксированы в refs/game/css/variables.css: --team-1 красный, --team-2
 * зелёный, --team-3 синий. Если команда игрока не извлекается из DOM
 * (#self-info__name пустой / другой формат / выход из аккаунта) - fallback
 * на исторический "Не удалять свои" / "Keep own team", чтобы чекбокс всё
 * равно был функциональным (флаг работает и без точного цвета).
 */
function getKeepOwnTeamLabelText(): { en: string; ru: string } {
  switch (getPlayerTeam()) {
    case 1:
      return { en: 'Keep red', ru: 'Не удалять красные' };
    case 2:
      return { en: 'Keep green', ru: 'Не удалять зелёные' };
    case 3:
      return { en: 'Keep blue', ru: 'Не удалять синие' };
    default:
      return { en: 'Keep own team', ru: 'Не удалять свои' };
  }
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
    } = olStyle;

    const properties = feature.getProperties?.() ?? {};
    const amount = typeof properties.amount === 'number' ? properties.amount : 0;
    const title = typeof properties.title === 'string' ? properties.title : '';
    const team = typeof properties.team === 'number' ? properties.team : undefined;
    const isSelected = properties.isSelected === true;

    const zoom = olMap?.getView().getZoom?.() ?? 0;
    const teamColor = getTeamColor(team);
    const baseRadius = zoom >= 16 ? 10 : 8;
    const radius = isSelected ? baseRadius * 1.4 : baseRadius;

    // CUI style: transparent fill + colored stroke; selected = orange
    const fillColor = isSelected ? SELECTED_COLOR : teamColor + '40';
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

    if (zoom >= AMOUNT_ZOOM) {
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
          : title.slice(0, TITLE_MAX_LENGTH - 2).trim() + '…';
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
  // keepOneKey: точки, у которых keepOneKey защитил ВСЕ выделенные стопки
  // (delete_amount=0 для всех). Disjoint с deletable по pointGuid. Типичный
  // случай: точка с 1 ключом и выделена.
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
 * Per-feature разбивка текущего selection'а на bucket'ы lock/own/unknown/deletable
 * через тот же `partitionByLockProtection`, что применяется при handleDeleteClick,
 * чтобы UI всегда показывал реальный исход кнопки. Считает уникальные точки
 * (по pointGuid) и сумму amount для каждого bucket'а.
 *
 * Defensive case: keepOwnTeam=true И playerTeam=null - handleDeleteClick
 * блокирует удаление тостом "не могу определить команду". В этом состоянии
 * UI обязан показывать deletable=0, чтобы пользователь не думал, что
 * кнопка "X (X ключей)" с N>0 запустит удаление - иначе любое будущее
 * ослабление guard'а в handleDeleteClick (refactor, regression) пропустит
 * чужие/свои/unknown в payload. Все selected уходят в protectedByUnknownTeam.
 */
function computeSelectionBreakdown(): ISelectionBreakdown {
  if (!refsSource) return EMPTY_BREAKDOWN;
  const selected = refsSource.getFeatures().filter((feature) => {
    const properties = feature.getProperties?.();
    return properties !== undefined && properties.isSelected === true;
  });
  if (selected.length === 0) return EMPTY_BREAKDOWN;

  let ownTeamFilter: IOwnTeamFilter | null = null;
  let blockedByMissingPlayerTeam = false;
  if (keepOwnTeam) {
    const playerTeam = getPlayerTeam();
    if (playerTeam !== null) {
      ownTeamFilter = { playerTeam };
    } else {
      blockedByMissingPlayerTeam = true;
    }
  }

  let deletable: IOlFeature[];
  let protectedByLock: IOlFeature[];
  let protectedByOwnTeam: IOlFeature[];
  let protectedByUnknownTeam: IOlFeature[];
  if (blockedByMissingPlayerTeam) {
    deletable = [];
    protectedByLock = [];
    protectedByOwnTeam = [];
    protectedByUnknownTeam = [...selected];
  } else {
    const result = partitionByLockProtection(selected, ownTeamFilter);
    deletable = result.deletable;
    protectedByLock = result.protectedByLock;
    protectedByOwnTeam = result.protectedByOwnTeam;
    protectedByUnknownTeam = result.protectedByUnknownTeam;
  }
  // Bucket'ы lock / own / unknown disjoint по построению partitionByLockProtection.
  // Финальное deletable разделяется через computeDeletablePayload на:
  // - реально удаляемые (payload>0) -> deletableFinal/deletableKeysFinal
  // - защищённые keepOneKey (delete_amount=0 для всех стопок точки) -> keepOneKey
  // Все 5 bucket'ов disjoint по pointGuid; сумма точек по строкам = selectedPoints.
  // По ключам disjoint только если keepOneKey-сценарий "точка полностью защищена";
  // частичные удаления (payload<amount) учитываются в deletableKeys как payload.
  const { payload, protectedByKeepOneKey } = computeDeletablePayload(deletable, keepOneKey);
  const deletableFinal: IOlFeature[] = [];
  let deletableKeysFinal = 0;
  const pointsInPayload = new Set<string>();
  for (const [feature, deleteAmount] of payload) {
    deletableFinal.push(feature);
    deletableKeysFinal += deleteAmount;
    const guid = getPointGuid(feature);
    if (guid !== null) pointsInPayload.add(guid);
  }
  return {
    selectedPoints: uniquePointCount(selected),
    selectedKeys: sumAmount(selected),
    deletablePoints: pointsInPayload.size,
    deletableKeys: deletableKeysFinal,
    lockPoints: uniquePointCount(protectedByLock),
    lockKeys: sumAmount(protectedByLock),
    ownPoints: uniquePointCount(protectedByOwnTeam),
    ownKeys: sumAmount(protectedByOwnTeam),
    unknownPoints: uniquePointCount(protectedByUnknownTeam),
    unknownKeys: sumAmount(protectedByUnknownTeam),
    keepOneKeyPoints: uniquePointCount(protectedByKeepOneKey),
    keepOneKeyKeys: sumAmount(protectedByKeepOneKey),
  };
}

/**
 * Обновляет UI выбора: текст кнопки удаления (deletable ключи / точки),
 * блок-инфо рядом (сводка + breakdown по bucket'ам), видимость чекбокса
 * "Не удалять свои". Вызывается при каждом изменении selection, при смене
 * keepOwnTeam и после успешного delete (когда часть features удалена).
 */
function updateSelectionUi(): void {
  const breakdown = computeSelectionBreakdown();
  const hasSelection = breakdown.selectedPoints > 0;

  if (trashButton) {
    const trashLabel = trashButton.querySelector<HTMLSpanElement>('.svp-refs-on-map-trash-label');
    if (trashLabel) {
      trashLabel.textContent = hasSelection
        ? t({
            en: `${breakdown.deletablePoints} (${breakdown.deletableKeys} keys)`,
            ru: `${breakdown.deletablePoints} (${breakdown.deletableKeys} ключей)`,
          })
        : '';
    }
    trashButton.style.visibility = hasSelection ? 'visible' : 'hidden';
    // Блокировка только при включённом keepOwnTeam И когда хотя бы один
    // выбранный guid реально в очереди загрузки команды (queue/in-flight).
    // Фоновая загрузка для невыбранных точек (visible extent moveend, /inview
    // enrichment) удалению не мешает - фильтр свои читает team только у
    // selected, lock защищается через inventory-cache.f. Без фильтра
    // удаление безопасно в любом случае. Пересчёт триггерится из
    // updateSelectionUi на toggle/checkbox/batch worker'а.
    const isLoading = keepOwnTeam && hasSelectedPointsLoadingTeam();
    trashButton.disabled = isLoading;
    // data-loading переключает видимость default/loading icon span'ов через
    // CSS селекторы [data-loading="true"]. SVG-спиннер остаётся mounted
    // всё время viewer-сессии - animation крутится непрерывно.
    trashButton.dataset.loading = isLoading ? 'true' : 'false';
  }

  // Чекбоксы "Не удалять свои" и "Оставлять 1 ключ" показываются только при
  // наличии выбора - до выбора пользовательские фильтры не имеют смысла,
  // лишний UI-шум.
  if (keepOwnTeamLabel) {
    keepOwnTeamLabel.style.display = viewerOpen && hasSelection ? '' : 'none';
  }
  if (keepOneKeyLabel) {
    keepOneKeyLabel.style.display = viewerOpen && hasSelection ? '' : 'none';
  }

  // Кнопка "Отменить" снимает выделение всех точек. Видна только при
  // наличии выбора - симметрично с trashButton.
  if (cancelButton) {
    cancelButton.style.visibility = hasSelection ? 'visible' : 'hidden';
  }

  if (selectionInfoEl) {
    selectionInfoEl.style.display = hasSelection ? '' : 'none';
  }
  if (hasSelection) {
    if (selectionInfoTotalRow) {
      selectionInfoTotalRow.textContent = t({
        en: `Total: ${breakdown.selectedPoints} (${breakdown.selectedKeys} keys). Of them:`,
        ru: `Всего: ${breakdown.selectedPoints} (${breakdown.selectedKeys} ключей). Из них:`,
      });
    }
    // Строки lock / own / unknown / deletable disjoint - сумма всех четырёх
    // равна selected. Каждая опциональная: показывается только когда bucket
    // не пуст (и для own/unknown - дополнительно при keepOwnTeam=true,
    // потому что без фильтра unknown идёт в deletable, а own - тоже).
    if (selectionInfoProtectedRow) {
      const showLock = breakdown.lockPoints > 0;
      selectionInfoProtectedRow.style.display = showLock ? '' : 'none';
      if (showLock) {
        selectionInfoProtectedRow.textContent = t({
          en: `${breakdown.lockPoints} (${breakdown.lockKeys} keys) protected`,
          ru: `${breakdown.lockPoints} (${breakdown.lockKeys} ключей) защищено`,
        });
      }
    }
    if (selectionInfoOwnRow) {
      const showOwn = keepOwnTeam && breakdown.ownPoints > 0;
      selectionInfoOwnRow.style.display = showOwn ? '' : 'none';
      if (showOwn) {
        selectionInfoOwnRow.textContent = t({
          en: `${breakdown.ownPoints} (${breakdown.ownKeys} keys) own team`,
          ru: `${breakdown.ownPoints} (${breakdown.ownKeys} ключей) своего цвета`,
        });
      }
    }
    if (selectionInfoUnknownRow) {
      const showUnknown = keepOwnTeam && breakdown.unknownPoints > 0;
      selectionInfoUnknownRow.style.display = showUnknown ? '' : 'none';
      if (showUnknown) {
        selectionInfoUnknownRow.textContent = t({
          en: `${breakdown.unknownPoints} (${breakdown.unknownKeys} keys) unknown team`,
          ru: `${breakdown.unknownPoints} (${breakdown.unknownKeys} ключей) неизвестного цвета`,
        });
      }
    }
    if (selectionInfoKeepOneRow) {
      // Показываем только когда keepOneKey активен и есть точки, полностью
      // защищённые им. Частично-удалённые точки (где 1 ключ остался)
      // отображены в deletable с уменьшенным amount; отдельная строка про
      // них не нужна.
      const showKeepOne = keepOneKey && breakdown.keepOneKeyPoints > 0;
      selectionInfoKeepOneRow.style.display = showKeepOne ? '' : 'none';
      if (showKeepOne) {
        selectionInfoKeepOneRow.textContent = t({
          en: `${breakdown.keepOneKeyPoints} (${breakdown.keepOneKeyKeys} keys) kept (1 key rule)`,
          ru: `${breakdown.keepOneKeyPoints} (${breakdown.keepOneKeyKeys} ключей) защищено (правило "1 ключ")`,
        });
      }
    }
    if (selectionInfoDeletableRow) {
      selectionInfoDeletableRow.textContent = t({
        en: `${breakdown.deletablePoints} (${breakdown.deletableKeys} keys) to delete`,
        ru: `${breakdown.deletablePoints} (${breakdown.deletableKeys} ключей) к удалению`,
      });
    }
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

function toggleFeatureSelection(feature: IOlFeature): void {
  const properties = feature.getProperties?.() ?? {};
  const isSelected = properties.isSelected === true;
  feature.set?.('isSelected', !isSelected);
  // Если фича только что попала в выбор и её team ещё не известна -
  // ставим pointGuid в очередь worker'а. Без этого выделенные точки
  // вне visible-extent остаются protectedByUnknownTeam (fail-safe),
  // и UI breakdown показывает их в "protected" хотя по смыслу это
  // просто "не догружено".
  if (!isSelected) {
    const pointGuid = typeof properties.pointGuid === 'string' ? properties.pointGuid : null;
    // team может быть number (известна), null (neutral - тоже известная,
    // загрузки не требует) или undefined (не загружено). requestTeamLoad
    // нужен только для undefined; сам он дополнительно skip'ит, если
    // teamCache.has(guid) уже что-то записал.
    const teamIsLoaded = typeof properties.team === 'number' || properties.team === null;
    if (pointGuid !== null && !teamIsLoaded) requestTeamLoad(pointGuid);
  }
  updateSelectionUi();
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
  // Пока команды точек догружаются, выбор по клику отключён - фильтр
  // Клик-выбор всегда работает: при keepOwnTeam=true выбранная точка с
  // team=undefined попадёт в protectedByUnknownTeam (fail-safe), удаление
  // её защитит. При keepOwnTeam=false фильтра нет - team не нужен для
  // payload. Блокировка по teamsLoading ушла из selection в trashButton
  // (см. updateSelectionUi).
  olMap.forEachFeatureAtPixel(
    event.pixel,
    (feature: IOlFeature) => {
      toggleFeatureSelection(feature);
    },
    {
      layerFilter: (layer: IOlLayer) => layer.get('name') === 'svp-refs-on-map',
    },
  );
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

interface IOwnTeamFilter {
  /** Команда игрока (читается через `getPlayerTeam()`). */
  playerTeam: number;
}

/**
 * Делит выбранные ref-фичи на 4 bucket'а:
 *
 * 1. `protectedByLock` - точки с замочком (бит 0b10 поля `f` любой стопки в
 *    `inventory-cache`). Per-point агрегация: одна locked-стопка защищает все
 *    ключи точки от удаления.
 * 2. `protectedByOwnTeam` - точки, чья команда совпадает с командой игрока
 *    (только при `ownTeamFilter !== null`).
 * 3. `protectedByUnknownTeam` - точки с не определённой командой (`team ===
 *    undefined`: API не вернул `te`, fetch упал, или загрузка ещё не дошла
 *    до этой точки). Только при `ownTeamFilter !== null` - fail-safe, цвет
 *    неизвестен, удалять рискованно. Отдельный bucket нужен чтобы тост
 *    честно отделял "оставлены как свои" от "оставлены потому что цвет не
 *    загружен" - это разные причины, требующие разных действий пользователя
 *    (повторить загрузку / pan на эти точки).
 * 4. `deletable` - всё остальное (чужая команда; либо `ownTeamFilter=null`).
 *
 * Lock проверяется до own-team: locked-точки безусловно защищены, выключенный
 * keepOwnTeam ничего не меняет в их судьбе.
 */
function partitionByLockProtection(
  features: IOlFeature[],
  ownTeamFilter: IOwnTeamFilter | null = null,
): {
  deletable: IOlFeature[];
  protectedByLock: IOlFeature[];
  protectedByOwnTeam: IOlFeature[];
  protectedByUnknownTeam: IOlFeature[];
} {
  const cache = readInventoryCache();
  const lockedPointGuids = buildLockedPointGuids(cache);
  const deletable: IOlFeature[] = [];
  const protectedByLock: IOlFeature[] = [];
  const protectedByOwnTeam: IOlFeature[] = [];
  const protectedByUnknownTeam: IOlFeature[] = [];
  for (const feature of features) {
    const properties = feature.getProperties?.() ?? {};
    const pointGuid = typeof properties.pointGuid === 'string' ? properties.pointGuid : null;
    if (pointGuid && lockedPointGuids.has(pointGuid)) {
      protectedByLock.push(feature);
      continue;
    }
    if (ownTeamFilter !== null) {
      // feature.team:
      // - number: конкретная команда. Сравниваем с playerTeam.
      // - null: нейтральная точка (сервер вернул te:null). Не своя -> deletable.
      // - undefined: команда не загружена (fetch failed либо точка ни в visible
      //   extent, ни в очереди). Fail-safe -> protectedByUnknownTeam.
      const team: unknown = properties.team;
      if (team === undefined) {
        protectedByUnknownTeam.push(feature);
        continue;
      }
      if (typeof team === 'number' && team === ownTeamFilter.playerTeam) {
        protectedByOwnTeam.push(feature);
        continue;
      }
    }
    deletable.push(feature);
  }
  return { deletable, protectedByLock, protectedByOwnTeam, protectedByUnknownTeam };
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
 * Применяет фильтр "Оставлять 1 ключ" к набору deletable-фич. Гарантирует,
 * что после DELETE у каждой выделенной точки в инвентаре останется минимум
 * 1 ключ - с учётом НЕвыделенных стопок этой точки.
 *
 * Алгоритм для каждой точки (группировка deletable по pointGuid):
 * 1. selectedAmount = сумма amount выделенных стопок этой точки.
 * 2. inventoryTotal = сумма amount ВСЕХ стопок этой точки из inventory-cache
 *    (включая невыделенные и не попавшие в deletable, например lock-стопки -
 *    они всё равно физически в инвентаре).
 * 3. unselectedAmount = inventoryTotal - selectedAmount.
 * 4. Если keepOneKey=false ИЛИ unselectedAmount >= 1 - инвариант уже
 *    выполнен (либо фильтр выключен, либо в инвентаре по точке останется
 *    хотя бы 1 ключ через невыделенные стопки). Удаляем все выделенные
 *    стопки целиком: payload[guid] = amount.
 * 5. Иначе (keepOneKey=true И unselectedAmount === 0):
 *    - toDeleteTotal = selectedAmount - 1.
 *    - Если toDeleteTotal <= 0 (selectedAmount <= 1) - удалять нечего без
 *      нарушения инварианта; все стопки попадают в protectedByKeepOneKey.
 *    - Иначе distribute toDeleteTotal среди выделенных стопок по убыванию
 *      amount: большие стопки удаляются полностью, последняя обрезается до
 *      остатка. Стопки с delete_amount=0 уходят в protectedByKeepOneKey.
 *
 * Критический инвариант: при keepOneKey=true sum(payload values для стопок
 * pointGuid) < inventoryTotal(pointGuid). Покрыт серией critical-safety тестов.
 */
function computeDeletablePayload(
  deletable: IOlFeature[],
  keepOneKeyActive: boolean,
): { payload: Map<IOlFeature, number>; protectedByKeepOneKey: IOlFeature[] } {
  const payload = new Map<IOlFeature, number>();
  const protectedByKeepOneKey: IOlFeature[] = [];

  if (!keepOneKeyActive) {
    for (const feature of deletable) {
      const amount = (feature.getProperties?.() ?? {}).amount;
      if (typeof amount === 'number') payload.set(feature, amount);
    }
    return { payload, protectedByKeepOneKey };
  }

  // Группа: pointGuid -> features этой точки в deletable.
  const groups = new Map<string, IOlFeature[]>();
  for (const feature of deletable) {
    const guid = getPointGuid(feature);
    if (guid === null) {
      // Без pointGuid не можем сгруппировать - конструкция inventory не
      // даст найти невыделенные стопки. Без инварианта keepOneKey удалить
      // такую стопку нельзя: попадает в protectedByKeepOneKey.
      protectedByKeepOneKey.push(feature);
      continue;
    }
    const list = groups.get(guid);
    if (list) list.push(feature);
    else groups.set(guid, [feature]);
  }

  // Инвентарь читаем один раз для всех групп - сразу строим карту
  // pointGuid -> inventoryTotal по всем стопкам этой точки.
  const inventoryTotals = new Map<string, number>();
  for (const item of readFullInventoryReferences()) {
    inventoryTotals.set(item.l, (inventoryTotals.get(item.l) ?? 0) + item.a);
  }

  for (const [pointGuid, features] of groups) {
    const selectedAmount = sumAmount(features);
    const inventoryTotal = inventoryTotals.get(pointGuid) ?? 0;
    const unselectedAmount = inventoryTotal - selectedAmount;

    if (unselectedAmount >= 1) {
      // Невыделенные стопки оставляют >=1 ключ в инвентаре - удаляем
      // выделенные полностью.
      for (const feature of features) {
        const amount = (feature.getProperties?.() ?? {}).amount;
        if (typeof amount === 'number') payload.set(feature, amount);
      }
      continue;
    }

    // unselectedAmount === 0: все стопки точки выделены. Сохраняем 1 ключ.
    const toDeleteTotal = selectedAmount - 1;
    if (toDeleteTotal <= 0) {
      // selectedAmount <= 1: нечего удалять без нарушения инварианта.
      for (const feature of features) protectedByKeepOneKey.push(feature);
      continue;
    }

    // Distribute. Sort by amount desc, ties по feature id (детерминированно
    // для тестов и для воспроизводимого DELETE-payload).
    const sorted = [...features].sort((a, b) => {
      const aAmount = ((a.getProperties?.() ?? {}).amount as number | undefined) ?? 0;
      const bAmount = ((b.getProperties?.() ?? {}).amount as number | undefined) ?? 0;
      if (bAmount !== aAmount) return bAmount - aAmount;
      const aId = a.getId();
      const bId = b.getId();
      return String(aId).localeCompare(String(bId));
    });

    let remaining = toDeleteTotal;
    for (const feature of sorted) {
      if (remaining <= 0) {
        protectedByKeepOneKey.push(feature);
        continue;
      }
      const amount = (feature.getProperties?.() ?? {}).amount;
      if (typeof amount !== 'number' || amount <= 0) {
        protectedByKeepOneKey.push(feature);
        continue;
      }
      const deleteAmount = Math.min(amount, remaining);
      payload.set(feature, deleteAmount);
      remaining -= deleteAmount;
    }
  }

  return { payload, protectedByKeepOneKey };
}

async function handleDeleteClick(): Promise<void> {
  if (!refsSource) return;
  const selected = refsSource.getFeatures().filter((feature) => {
    const properties = feature.getProperties?.();
    return properties !== undefined && properties.isSelected === true;
  });
  if (selected.length === 0) return;

  // Дополнительный guard поверх UI-блокировки: если по любой причине клик
  // прошёл во время загрузки команды для одной из выбранных точек И при
  // включённом keepOwnTeam - удаление запрещено, потому что фильтр свои
  // читает feature.team у selected, и до резолва точка с team=undefined
  // могла бы попасть в payload. Фоновая загрузка для невыбранных не
  // блокирует, см. updateSelectionUi.
  if (keepOwnTeam && hasSelectedPointsLoadingTeam()) {
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

  // Опциональный фильтр "не удалять свои": активен, если пользователь
  // включил чекбокс. При playerTeam=null (CSS `#self-info__name` не дал
  // команду) - жёсткий блок: фильтр заявлен пользователем, выполнить его
  // мы не можем, удалять без фильтра нельзя - это нарушение явного
  // пользовательского намерения.
  let ownTeamFilter: IOwnTeamFilter | null = null;
  if (keepOwnTeam) {
    const playerTeam = getPlayerTeam();
    if (playerTeam === null) {
      showToast(
        t({
          en: 'Cannot determine player team. Deletion blocked (disable "Keep own" to proceed).',
          ru: 'Не удалось определить команду игрока. Удаление заблокировано (выключите "Не удалять свои", чтобы продолжить).',
        }),
      );
      return;
    }
    ownTeamFilter = { playerTeam };
  }

  // Защита lock + опциональный фильтр own-team. Lock всегда защищает; фильтр
  // own-team отдельными bucket'ами, чтобы тост честно различал три причины:
  // "locked: N", "свои: N", "цвет неизвестен: N" - у каждой свой вывод для
  // пользователя и разные дальнейшие действия.
  const { deletable, protectedByLock, protectedByOwnTeam, protectedByUnknownTeam } =
    partitionByLockProtection(selected, ownTeamFilter);

  // Применяем фильтр "Оставлять 1 ключ" к deletable. payload содержит только
  // те фичи, у которых есть что удалить с учётом инварианта. protectedByKeepOneKey -
  // фичи, которые keepOneKey защитил полностью (delete_amount=0).
  const { payload, protectedByKeepOneKey } = computeDeletablePayload(deletable, keepOneKey);

  if (payload.size === 0) {
    if (protectedByKeepOneKey.length > 0 && deletable.length === protectedByKeepOneKey.length) {
      // Все deletable защищены keepOneKey (typically: каждая точка с 1
      // ключом). Показываем явный toast о keepOneKey.
      showToast(
        t({
          en: `Keep 1 key kept ${protectedByKeepOneKey.length} stack(s) from deletion`,
          ru: `"Оставлять 1 ключ" сохранил ${protectedByKeepOneKey.length} стопк(и) от удаления`,
        }),
      );
      return;
    }
    showToast(buildAllProtectedToast(protectedByLock, protectedByOwnTeam, protectedByUnknownTeam));
    return;
  }

  // Уникальные точки, по которым что-то удалится (один pointGuid - одна точка
  // в подсчёте, даже если payload содержит несколько стопок этой точки).
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
  const partialUpdates = new Map<string, number>(); // refGuid -> new amount
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
      return;
    }

    // Полностью удалённые фичи убираем из source; частично-удалённые
    // обновляем amount + снимаем isSelected (визуально пользователь видит
    // "цикл удаления завершён", может начать новый выбор).
    for (const [feature, deleteAmount] of payload) {
      const amount = (feature.getProperties?.() ?? {}).amount;
      if (typeof amount !== 'number') continue;
      if (deleteAmount >= amount) {
        refsSource.removeFeature?.(feature);
      } else {
        feature.set?.('amount', amount - deleteAmount);
        feature.set?.('isSelected', false);
      }
    }

    // Update local cache: полностью удалённые стопки убираются, частично
    // обновлённые - меняют amount.
    removeRefsFromCacheAndUpdate(fullyDeletedGuids, partialUpdates);

    // Sync счётчика ключей на подписи затронутых точек на основной карте.
    // Учитываем только реально затронутые точки (из payload), не все
    // deletable - keepOneKey-protected фичи в инвентаре не изменились.
    const affectedPointGuids = Array.from(pointsInPayload);
    if (affectedPointGuids.length > 0) {
      void syncRefsCountForPoints(affectedPointGuids);
    }

    // Update inventory counter
    if (typeof response.count?.total === 'number') {
      updateInventoryCounter(response.count.total);
    }

    // Уведомления об оставленных: lock / своя / неизвестный цвет - три
    // разные причины, показываем по факту наличия. Каждая категория - свой
    // тост, чтобы пользователь видел развёрнутый итог в одном диалоге.
    if (protectedByLock.length > 0) {
      showToast(
        t({
          en: `Locked points: ${protectedByLock.length} key(s) kept`,
          ru: `Locked-точки: ${protectedByLock.length} ключ(ей) оставлено`,
        }),
      );
    }
    if (protectedByOwnTeam.length > 0) {
      showToast(
        t({
          en: `Own team: ${protectedByOwnTeam.length} key(s) kept`,
          ru: `Свои: ${protectedByOwnTeam.length} ключ(ей) оставлено`,
        }),
      );
    }
    if (protectedByUnknownTeam.length > 0) {
      showToast(
        t({
          en: `Unknown team color: ${protectedByUnknownTeam.length} key(s) kept (try reopening or panning to load colors)`,
          ru: `Цвет команды не загружен: ${protectedByUnknownTeam.length} ключ(ей) оставлено (откройте viewer заново или передвиньте карту, чтобы догрузить)`,
        }),
      );
    }
    if (protectedByKeepOneKey.length > 0) {
      showToast(
        t({
          en: `Keep 1 key: ${protectedByKeepOneKey.length} stack(s) kept untouched`,
          ru: `"Оставлять 1 ключ": ${protectedByKeepOneKey.length} стопк(и) не тронуто`,
        }),
      );
    }

    // После DELETE selected features из refsSource удалены через removeFeature
    // выше; remaining selected состоит только из protected. updateSelectionUi
    // пересчитает breakdown с актуальным refsSource.
    updateSelectionUi();
  } catch (error) {
    console.error(`[SVP] ${MODULE_ID}: deletion failed:`, error);
  }
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
): string {
  const lockN = protectedByLock.length;
  const ownN = protectedByOwnTeam.length;
  const unknownN = protectedByUnknownTeam.length;
  const onlyLock = lockN > 0 && ownN === 0 && unknownN === 0;
  const onlyOwn = ownN > 0 && lockN === 0 && unknownN === 0;
  const onlyUnknown = unknownN > 0 && lockN === 0 && ownN === 0;
  if (onlyLock) {
    return t({
      en: 'All selected keys belong to locked points and cannot be deleted',
      ru: 'Все выбранные ключи относятся к locked-точкам и не могут быть удалены',
    });
  }
  if (onlyOwn) {
    return t({
      en: 'All selected keys belong to your team and were kept ("Keep own" is on)',
      ru: 'Все выбранные ключи - свои, оставлены (включена "Не удалять свои")',
    });
  }
  if (onlyUnknown) {
    return t({
      en: 'All selected keys have unknown team color (try reopening or panning to load colors)',
      ru: 'У всех выбранных ключей не загружен цвет команды (откройте viewer заново или передвиньте карту)',
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
  // Загружаем сохранённое значение keepOwnTeam и keepOneKey из localStorage.
  // Чекбоксы ниже получат .checked перед показом - пользователь видит свой
  // выбор из прошлой сессии. keepOneKey по умолчанию true (см. settings).
  {
    const settings = loadRefsOnMapSettings();
    keepOwnTeam = settings.keepOwnTeam;
    keepOneKey = settings.keepOneKey;
  }
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
  if (keepOwnTeamCheckbox) keepOwnTeamCheckbox.checked = keepOwnTeam;
  if (keepOwnTeamLabel) keepOwnTeamLabel.style.display = 'none';
  // Текст keepOwnTeam-label - под цвет команды игрока. Перечитываем при
  // каждом showViewer: между сессиями viewer'а команда могла измениться
  // (relogin внутри игры обычно делает reload, но cookie может остаться).
  if (keepOwnTeamTextSpan) keepOwnTeamTextSpan.textContent = t(getKeepOwnTeamLabelText());
  if (keepOneKeyCheckbox) keepOneKeyCheckbox.checked = keepOneKey;
  if (keepOneKeyLabel) keepOneKeyLabel.style.display = 'none';
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
  // keepOwnTeam НЕ сбрасываем: настройка персистентна, следующий showViewer
  // загрузит её через loadRefsOnMapSettings.
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
  if (keepOwnTeamLabel) keepOwnTeamLabel.style.display = 'none';
  if (keepOwnTeamCheckbox) keepOwnTeamCheckbox.checked = false;
  if (keepOneKeyLabel) keepOneKeyLabel.style.display = 'none';
  // .checked НЕ сбрасываем у keepOneKeyCheckbox в false: дефолт=true,
  // следующий showViewer всё равно перепишет из loadRefsOnMapSettings.
  // Симметрично с keepOwnTeam-сбросом - там было false, тут будет true.

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
          document.body.appendChild(trashButton);

          // Cancel button - снимает выделение всех выбранных точек. Видна
          // только при наличии выбора (updateSelectionUi). Иконка - крестик
          // в стиле lucide-icons "x" (две диагональные линии).
          cancelButton = document.createElement('button');
          cancelButton.className = 'svp-refs-on-map-cancel';
          cancelButton.setAttribute(
            'aria-label',
            t({ en: 'Cancel selection', ru: 'Отменить выделение' }),
          );
          cancelButton.innerHTML =
            '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
          cancelButton.style.visibility = 'hidden';
          cancelButton.addEventListener('click', clearSelection);
          document.body.appendChild(cancelButton);

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

          // Чекбоксы "Не удалять свои" и "Оставлять 1 ключ" - inline в
          // viewer-режиме, оба видны только когда есть выбор (updateSelectionUi
          // контролирует visibility). State персистентный через localStorage
          // (refsOnMapSettings): showViewer загружает значения, onChange
          // сохраняет.
          keepOwnTeamLabel = document.createElement('label');
          keepOwnTeamLabel.className = 'svp-refs-on-map-keep-own';
          keepOwnTeamLabel.style.display = 'none';
          keepOwnTeamCheckbox = document.createElement('input');
          keepOwnTeamCheckbox.type = 'checkbox';
          keepOwnTeamCheckbox.checked = false;
          keepOwnTeamCheckbox.addEventListener('change', () => {
            keepOwnTeam = keepOwnTeamCheckbox?.checked === true;
            saveRefsOnMapSettings({ keepOwnTeam, keepOneKey });
            // Партиция в computeSelectionBreakdown зависит от keepOwnTeam:
            // переключение влияет на own/deletable bucket'ы. Перерисовываем UI.
            updateSelectionUi();
          });
          keepOwnTeamTextSpan = document.createElement('span');
          // Текст изначально fallback; showViewer перепишет под текущий
          // цвет команды игрока, когда #self-info__name точно отрендерен.
          keepOwnTeamTextSpan.textContent = t(getKeepOwnTeamLabelText());
          keepOwnTeamLabel.appendChild(keepOwnTeamCheckbox);
          keepOwnTeamLabel.appendChild(keepOwnTeamTextSpan);
          document.body.appendChild(keepOwnTeamLabel);

          // Чекбокс "Оставлять 1 ключ" - дефолт=true, защищает от случайного
          // полного удаления ключей точки. payload вычисляется с учётом
          // невыделенных стопок: если в инвентаре по точке остаются ключи в
          // невыделенных стопках, выделенные удаляются полностью; иначе
          // distribute (selected_total - 1) keys среди выделенных.
          keepOneKeyLabel = document.createElement('label');
          keepOneKeyLabel.className = 'svp-refs-on-map-keep-one';
          keepOneKeyLabel.style.display = 'none';
          keepOneKeyCheckbox = document.createElement('input');
          keepOneKeyCheckbox.type = 'checkbox';
          keepOneKeyCheckbox.checked = true;
          keepOneKeyCheckbox.addEventListener('change', () => {
            keepOneKey = keepOneKeyCheckbox?.checked === true;
            saveRefsOnMapSettings({ keepOwnTeam, keepOneKey });
            // Партиция payload в computeSelectionBreakdown зависит от
            // keepOneKey: переключение влияет на deletable/keepOneKey
            // bucket'ы. Перерисовываем UI и кнопку "Корзина".
            updateSelectionUi();
          });
          const keepOneKeyText = document.createElement('span');
          keepOneKeyText.textContent = t({
            en: 'Keep 1 key',
            ru: 'Оставлять 1 ключ',
          });
          keepOneKeyLabel.appendChild(keepOneKeyCheckbox);
          keepOneKeyLabel.appendChild(keepOneKeyText);
          document.body.appendChild(keepOneKeyLabel);

          // Selection info: до 5 строк - total + protected (lock) + own +
          // unknown (последние две только при keepOwnTeam=true) + deletable
          // (зеркало счётчика на кнопке "Корзина"). Bucket'ы lock/own/
          // unknown/deletable disjoint, сумма = total. Каждая строка кроме
          // total и deletable опциональна - hide when bucket=0. Видим блок
          // только при hasSelection - синхронизация в updateSelectionUi.
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
          selectionInfoDeletableRow = document.createElement('div');
          selectionInfoDeletableRow.className = 'svp-refs-on-map-selection-info__deletable';
          selectionInfoEl.appendChild(selectionInfoTotalRow);
          selectionInfoEl.appendChild(selectionInfoProtectedRow);
          selectionInfoEl.appendChild(selectionInfoOwnRow);
          selectionInfoEl.appendChild(selectionInfoUnknownRow);
          selectionInfoEl.appendChild(selectionInfoKeepOneRow);
          selectionInfoEl.appendChild(selectionInfoDeletableRow);
          document.body.appendChild(selectionInfoEl);
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
  keepOwnTeam = false;
  keepOneKey = true;
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

  if (keepOwnTeamLabel) {
    keepOwnTeamLabel.remove();
    keepOwnTeamLabel = null;
  }
  keepOwnTeamCheckbox = null;
  keepOwnTeamTextSpan = null;
  if (keepOneKeyLabel) {
    keepOneKeyLabel.remove();
    keepOneKeyLabel = null;
  }
  keepOneKeyCheckbox = null;

  if (selectionInfoEl) {
    selectionInfoEl.remove();
    selectionInfoEl = null;
  }
  selectionInfoTotalRow = null;
  selectionInfoProtectedRow = null;
  selectionInfoOwnRow = null;
  selectionInfoUnknownRow = null;
  selectionInfoKeepOneRow = null;
  selectionInfoDeletableRow = null;

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
