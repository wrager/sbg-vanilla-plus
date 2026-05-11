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
  data?: { te?: number };
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

async function fetchPointTeam(pointGuid: string): Promise<number | null> {
  try {
    const response = await fetch(`/api/point?guid=${pointGuid}&status=1`);
    const json: unknown = await response.json();
    if (isPointApiResponse(json) && typeof json.data?.te === 'number') {
      return json.data.te;
    }
  } catch {
    // leave neutral color on error
  }
  return null;
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

function removeRefsFromCache(deletedGuids: Set<string>): void {
  const raw = localStorage.getItem(INVENTORY_CACHE_KEY);
  if (!raw) return;
  let items: unknown[];
  try {
    items = JSON.parse(raw) as unknown[];
  } catch {
    return;
  }
  if (!Array.isArray(items)) return;
  const filtered = items.filter((item) => {
    if (typeof item !== 'object' || item === null) return true;
    const record = item as Record<string, unknown>;
    if (record.t !== REFS_TAB_TYPE) return true;
    return typeof record.g === 'string' && !deletedGuids.has(record.g);
  });
  localStorage.setItem(INVENTORY_CACHE_KEY, JSON.stringify(filtered));
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
let lockedNote: HTMLDivElement | null = null;
let progressContainer: HTMLDivElement | null = null;
let progressBar: HTMLDivElement | null = null;
let progressCounter: HTMLDivElement | null = null;
let keepOwnTeamCheckbox: HTMLInputElement | null = null;
let keepOwnTeamLabel: HTMLLabelElement | null = null;
let tabClickHandler: ((event: Event) => void) | null = null;
let mapClickHandler: ((event: IOlMapEvent) => void) | null = null;
let viewMoveHandler: (() => void) | null = null;
let viewerOpen = false;
let beforeOpenZoom: number | undefined;
let beforeOpenRotation: number | undefined;
let beforeOpenFollow: string | null = null;
// Эфемерный флаг: живёт только пока viewer открыт. Сбрасывается в showViewer
// (новый viewer-сеанс всегда стартует с выключенным фильтром) и в
// handleInviewResponse при появлении новых guid'ов (контекст изменился,
// прежний фильтр невалиден). В localStorage не сохраняется.
let keepOwnTeam = false;
const teamCache = new Map<string, number>();
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
let teamLoadInProgress = false;
let teamLoadTotal = 0;
let teamLoadDone = 0;
let overallRefsToDelete = 0;
let uniqueRefsToDelete = 0;

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
 * Обработчик /api/inview ответа: enrichment поверх active pull. Две задачи:
 * 1. Записать команды из ответа в teamCache и в feature.team всех refs-фич
 *    с соответствующим pointGuid. Если guid уже был в очереди worker'а
 *    /api/point - удаляем его из очереди, т. к. данные уже получены через
 *    /inview быстрее.
 * 2. Auto-disable keepOwnTeam при появлении новых (не в teamCache) guid'ов:
 *    /inview может прислать guid'ы из текущего extent'а раньше, чем active
 *    pull на следующий moveend - сигнал смены контекста приходит первым.
 *
 * Fallback /api/point для guid'ов с отсутствующим `t` не нужен: active pull
 * (enqueueVisibleForLoad на showViewer + moveend) и так загружает все
 * видимые ref-точки через /api/point, дубль приведёт к race за queue.
 */
function handleInviewResponse(points: IInviewPoint[]): void {
  if (!viewerOpen || !refsSource) return;

  const newGuids: string[] = [];
  for (const point of points) {
    if (typeof point.g !== 'string') continue;
    if (!teamCache.has(point.g)) newGuids.push(point.g);
  }

  for (const point of points) {
    if (typeof point.g !== 'string') continue;
    if (typeof point.t !== 'number') continue;
    teamCache.set(point.g, point.t);
    teamLoadQueue.delete(point.g);
    for (const feature of refsSource.getFeatures()) {
      const properties = feature.getProperties?.() ?? {};
      if (properties.pointGuid === point.g) {
        feature.set?.('team', point.t);
      }
    }
  }

  maybeResetKeepOwnTeamOnNewVisibility(newGuids);
}

/**
 * Сбрасывает keepOwnTeam, если среди обработанных guid'ов есть новые
 * (визуально неизвестные точки в кадре). Срабатывает независимо от того,
 * попали ли новые guid'ы в текущий selection: новый набор видимых точек =
 * новый контекст, прежний фильтр невалиден.
 *
 * Вызывается из двух мест:
 * - handleInviewResponse (passive enrichment через игровой /api/inview);
 * - enqueueVisibleForLoad (active pull при showViewer и moveend, когда
 *   обнаруживаем guid'ы в visible extent, которых ещё нет в teamCache).
 */
function maybeResetKeepOwnTeamOnNewVisibility(newGuids: readonly string[]): void {
  if (newGuids.length === 0 || !keepOwnTeam) return;
  keepOwnTeam = false;
  if (keepOwnTeamCheckbox) keepOwnTeamCheckbox.checked = false;
  showToast(
    t({
      en: 'Filter "Keep own team" disabled: visible points may have unknown team',
      ru: 'Фильтр "Не удалять свои" сброшен из-за возможного появления точек с неизвестной командой',
    }),
  );
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
  const newGuids: string[] = [];
  let added = 0;
  for (const guid of visible) {
    if (teamCache.has(guid)) continue;
    newGuids.push(guid);
    if (teamLoadQueue.has(guid)) continue;
    teamLoadQueue.add(guid);
    teamLoadTotal++;
    added++;
  }
  if (added > 0) {
    teamsLoading = true;
    showProgress(teamLoadTotal);
    updateProgress(teamLoadDone, teamLoadTotal);
    updateTrashCounter();
    if (!teamLoadInProgress) {
      void runTeamLoadWorker();
    }
  }
  maybeResetKeepOwnTeamOnNewVisibility(newGuids);
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

// ── selection ────────────────────────────────────────────────────────────────

function updateTrashCounter(): void {
  if (!trashButton) return;
  const hasSelection = uniqueRefsToDelete > 0;
  trashButton.textContent = hasSelection ? `🗑️ ${uniqueRefsToDelete} (${overallRefsToDelete})` : '';
  trashButton.style.visibility = hasSelection ? 'visible' : 'hidden';
  // Пока команды точек догружаются, удаление запрещено: фильтр keepOwnTeam
  // не видит финальные значения `team` у фич. Disabled-state снимается из
  // updateProgress() при последнем done==total и из applyTeamsLoadedState().
  trashButton.disabled = teamsLoading;
  // Чекбокс «Не удалять свои» показывается только при наличии выбора - до
  // выбора пользовательский фильтр не имеет смысла, лишний UI-шум.
  if (keepOwnTeamLabel) {
    keepOwnTeamLabel.style.display = viewerOpen && hasSelection ? '' : 'none';
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
  updateTrashCounter();
  teamLoadTotal = 0;
  teamLoadDone = 0;
}

function toggleFeatureSelection(feature: IOlFeature): void {
  const properties = feature.getProperties?.() ?? {};
  const isSelected = properties.isSelected === true;
  const amount = typeof properties.amount === 'number' ? properties.amount : 0;

  feature.set?.('isSelected', !isSelected);

  overallRefsToDelete += amount * (isSelected ? -1 : 1);
  uniqueRefsToDelete += isSelected ? -1 : 1;
  updateTrashCounter();
}

function handleMapClick(event: IOlMapEvent): void {
  if (!olMap?.forEachFeatureAtPixel) return;
  // Пока команды точек догружаются, выбор по клику отключён - фильтр
  // keepOwnTeam должен видеть финальные значения `team` у фич, иначе
  // пользователь выберет точку, цвет которой ещё не определён, и пройдёт
  // в payload вопреки своему намерению. Pan/zoom не блокируем - игрок
  // должен видеть всю карту во время загрузки. См. README модуля.
  if (teamsLoading) return;
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
      const team = typeof properties.team === 'number' ? properties.team : undefined;
      if (team === undefined) {
        protectedByUnknownTeam.push(feature);
        continue;
      }
      if (team === ownTeamFilter.playerTeam) {
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

async function handleDeleteClick(): Promise<void> {
  if (uniqueRefsToDelete === 0 || !refsSource) return;

  // Дополнительный guard поверх UI-блокировки: если по любой причине клик
  // прошёл во время загрузки (race с MutationObserver, программный вызов из
  // тестов), удаление запрещено - команды точек могут быть не догружены, и
  // фильтр keepOwnTeam отработает с неполными данными.
  if (teamsLoading) {
    showToast(
      t({
        en: 'Loading team data, please wait',
        ru: 'Загружаются данные о командах, подождите',
      }),
    );
    return;
  }

  const selectedFeatures = refsSource.getFeatures().filter((feature) => {
    const properties = feature.getProperties?.();
    return properties !== undefined && properties.isSelected === true;
  });

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
    partitionByLockProtection(selectedFeatures, ownTeamFilter);

  if (deletable.length === 0) {
    showToast(buildAllProtectedToast(protectedByLock, protectedByOwnTeam, protectedByUnknownTeam));
    return;
  }

  const overallToDelete = sumAmount(deletable);
  const message = t({
    en: `Delete ${overallToDelete} ref(s) from ${deletable.length} point(s)?`,
    ru: `Удалить ${overallToDelete} ключ(ей) от ${deletable.length} точ(ек)?`,
  });

  if (!confirm(message)) return;

  const items: Record<string, number> = {};
  const deletedGuids = new Set<string>();

  for (const feature of deletable) {
    const id = feature.getId();
    const properties = feature.getProperties?.();
    const amount = properties?.amount;
    if (typeof id === 'string' && typeof amount === 'number') {
      items[id] = amount;
      deletedGuids.add(id);
    }
  }

  try {
    const response = await deleteRefsFromServer(items);
    if (response.error) {
      console.error(`[SVP] ${MODULE_ID}: deletion error:`, response.error);
      return;
    }

    // Remove features from map
    for (const feature of deletable) {
      refsSource.removeFeature?.(feature);
    }

    // Update local cache
    removeRefsFromCache(deletedGuids);

    // Sync счётчика ключей на подписи затронутых точек на основной карте.
    // Хотя refsOnMap viewer прячет нативные слои на время viewer-режима,
    // после hideViewer() основной points-layer становится видимым - и
    // highlight['7'] на feature должен отражать актуальное число ключей.
    const affectedPointGuids = Array.from(
      new Set(
        deletable
          .map((feature) => {
            const properties = feature.getProperties?.();
            return typeof properties?.pointGuid === 'string' ? properties.pointGuid : null;
          })
          .filter((guid): guid is string => guid !== null),
      ),
    );
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

    const remainingProtected = [
      ...protectedByLock,
      ...protectedByOwnTeam,
      ...protectedByUnknownTeam,
    ];
    overallRefsToDelete = sumAmount(remainingProtected);
    uniqueRefsToDelete = remainingProtected.length;
    updateTrashCounter();
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
      if (batch.length >= TEAM_BATCH_SIZE) break;
    }
    const results = await Promise.all(
      batch.map(async (pointGuid) => {
        const team = await fetchPointTeam(pointGuid);
        return { pointGuid, team };
      }),
    );
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- checked between awaits, hideViewer мог выставить
    if (teamLoadAborted) break;
    for (const { pointGuid, team } of results) {
      if (team !== null) {
        teamCache.set(pointGuid, team);
        if (refsSource) {
          for (const feature of refsSource.getFeatures()) {
            const properties = feature.getProperties?.() ?? {};
            if (properties.pointGuid === pointGuid) {
              feature.set?.('team', team);
            }
          }
        }
      }
      teamLoadDone++;
    }
    updateProgress(teamLoadDone, teamLoadTotal);
    if (teamLoadQueue.size > 0) await delay(TEAM_BATCH_DELAY_MS);
  }

  teamLoadInProgress = false;
  if (!teamLoadAborted && teamLoadQueue.size === 0) {
    applyTeamsLoadedState();
  }
}

function resetTeamLoadState(): void {
  teamLoadQueue.clear();
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
  // Эфемерный сброс фильтра: новый viewer-сеанс всегда стартует с keepOwnTeam
  // выключенным, независимо от предыдущего сеанса. В localStorage флаг не
  // живёт - решение пользователя действует только до hideViewer.
  keepOwnTeam = false;
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

    const cachedTeam = teamCache.get(ref.l);
    if (cachedTeam !== undefined) {
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
  if (lockedNote) lockedNote.style.display = '';
  if (keepOwnTeamCheckbox) keepOwnTeamCheckbox.checked = false;
  if (keepOwnTeamLabel) keepOwnTeamLabel.style.display = 'none';
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
  keepOwnTeam = false;
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

  refsSource?.clear();

  overallRefsToDelete = 0;
  uniqueRefsToDelete = 0;
  updateTrashCounter();

  setGameLayersVisible(true);
  restoreGameUi();

  if (closeButton) closeButton.style.display = 'none';
  if (trashButton) trashButton.style.display = 'none';
  if (lockedNote) lockedNote.style.display = 'none';
  if (keepOwnTeamLabel) keepOwnTeamLabel.style.display = 'none';
  if (keepOwnTeamCheckbox) keepOwnTeamCheckbox.checked = false;

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

          // Trash/delete button
          trashButton = document.createElement('button');
          trashButton.className = 'svp-refs-on-map-trash';
          trashButton.style.display = 'none';
          trashButton.addEventListener('click', () => {
            void handleDeleteClick();
          });
          document.body.appendChild(trashButton);

          // Постоянная подсказка про защиту locked-точек: видна только в
          // viewer-режиме, чтобы пользователь сразу понимал, что часть
          // выбранного при удалении будет пропущена. Та же семантика
          // используется в slowRefsDelete и cleanupCalculator.
          lockedNote = document.createElement('div');
          lockedNote.className = 'svp-refs-on-map-locked-note';
          lockedNote.textContent = t({
            en: 'Keys of locked points are protected and not deleted',
            ru: 'Ключи locked-точек защищены и не удаляются',
          });
          lockedNote.style.display = 'none';
          document.body.appendChild(lockedNote);

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

          // Чекбокс "Не удалять свои" - inline в viewer-режиме, виден только
          // когда uniqueRefsToDelete > 0 (updateTrashCounter контролирует
          // visibility). State эфемерный: keepOwnTeam - module-level let,
          // сбрасывается в showViewer и в handleInviewResponse при появлении
          // новых guid'ов. В localStorage не сохраняется.
          keepOwnTeamLabel = document.createElement('label');
          keepOwnTeamLabel.className = 'svp-refs-on-map-keep-own';
          keepOwnTeamLabel.style.display = 'none';
          keepOwnTeamCheckbox = document.createElement('input');
          keepOwnTeamCheckbox.type = 'checkbox';
          keepOwnTeamCheckbox.checked = false;
          keepOwnTeamCheckbox.addEventListener('change', () => {
            keepOwnTeam = keepOwnTeamCheckbox?.checked === true;
          });
          const keepOwnTeamText = document.createElement('span');
          keepOwnTeamText.textContent = t({
            en: 'Keep own team',
            ru: 'Не удалять свои',
          });
          keepOwnTeamLabel.appendChild(keepOwnTeamCheckbox);
          keepOwnTeamLabel.appendChild(keepOwnTeamText);
          document.body.appendChild(keepOwnTeamLabel);
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

  if (lockedNote) {
    lockedNote.remove();
    lockedNote = null;
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
