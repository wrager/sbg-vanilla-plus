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
import type { IInventoryReferenceFull } from '../../core/inventoryTypes';
import { isInventoryReference } from '../../core/inventoryTypes';
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
let tabClickHandler: ((event: Event) => void) | null = null;
let mapClickHandler: ((event: IOlMapEvent) => void) | null = null;
let viewerOpen = false;
let beforeOpenZoom: number | undefined;
let beforeOpenRotation: number | undefined;
let beforeOpenFollow: string | null = null;
const teamCache = new Map<string, number>();
let teamLoadAborted = false;
let overallRefsToDelete = 0;
let uniqueRefsToDelete = 0;

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
  trashButton.textContent =
    uniqueRefsToDelete > 0
      ? `\uD83D\uDDD1\uFE0F ${uniqueRefsToDelete} (${overallRefsToDelete})`
      : '';
  trashButton.style.visibility = uniqueRefsToDelete > 0 ? 'visible' : 'hidden';
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

/**
 * Делит выбранные ref-фичи на разрешённые к удалению и защищённые
 * locked-флагом точки. Источник правды о защите - inventory-cache: для
 * каждой стопки бит 0b10 поля `f` означает «эта стопка locked»; в UI
 * семантика per-point - одна locked-стопка защищает все ключи точки от
 * удаления (тот же агрегатор, что в slowRefsDelete и cleanupCalculator).
 *
 * Свойство `pointGuid` фичи сравнивается с set'ом locked-точек; ref'ы без
 * pointGuid (теоретически возможны при сломанном кэше) трактуются как
 * unprotected, чтобы не блокировать удаление по неверной причине.
 */
function partitionByLockProtection(features: IOlFeature[]): {
  deletable: IOlFeature[];
  protectedRefs: IOlFeature[];
} {
  const cache = readInventoryCache();
  const lockedPointGuids = buildLockedPointGuids(cache);
  const deletable: IOlFeature[] = [];
  const protectedRefs: IOlFeature[] = [];
  for (const feature of features) {
    const properties = feature.getProperties?.() ?? {};
    const pointGuid = typeof properties.pointGuid === 'string' ? properties.pointGuid : null;
    if (pointGuid && lockedPointGuids.has(pointGuid)) {
      protectedRefs.push(feature);
    } else {
      deletable.push(feature);
    }
  }
  return { deletable, protectedRefs };
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

  // Защита locked: точки с замочком (бит 0b10 поля `f` любой стопки в
  // inventory-cache) не удаляются. Семантика общая для всех модулей,
  // работающих с массовым удалением ключей: refsOnMap, slowRefsDelete,
  // cleanupCalculator (см. README inventoryCleanup).
  const { deletable, protectedRefs } = partitionByLockProtection(selectedFeatures);

  if (deletable.length === 0) {
    showToast(
      t({
        en: 'All selected keys belong to locked points and cannot be deleted',
        ru: 'Все выбранные ключи относятся к locked-точкам и не могут быть удалены',
      }),
    );
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

    // Update inventory counter
    if (typeof response.count?.total === 'number') {
      updateInventoryCounter(response.count.total);
    }

    // Уведомление об оставленных locked: показываем после успешного удаления,
    // чтобы пользователь увидел итог в одном тосте, а не два диалога подряд.
    if (protectedRefs.length > 0) {
      showToast(
        t({
          en: `Locked points: ${protectedRefs.length} key(s) kept`,
          ru: `Locked-точки: ${protectedRefs.length} ключ(ей) оставлено`,
        }),
      );
    }

    overallRefsToDelete = sumAmount(protectedRefs);
    uniqueRefsToDelete = protectedRefs.length;
    updateTrashCounter();
  } catch (error) {
    console.error(`[SVP] ${MODULE_ID}: deletion failed:`, error);
  }
}

// ── team loading (per-ref) ───────────────────────────────────────────────────

async function loadTeamDataForRefs(refs: IInventoryReferenceFull[]): Promise<void> {
  // Collect unique point GUIDs that aren't cached
  const pointGuids = new Set<string>();
  for (const ref of refs) {
    if (!teamCache.has(ref.l)) {
      pointGuids.add(ref.l);
    }
  }
  const uncachedGuids = Array.from(pointGuids);
  teamLoadAborted = false;

  for (let i = 0; i < uncachedGuids.length; i += TEAM_BATCH_SIZE) {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- checked between awaits
    if (teamLoadAborted) return;
    const batch = uncachedGuids.slice(i, i + TEAM_BATCH_SIZE);
    const results = await Promise.all(
      batch.map(async (pointGuid) => {
        const team = await fetchPointTeam(pointGuid);
        return { pointGuid, team };
      }),
    );

    for (const { pointGuid, team } of results) {
      if (team !== null) {
        teamCache.set(pointGuid, team);
        // Update all features belonging to this point
        if (refsSource) {
          for (const feature of refsSource.getFeatures()) {
            const properties = feature.getProperties?.() ?? {};
            if (properties.pointGuid === pointGuid) {
              feature.set?.('team', team);
            }
          }
        }
      }
    }

    if (i + TEAM_BATCH_SIZE < uncachedGuids.length) {
      await delay(TEAM_BATCH_DELAY_MS);
    }
  }
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

  if (closeButton) closeButton.style.display = '';
  if (trashButton) {
    trashButton.style.visibility = 'hidden';
    trashButton.style.display = '';
  }
  if (lockedNote) lockedNote.style.display = '';

  // Attach click handler for selection
  mapClickHandler = handleMapClick;
  olMap.on?.('click', mapClickHandler);

  void loadTeamDataForRefs(refs);
}

function hideViewer(): void {
  if (!viewerOpen) return;
  viewerOpen = false;
  teamLoadAborted = true;

  // Remove click handler
  if (olMap && mapClickHandler) {
    olMap.un?.('click', mapClickHandler);
    mapClickHandler = null;
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
    en: 'View and manage points with collected keys on the map at any zoom level. Keys of points marked with the native lock (SBG 0.6.1+) are protected and not deleted - same semantics as in the inventoryCleanup module.',
    ru: 'Просмотр и управление точками с ключами на карте на любом масштабе. Ключи точек, помеченных нативным замочком (SBG 0.6.1+), защищены и не удаляются - та же семантика, что и в модуле inventoryCleanup.',
  },
  defaultEnabled: true,
  category: 'feature',

  init() {},

  enable() {
    injectStyles(css, MODULE_ID);

    return getOlMap().then(
      (map) => {
        try {
          const ol = window.ol;
          const OlVectorSource = ol?.source?.Vector;
          const OlVectorLayer = ol?.layer?.Vector;
          if (!OlVectorSource || !OlVectorLayer) return;

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
