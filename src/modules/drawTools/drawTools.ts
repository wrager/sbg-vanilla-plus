import type { IFeatureModule } from '../../core/moduleRegistry';
import { injectStyles, removeStyles, waitForElement } from '../../core/dom';
import { t } from '../../core/l10n';
import { showToast } from '../../core/toast';
import { findLayerByName, getOlMap } from '../../core/olMap';
import type {
  IOlFeature,
  IOlInteraction,
  IOlLayer,
  IOlMap,
  IOlMapEvent,
  IOlVectorSource,
} from '../../core/olMap';
import { IitcParseError, parseIitcDrawItems, stringifyIitcDrawItems } from './iitcFormat';
import type { IIitcDrawItem, IIitcLatLng } from './iitcFormat';
import {
  ICON_CLOSE_X,
  ICON_COPY,
  ICON_DELETE,
  ICON_DRAW_TOOLS,
  ICON_EDIT,
  ICON_LINE,
  ICON_RESET,
  ICON_TRIANGLE,
  ICON_UPLOAD,
  ICON_WAND,
} from './drawToolsIcons';
import styles from './styles.css?inline';

const MODULE_ID = 'drawTools';
const STORAGE_KEY = 'svp_drawTools';
const DRAW_LAYER_NAME = 'svp-draw-tools';
// Поверх всех игровых и SVP-слоёв (refsOnMap топовый = 8, keyCountOnPoints = 5).
const DRAW_LAYER_Z_INDEX = 9;
const SNAP_THRESHOLD_PX = 100;
const DEFAULT_COLOR = '#a24ac3';
const REGION_PICKER_SELECTOR = '.region-picker.ol-unselectable.ol-control';
const CONTROL_BUTTON_ID = 'svp-draw-tools-menu-button';

type ToolMode = 'none' | 'line' | 'polygon' | 'edit' | 'delete';

type FeatureWithProps = IOlFeature & {
  get?(key: string): unknown;
  set?(key: string, value: unknown): void;
};

interface IVectorSourceWithRemove extends IOlVectorSource {
  removeFeature?(feature: IOlFeature): void;
}

interface ILineGeometry {
  getType(): 'LineString';
  getCoordinates(): number[][];
  setCoordinates(coordinates: number[][]): void;
}

interface IPolygonGeometry {
  getType(): 'Polygon';
  getCoordinates(): number[][][];
  setCoordinates(coordinates: number[][][]): void;
}

interface IObservableInteraction extends IOlInteraction {
  on?(type: string, listener: (event: Record<string, unknown>) => void): void;
  un?(type: string, listener: (event: Record<string, unknown>) => void): void;
  abortDrawing?(): void;
}

interface ISnapCandidate {
  portalIndex: number;
  distancePx: number;
}

interface IVertexSnap {
  vertexIndex: number;
  candidates: ISnapCandidate[];
}

let map: IOlMap | null = null;
let drawSource: IVectorSourceWithRemove | null = null;
let drawLayer: IOlLayer | null = null;

let controlElement: HTMLDivElement | null = null;
let pickerElement: HTMLElement | null = null;
let controlMutationObserver: MutationObserver | null = null;
let controlResizeObserver: ResizeObserver | null = null;
let windowResizeHandler: (() => void) | null = null;
let toolbar: HTMLDivElement | null = null;
let copyModalOverlay: HTMLDivElement | null = null;
let copyModalKeydownHandler: ((event: KeyboardEvent) => void) | null = null;
let documentClickHandler: ((event: MouseEvent) => void) | null = null;
let pointPopupObserver: MutationObserver | null = null;
let lineButton: HTMLButtonElement | null = null;
let polygonButton: HTMLButtonElement | null = null;
let editButton: HTMLButtonElement | null = null;
let deleteButton: HTMLButtonElement | null = null;
let colorInput: HTMLInputElement | null = null;

let currentMode: ToolMode = 'none';
let currentColor = DEFAULT_COLOR;

let drawInteraction: IObservableInteraction | null = null;
let modifyInteraction: IObservableInteraction | null = null;
let deleteClickHandler: ((event: IOlMapEvent) => void) | null = null;
let drawEndHandler: ((event: Record<string, unknown>) => void) | null = null;
let modifyEndHandler: ((event: Record<string, unknown>) => void) | null = null;
let enableToken = 0;
let keydownHandler: ((event: KeyboardEvent) => void) | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isNumberPair(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    typeof value[0] === 'number' &&
    typeof value[1] === 'number'
  );
}

function isLineGeometry(value: unknown): value is ILineGeometry {
  if (!isRecord(value)) return false;
  const getType = value.getType;
  const getCoordinates = value.getCoordinates;
  const setCoordinates = value.setCoordinates;
  return (
    typeof getType === 'function' &&
    (getType as () => unknown)() === 'LineString' &&
    typeof getCoordinates === 'function' &&
    typeof setCoordinates === 'function'
  );
}

function isPolygonGeometry(value: unknown): value is IPolygonGeometry {
  if (!isRecord(value)) return false;
  const getType = value.getType;
  const getCoordinates = value.getCoordinates;
  const setCoordinates = value.setCoordinates;
  return (
    typeof getType === 'function' &&
    (getType as () => unknown)() === 'Polygon' &&
    typeof getCoordinates === 'function' &&
    typeof setCoordinates === 'function'
  );
}

function setFeatureColor(feature: IOlFeature, color: string): void {
  const withProps = feature as FeatureWithProps;
  withProps.set?.('color', color);
}

function getFeatureColor(feature: IOlFeature): string {
  const withProps = feature as FeatureWithProps;
  const value = withProps.get?.('color');
  return typeof value === 'string' ? value : DEFAULT_COLOR;
}

function getLatLngFromCoordinate(coordinate: number[]): IIitcLatLng {
  if (typeof window.ol?.proj?.toLonLat !== 'function') {
    return { lat: coordinate[1], lng: coordinate[0] };
  }
  const lonLat = window.ol.proj.toLonLat(coordinate);
  return { lat: lonLat[1], lng: lonLat[0] };
}

function getCoordinateFromLatLng(latLng: IIitcLatLng): number[] {
  const lonLat = [latLng.lng, latLng.lat];
  if (typeof window.ol?.proj?.fromLonLat !== 'function') return lonLat;
  return window.ol.proj.fromLonLat(lonLat);
}

function equalLatLng(a: IIitcLatLng, b: IIitcLatLng): boolean {
  return Math.abs(a.lat - b.lat) < 0.0000001 && Math.abs(a.lng - b.lng) < 0.0000001;
}

function serializeFeature(feature: IOlFeature): IIitcDrawItem | null {
  const geometry: unknown = feature.getGeometry();
  const color = getFeatureColor(feature);

  if (isLineGeometry(geometry)) {
    const latLngs = geometry.getCoordinates().map(getLatLngFromCoordinate);
    return { type: 'polyline', latLngs, color };
  }

  if (isPolygonGeometry(geometry)) {
    const ring = geometry.getCoordinates()[0] ?? [];
    const latLngs = ring.map(getLatLngFromCoordinate);
    if (latLngs.length >= 2 && equalLatLng(latLngs[0], latLngs[latLngs.length - 1])) {
      latLngs.pop();
    }
    return { type: 'polygon', latLngs, color };
  }

  return null;
}

function getDrawItems(): IIitcDrawItem[] {
  if (!drawSource) return [];
  const items: IIitcDrawItem[] = [];
  for (const feature of drawSource.getFeatures()) {
    const item = serializeFeature(feature);
    if (item) items.push(item);
  }
  return items;
}

function saveDrawItems(): void {
  localStorage.setItem(STORAGE_KEY, stringifyIitcDrawItems(getDrawItems()));
}

function getStorageRaw(): string {
  return localStorage.getItem(STORAGE_KEY) ?? '[]';
}

function clearDrawLayer(): void {
  drawSource?.clear();
}

function ensurePolygonClosed(latLngs: IIitcLatLng[]): IIitcLatLng[] {
  const first = latLngs[0];
  const last = latLngs[latLngs.length - 1];
  if (equalLatLng(first, last)) return latLngs;
  return [...latLngs, first];
}

function importDrawItems(items: IIitcDrawItem[]): void {
  const OlFeature = window.ol?.Feature;
  const OlLineString = window.ol?.geom?.LineString;
  const OlPolygon = window.ol?.geom?.Polygon;
  if (!drawSource || !OlFeature || !OlLineString || !OlPolygon) return;

  for (const item of items) {
    if (item.type === 'polyline') {
      const coordinates = item.latLngs.map(getCoordinateFromLatLng);
      const geometry = new OlLineString(coordinates);
      const feature = new OlFeature({ geometry });
      setFeatureColor(feature, item.color ?? DEFAULT_COLOR);
      drawSource.addFeature(feature);
      continue;
    }

    const closed = ensurePolygonClosed(item.latLngs);
    const coordinates = closed.map(getCoordinateFromLatLng);
    const geometry = new OlPolygon([coordinates]);
    const feature = new OlFeature({ geometry });
    setFeatureColor(feature, item.color ?? DEFAULT_COLOR);
    drawSource.addFeature(feature);
  }
}

function loadFromStorage(): void {
  const raw = getStorageRaw();
  try {
    const items = parseIitcDrawItems(raw);
    clearDrawLayer();
    importDrawItems(items);
  } catch {
    // Сторадж испорчен (ручная правка / несовместимая миграция / посторонний writer).
    // Сбрасываем в []: модуль остаётся рабочим, а saveDrawItems() при первом же
    // действии пользователя всё равно перезапишет его текущим состоянием.
    clearDrawLayer();
    localStorage.setItem(STORAGE_KEY, '[]');
  }
}

function createStyleFunction(): ((feature: IOlFeature) => unknown) | null {
  const styleApi = window.ol?.style;
  if (!styleApi?.Style || !styleApi.Stroke || !styleApi.Fill) return null;

  const OlStyle = styleApi.Style;
  const OlStroke = styleApi.Stroke;
  const OlFill = styleApi.Fill;

  return (feature: IOlFeature): unknown => {
    const color = getFeatureColor(feature);
    const geometry: unknown = feature.getGeometry();
    const isPolygon = isPolygonGeometry(geometry);

    return new OlStyle({
      stroke: new OlStroke({ color, width: 4 }),
      fill: new OlFill({ color: isPolygon ? color + '33' : 'transparent' }),
    });
  };
}

function createDrawInteractionStyle(color: string): unknown[] | undefined {
  const styleApi = window.ol?.style;
  if (!styleApi?.Style || !styleApi.Stroke || !styleApi.Fill || !styleApi.Circle) {
    return undefined;
  }

  const OlStyle = styleApi.Style;
  const OlStroke = styleApi.Stroke;
  const OlFill = styleApi.Fill;
  const OlCircle = styleApi.Circle;

  return [
    new OlStyle({
      stroke: new OlStroke({ color, width: 4 }),
      fill: new OlFill({ color: color + '33' }),
      image: new OlCircle({
        radius: 5,
        fill: new OlFill({ color }),
        stroke: new OlStroke({ color, width: 2 }),
      }),
    }),
  ];
}

function createDrawLayer(olMap: IOlMap): void {
  const OlVectorSource = window.ol?.source?.Vector;
  const OlVectorLayer = window.ol?.layer?.Vector;
  if (!OlVectorSource || !OlVectorLayer) {
    throw new Error('OL Vector API is unavailable');
  }

  const source = new OlVectorSource();
  const style = createStyleFunction();
  drawSource = source as IVectorSourceWithRemove;
  drawLayer = new OlVectorLayer({
    source,
    name: DRAW_LAYER_NAME,
    zIndex: DRAW_LAYER_Z_INDEX,
    style: style ?? undefined,
  });

  olMap.addLayer(drawLayer);
}

function removeDrawLayer(): void {
  if (map && drawLayer) {
    map.removeLayer(drawLayer);
  }
  drawLayer = null;
  drawSource = null;
}

function updateModeButtons(): void {
  const defs: Array<[ToolMode, HTMLButtonElement | null]> = [
    ['line', lineButton],
    ['polygon', polygonButton],
    ['edit', editButton],
    ['delete', deleteButton],
  ];

  for (const [mode, button] of defs) {
    if (!button) continue;
    button.classList.toggle('svp-draw-tools-tool-active', currentMode === mode);
  }
}

function cancelActiveDrawing(): void {
  if (currentMode !== 'line' && currentMode !== 'polygon') return;
  if (!drawInteraction) return;

  if (typeof drawInteraction.abortDrawing === 'function') {
    drawInteraction.abortDrawing();
    return;
  }

  // Fallback for OL variants without abortDrawing: recreate current draw interaction.
  setMode(currentMode, true);
}

function clearInteractions(): void {
  if (!map) return;

  if (drawInteraction) {
    if (drawEndHandler) {
      drawInteraction.un?.('drawend', drawEndHandler);
    }
    map.removeInteraction?.(drawInteraction);
    drawInteraction = null;
    drawEndHandler = null;
  }

  if (modifyInteraction) {
    if (modifyEndHandler) {
      modifyInteraction.un?.('modifyend', modifyEndHandler);
    }
    map.removeInteraction?.(modifyInteraction);
    modifyInteraction = null;
    modifyEndHandler = null;
  }

  if (deleteClickHandler) {
    map.un?.('click', deleteClickHandler);
    deleteClickHandler = null;
  }
}

function setMode(mode: ToolMode, force = false): void {
  if (!force && currentMode === mode) {
    mode = 'none';
  }

  clearInteractions();
  currentMode = mode;
  updateModeButtons();

  if (!map || !drawSource || mode === 'none') return;

  const interactionApi = window.ol?.interaction;
  if (!interactionApi) return;

  if (mode === 'line' || mode === 'polygon') {
    const DrawCtor = interactionApi.Draw;
    if (!DrawCtor) return;
    const maxPoints = mode === 'line' ? 2 : 3;

    drawInteraction = new DrawCtor({
      source: drawSource,
      type: mode === 'line' ? 'LineString' : 'Polygon',
      maxPoints,
      style: createDrawInteractionStyle(currentColor),
    }) as IObservableInteraction;

    drawEndHandler = (event: Record<string, unknown>) => {
      // OL Draw 'drawend' гарантирует event.feature: Feature
      setFeatureColor(event.feature as IOlFeature, currentColor);
      saveDrawItems();
    };

    drawInteraction.on?.('drawend', drawEndHandler);
    map.addInteraction?.(drawInteraction);
    return;
  }

  if (mode === 'edit') {
    const ModifyCtor = interactionApi.Modify;
    if (!ModifyCtor) return;

    // Разрешаем только перетаскивание существующих вершин.
    // Вставку новых вершин кликом по сегменту отключаем.
    modifyInteraction = new ModifyCtor({
      source: drawSource,
      insertVertexCondition: () => false,
    }) as IObservableInteraction;
    modifyEndHandler = () => {
      saveDrawItems();
    };
    modifyInteraction.on?.('modifyend', modifyEndHandler);
    map.addInteraction?.(modifyInteraction);
    return;
  }

  deleteClickHandler = (event: IOlMapEvent) => {
    if (!map?.forEachFeatureAtPixel || !drawSource) return;
    const source = drawSource;
    map.forEachFeatureAtPixel(
      event.pixel,
      (feature) => {
        source.removeFeature?.(feature);
      },
      {
        hitTolerance: 6,
        layerFilter: (layer) => layer.get('name') === DRAW_LAYER_NAME,
      },
    );
    saveDrawItems();
  };

  map.on?.('click', deleteClickHandler);
}

function addEscCancelListener(): void {
  if (keydownHandler) return;
  keydownHandler = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return;
    cancelActiveDrawing();
  };
  document.addEventListener('keydown', keydownHandler);
}

function removeEscCancelListener(): void {
  if (!keydownHandler) return;
  document.removeEventListener('keydown', keydownHandler);
  keydownHandler = null;
}

function isInsideMap(target: Node): boolean {
  // `#map` — корневой div игровой OL-карты (см. refs/game/dom/body.html).
  // Любой клик по карте: на canvas, на overlay-стопэвент, на zoom-кнопках —
  // считаем «по карте», тулбар не закрываем, чтобы не мешать рисованию/панорамированию.
  const mapElement = document.getElementById('map');
  return mapElement !== null && mapElement.contains(target);
}

function addToolbarOutsideClickListener(): void {
  if (documentClickHandler) return;
  documentClickHandler = (event: MouseEvent): void => {
    if (!toolbar?.classList.contains('svp-draw-tools-toolbar-open')) return;
    const target = event.target;
    if (!(target instanceof Node)) return;
    // Клик по тулбару (кнопки внутри) — пользователь продолжает работать с инструментами.
    if (toolbar.contains(target)) return;
    // Клик по DT-кнопке — её собственный handler делает toggle; чтобы наш
    // handler не закрывал тулбар прежде, чем toggle снова откроет его, выходим.
    if (controlElement?.contains(target)) return;
    // Клик по карте — рисование, удаление по клику, панорамирование. Не закрывать.
    if (isInsideMap(target)) return;
    // Клик по кнопке СЛ (`#toggle-follow-btn`): часто переключается во время
    // рисования, чтобы карта следовала за игроком или нет; тулбар при этом
    // остаётся открытым.
    const followButton = document.getElementById('toggle-follow-btn');
    if (followButton !== null && followButton.contains(target)) return;
    // Клик/тап по нашему собственному тосту (`.svp-toast`): тосты модуля
    // показывают результат действий («Схема скопирована», «Импорт выполнен»),
    // и попадание тапом по ним при попытке прицелиться в тулбар не должно
    // закрывать тулбар.
    const toast = target instanceof Element ? target.closest('.svp-toast') : null;
    if (toast !== null) return;
    setToolbarOpen(false);
    setMode('none');
  };
  document.addEventListener('click', documentClickHandler);
}

function removeToolbarOutsideClickListener(): void {
  if (!documentClickHandler) return;
  document.removeEventListener('click', documentClickHandler);
  documentClickHandler = null;
}

function addPointPopupOpenListener(): void {
  if (pointPopupObserver) return;
  const popup = document.querySelector('.info.popup');
  if (!(popup instanceof HTMLElement)) return;

  // Игра скрывает/показывает попап точки переключением класса `hidden` на
  // `.info.popup` (см. `popup.classList.remove('hidden')` в game/script.js).
  // Клик по точке на карте сначала пройдёт через наш map-exempt в outside-click
  // handler'е (тулбар не закроется), а затем игра откроет попап — наблюдатель
  // ловит этот переход и закрывает тулбар, чтобы не перекрывать попап.
  let wasHidden = popup.classList.contains('hidden');
  pointPopupObserver = new MutationObserver(() => {
    const isHidden = popup.classList.contains('hidden');
    if (wasHidden && !isHidden) {
      if (toolbar?.classList.contains('svp-draw-tools-toolbar-open')) {
        setToolbarOpen(false);
        setMode('none');
      }
    }
    wasHidden = isHidden;
  });
  pointPopupObserver.observe(popup, { attributes: true, attributeFilter: ['class'] });
}

function removePointPopupOpenListener(): void {
  pointPopupObserver?.disconnect();
  pointPopupObserver = null;
}

function buildVertexSnaps(vertices: number[][], portalCoordinates: number[][]): IVertexSnap[] {
  const currentMap = map;
  if (!currentMap || !currentMap.getPixelFromCoordinate) return [];
  const convertToPixel = currentMap.getPixelFromCoordinate.bind(currentMap);

  const portalPixels = portalCoordinates.map((coord) => {
    const px = convertToPixel(coord);
    return isNumberPair(px) ? px : null;
  });

  const snaps: IVertexSnap[] = [];

  for (let vertexIndex = 0; vertexIndex < vertices.length; vertexIndex++) {
    const vertexPixel = convertToPixel(vertices[vertexIndex]);
    if (!isNumberPair(vertexPixel)) continue;

    const candidates: ISnapCandidate[] = [];

    for (let portalIndex = 0; portalIndex < portalCoordinates.length; portalIndex++) {
      const portalPixel = portalPixels[portalIndex];
      if (!portalPixel) continue;

      const dx = portalPixel[0] - vertexPixel[0];
      const dy = portalPixel[1] - vertexPixel[1];
      const distancePx = Math.sqrt(dx * dx + dy * dy);

      if (distancePx <= SNAP_THRESHOLD_PX) {
        candidates.push({ portalIndex, distancePx });
      }
    }

    candidates.sort((a, b) => a.distancePx - b.distancePx);
    snaps.push({ vertexIndex, candidates });
  }

  // Process vertex with smallest best-candidate distance first (greedy by proximity)
  snaps.sort((a, b) => {
    const bestA = a.candidates[0]?.distancePx ?? Infinity;
    const bestB = b.candidates[0]?.distancePx ?? Infinity;
    return bestA - bestB;
  });

  return snaps;
}

function snapVertices(
  vertices: number[][],
  portalCoordinates: number[][],
): { result: number[][]; moved: number } {
  const result = vertices.map((v) => [...v]);
  const snaps = buildVertexSnaps(vertices, portalCoordinates);
  const claimedPortals = new Set<number>();
  let moved = 0;

  for (const snap of snaps) {
    for (const candidate of snap.candidates) {
      if (!claimedPortals.has(candidate.portalIndex)) {
        result[snap.vertexIndex] = portalCoordinates[candidate.portalIndex];
        claimedPortals.add(candidate.portalIndex);
        moved++;
        break;
      }
    }
  }

  return { result, moved };
}

function getPortalCoordinates(): number[][] {
  if (!map) return [];

  const pointsLayer = findLayerByName(map, 'points');
  const source = pointsLayer?.getSource();
  if (!source) return [];

  const result: number[][] = [];
  for (const feature of source.getFeatures()) {
    const coordinates = feature.getGeometry().getCoordinates();
    if (isNumberPair(coordinates)) {
      result.push([coordinates[0], coordinates[1]]);
    }
  }
  return result;
}

function snapAllToPortals(): void {
  if (!drawSource) return;

  const portalCoordinates = getPortalCoordinates();
  if (portalCoordinates.length === 0) {
    showToast(t({ en: 'No visible portals for snap', ru: 'Нет видимых точек для привязки' }));
    return;
  }

  let moved = 0;

  for (const feature of drawSource.getFeatures()) {
    const geometry: unknown = feature.getGeometry();

    if (isLineGeometry(geometry)) {
      const { result, moved: count } = snapVertices(geometry.getCoordinates(), portalCoordinates);
      geometry.setCoordinates(result);
      moved += count;
      continue;
    }

    if (isPolygonGeometry(geometry)) {
      const ring = geometry.getCoordinates()[0] ?? [];
      // Strip the closing vertex that OpenLayers adds to close the ring
      const isClosedRing =
        ring.length > 1 &&
        ring[0][0] === ring[ring.length - 1][0] &&
        ring[0][1] === ring[ring.length - 1][1];
      const openRing = isClosedRing ? ring.slice(0, -1) : ring;
      const { result, moved: count } = snapVertices(openRing, portalCoordinates);
      // Re-close the ring after snapping
      const closedResult = isClosedRing && result.length > 0 ? [...result, result[0]] : result;
      geometry.setCoordinates([closedResult]);
      moved += count;
    }
  }

  if (moved > 0) {
    saveDrawItems();
  }

  showToast(
    t({
      en: `Snap complete: vertices moved — ${moved}`,
      ru: `Привязка завершена: перемещено вершин — ${moved}`,
    }),
  );
}

function closeCopyFallbackModal(): void {
  if (copyModalKeydownHandler) {
    document.removeEventListener('keydown', copyModalKeydownHandler);
    copyModalKeydownHandler = null;
  }
  if (copyModalOverlay) {
    copyModalOverlay.remove();
    copyModalOverlay = null;
  }
}

function showCopyFallbackModal(text: string): void {
  // Повторный клик при уже открытой модалке закрывает старую и открывает
  // новую — иначе в DOM накапливались бы дубликаты overlay'ев.
  closeCopyFallbackModal();

  const overlay = document.createElement('div');
  overlay.className = 'svp-draw-tools-copy-modal-overlay';

  const modal = document.createElement('div');
  modal.className = 'svp-draw-tools-copy-modal';

  const heading = document.createElement('div');
  heading.className = 'svp-draw-tools-copy-modal-heading';
  heading.textContent = t({
    en: 'Copy this JSON',
    ru: 'Скопируйте JSON',
  });

  const textarea = document.createElement('textarea');
  textarea.className = 'svp-draw-tools-copy-textarea';
  textarea.readOnly = true;
  textarea.value = text;

  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'svp-draw-tools-copy-modal-close';
  closeButton.textContent = t({ en: 'Close', ru: 'Закрыть' });
  closeButton.addEventListener('click', closeCopyFallbackModal);

  modal.append(heading, textarea, closeButton);
  overlay.appendChild(modal);

  // Клик на оверлей (но не на сам modal) закрывает.
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) closeCopyFallbackModal();
  });

  copyModalKeydownHandler = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return;
    closeCopyFallbackModal();
  };
  document.addEventListener('keydown', copyModalKeydownHandler);

  document.body.appendChild(overlay);
  copyModalOverlay = overlay;

  // Автовыделение всего содержимого: пользователю остаётся только Ctrl+C
  // (или long-press copy на мобильном).
  textarea.focus();
  textarea.select();
}

async function copyDrawPlan(): Promise<void> {
  const raw = stringifyIitcDrawItems(getDrawItems());

  try {
    await navigator.clipboard.writeText(raw);
    showToast(t({ en: 'Copied draw plan', ru: 'Схема скопирована' }));
    return;
  } catch {
    // Clipboard API недоступен (HTTP-контекст, отозванное разрешение): даём
    // ручной путь — модалка с textarea и автовыделением.
    showCopyFallbackModal(raw);
  }
}

function formatValue(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  try {
    return JSON.stringify(value);
  } catch {
    return '<unserializable>';
  }
}

function importErrorDetail(error: unknown): { en: string; ru: string } {
  if (!(error instanceof IitcParseError)) {
    return { en: 'invalid data', ru: 'некорректные данные' };
  }
  const { reason, path, value } = error;
  switch (reason) {
    case 'invalid_json':
      return { en: 'invalid JSON', ru: 'некорректный JSON' };
    case 'not_array':
      return { en: 'expected an array of items', ru: 'ожидается массив элементов' };
    case 'not_object':
      return {
        en: `${path} — item must be an object`,
        ru: `${path} — фигура должна быть объектом`,
      };
    case 'unsupported_type':
      return {
        en: `${path} — unsupported type ${formatValue(value)}`,
        ru: `${path} — неподдерживаемый тип фигуры ${formatValue(value)}`,
      };
    case 'lat_lngs_not_array':
      return {
        en: `${path} — latLngs must be an array`,
        ru: `${path} — координаты должны быть массивом`,
      };
    case 'polyline_too_few_points':
      return {
        en: `${path} — line needs at least 2 points, got ${String(value)}`,
        ru: `${path} — для линии нужно минимум 2 точки, передано ${String(value)}`,
      };
    case 'polygon_too_few_points':
      return {
        en: `${path} — triangle needs at least 3 points, got ${String(value)}`,
        ru: `${path} — для треугольника нужно минимум 3 точки, передано ${String(value)}`,
      };
    case 'invalid_coordinates':
      return {
        en: `${path} — invalid coordinate ${formatValue(value)}`,
        ru: `${path} — некорректные координаты ${formatValue(value)}`,
      };
    case 'invalid_color':
      return {
        en: `${path} — invalid color ${formatValue(value)} (expected #RRGGBB or #RGB)`,
        ru: `${path} — некорректный цвет ${formatValue(value)} (требуется #RRGGBB или #RGB)`,
      };
  }
}

function pasteDrawPlan(): void {
  const raw = window.prompt(
    t({
      en: 'Paste IITC draw-tools JSON',
      ru: 'Вставьте JSON draw-tools (IITC)',
    }),
    '',
  );

  if (!raw) return;

  let items: IIitcDrawItem[];
  try {
    items = parseIitcDrawItems(raw.trim());
  } catch (error) {
    const detail = importErrorDetail(error);
    showToast(t({ en: `Import failed: ${detail.en}`, ru: `Импорт не удался: ${detail.ru}` }));
    return;
  }

  const hasData = (drawSource?.getFeatures().length ?? 0) > 0;
  if (hasData) {
    const ok = confirm(
      t({
        en: 'Replace current draw plan with imported data?',
        ru: 'Заменить текущую схему импортированной?',
      }),
    );
    if (!ok) return;
  }

  clearDrawLayer();
  importDrawItems(items);
  saveDrawItems();
  showToast(t({ en: 'Import successful', ru: 'Импорт выполнен' }));
}

function resetDrawPlan(): void {
  const hasData = (drawSource?.getFeatures().length ?? 0) > 0;
  if (!hasData) return;

  const ok = confirm(
    t({
      en: 'Delete all drawn items?',
      ru: 'Удалить всю нарисованную схему?',
    }),
  );
  if (!ok) return;

  clearDrawLayer();
  saveDrawItems();
  showToast(t({ en: 'Draw plan cleared', ru: 'Схема очищена' }));
}

function setToolbarOpen(open: boolean): void {
  if (!toolbar) return;
  toolbar.classList.toggle('svp-draw-tools-toolbar-open', open);
}

function toggleToolbar(): void {
  if (!toolbar) return;
  setToolbarOpen(!toolbar.classList.contains('svp-draw-tools-toolbar-open'));
}

function applySvgIcon(button: HTMLElement, svgString: string): void {
  // DOMParser сохраняет SVG-namespace при парсинге, в отличие от innerHTML
  // в HTML-контексте. importNode копирует ноду в текущий документ, чтобы
  // appendChild не работал с deatched-документом DOMParser'а.
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgString, 'image/svg+xml');
  const root = doc.documentElement;
  if (root.tagName.toLowerCase() !== 'svg') return;
  button.textContent = '';
  button.appendChild(document.importNode(root, true));
}

function createToolButton(iconSvg: string, title: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'svp-draw-tools-tool-button';
  button.title = title;
  button.addEventListener('click', onClick);
  applySvgIcon(button, iconSvg);
  return button;
}

function createToolbar(): HTMLDivElement {
  const panel = document.createElement('div');
  panel.className = 'svp-draw-tools-toolbar';

  lineButton = createToolButton(ICON_LINE, t({ en: 'Line', ru: 'Линия' }), () => {
    setMode('line');
  });
  polygonButton = createToolButton(ICON_TRIANGLE, t({ en: 'Triangle', ru: 'Треугольник' }), () => {
    setMode('polygon');
  });
  editButton = createToolButton(ICON_EDIT, t({ en: 'Edit', ru: 'Редактирование' }), () => {
    setMode('edit');
  });

  deleteButton = createToolButton(ICON_DELETE, t({ en: 'Delete mode', ru: 'Удаление' }), () => {
    setMode('delete');
  });

  colorInput = document.createElement('input');
  colorInput.type = 'color';
  colorInput.className = 'svp-draw-tools-color';
  colorInput.value = currentColor;
  colorInput.title = t({ en: 'Color', ru: 'Цвет' });
  colorInput.addEventListener('input', () => {
    if (!colorInput) return;
    currentColor = colorInput.value;
  });

  const snapButton = createToolButton(
    ICON_WAND,
    t({ en: 'Snap all to nearest portals (100px)', ru: 'Привязать к ближайшим точкам (100px)' }),
    snapAllToPortals,
  );

  const copyButton = createToolButton(
    ICON_COPY,
    t({ en: 'Copy JSON', ru: 'Копировать JSON' }),
    () => {
      void copyDrawPlan();
    },
  );

  const pasteButton = createToolButton(
    ICON_UPLOAD,
    t({ en: 'Paste JSON', ru: 'Вставить JSON' }),
    pasteDrawPlan,
  );

  const resetButton = createToolButton(
    ICON_RESET,
    t({ en: 'Clear all', ru: 'Очистить всё' }),
    resetDrawPlan,
  );

  const closeButton = createToolButton(ICON_CLOSE_X, t({ en: 'Close', ru: 'Закрыть' }), () => {
    setToolbarOpen(false);
    setMode('none');
  });
  closeButton.classList.add('svp-draw-tools-close-button');

  panel.append(
    lineButton,
    polygonButton,
    editButton,
    deleteButton,
    colorInput,
    snapButton,
    copyButton,
    pasteButton,
    resetButton,
    closeButton,
  );

  return panel;
}

function syncControlPosition(): void {
  if (!controlElement || !pickerElement) return;
  const rect = pickerElement.getBoundingClientRect();
  // Если picker скрыт (rect нулевой) — не двигаем control, оставляем последнюю
  // валидную позицию. Иначе при кратком re-render игрой control мигнул бы в
  // верхний левый угол.
  if (rect.width === 0 && rect.height === 0) return;
  // OL-controls в игре выстроены вертикально вплотную (zoom-in / zoom-out /
  // region-picker / ...) — ставим наш control сразу под region-picker, чтобы
  // визуально продолжить колонку.
  controlElement.style.top = `${rect.bottom}px`;
  controlElement.style.right = `${window.innerWidth - rect.right}px`;
  controlElement.style.left = 'auto';
  controlElement.style.bottom = 'auto';
}

function createControlElement(): HTMLDivElement {
  // Структура повторяет .region-picker (div.ol-unselectable.ol-control > button),
  // чтобы наследовать игровые стили OL-кнопок. Класс region-picker НЕ
  // навешиваем: игра через jQuery делегирует на все .region-picker свой
  // toggle регионов, наш control не должен туда попасть.
  const element = document.createElement('div');
  element.className = 'svp-draw-tools-control ol-unselectable ol-control';
  element.style.position = 'fixed';

  const button = document.createElement('button');
  button.type = 'button';
  button.id = CONTROL_BUTTON_ID;
  button.className = 'svp-draw-tools-control-button';
  button.title = t({ en: 'Draw tools', ru: 'Инструменты рисования' });
  button.addEventListener('click', toggleToolbar);
  applySvgIcon(button, ICON_DRAW_TOOLS);

  element.appendChild(button);
  return element;
}

async function mountOlControl(myToken: number): Promise<boolean> {
  let picker = document.querySelector<HTMLElement>(REGION_PICKER_SELECTOR);
  if (!picker) {
    const found = await waitForElement(REGION_PICKER_SELECTOR);
    // После await токен мог инвалидироваться (disable во время ожидания).
    // Бросаем работу до любых записей в DOM/глобалы — иначе текущий enable
    // перезапишет ресурсы более позднего enable, который уже отработал.
    if (myToken !== enableToken) return false;
    if (!(found instanceof HTMLElement)) {
      throw new Error('Region picker not found');
    }
    picker = found;
  }

  pickerElement = picker;
  controlElement = createControlElement();
  picker.after(controlElement);
  syncControlPosition();

  // Игра может пересоздавать DOM вокруг карты (например, при смене размера
  // viewport). Если control оторвался от документа — снова приклеиваем после
  // picker'а. Если остался — синхронизируем позицию (picker мог переехать).
  controlMutationObserver = new MutationObserver(() => {
    if (!controlElement || !pickerElement) return;
    if (!controlElement.isConnected) {
      pickerElement.after(controlElement);
    }
    syncControlPosition();
  });
  controlMutationObserver.observe(document.body, { childList: true, subtree: true });

  if (typeof ResizeObserver !== 'undefined') {
    controlResizeObserver = new ResizeObserver(() => {
      syncControlPosition();
    });
    controlResizeObserver.observe(picker);
  }

  windowResizeHandler = (): void => {
    syncControlPosition();
  };
  window.addEventListener('resize', windowResizeHandler);

  return true;
}

function unmountOlControl(): void {
  controlMutationObserver?.disconnect();
  controlMutationObserver = null;
  controlResizeObserver?.disconnect();
  controlResizeObserver = null;
  if (windowResizeHandler) {
    window.removeEventListener('resize', windowResizeHandler);
    windowResizeHandler = null;
  }
  if (controlElement) {
    const button = controlElement.querySelector('button');
    button?.removeEventListener('click', toggleToolbar);
    controlElement.remove();
    controlElement = null;
  }
  pickerElement = null;
}

function mountToolbar(): void {
  if (toolbar) return;
  toolbar = createToolbar();
  document.body.appendChild(toolbar);
}

function unmountToolbar(): void {
  if (!toolbar) return;
  toolbar.remove();
  toolbar = null;
  lineButton = null;
  polygonButton = null;
  editButton = null;
  deleteButton = null;
  colorInput = null;
}

function cleanup(): void {
  enableToken++;
  removeEscCancelListener();
  removeToolbarOutsideClickListener();
  removePointPopupOpenListener();
  closeCopyFallbackModal();
  setMode('none');
  clearInteractions();
  unmountToolbar();
  unmountOlControl();
  removeDrawLayer();
  removeStyles(MODULE_ID);
  map = null;
}

export const drawTools: IFeatureModule = {
  id: MODULE_ID,
  name: { en: 'Draw tools', ru: 'Инструменты рисования' },
  description: {
    en: 'Draw and edit plans (2-point lines and 3-point triangles), snap to points, import/export between players',
    ru: 'Рисование и редактирование схем (линии из 2 точек и треугольники из 3 точек), привязка к точкам, импорт/экспорт между игроками',
  },
  defaultEnabled: true,
  category: 'map',

  init() {},

  async enable() {
    const myToken = ++enableToken;
    injectStyles(styles, MODULE_ID);

    try {
      mountToolbar();
      const mounted = await mountOlControl(myToken);
      // Если токен устарел во время mountOlControl — текущий enable «осиротел»:
      // disable, который инвалидировал нас, уже отработал cleanup() для
      // ресурсов, смонтированных до await. Никаких дополнительных teardown
      // здесь вызывать нельзя — иначе уроним ресурсы более позднего enable.
      if (!mounted) return;

      const olMap = await getOlMap();
      if (myToken !== enableToken) return;

      map = olMap;

      createDrawLayer(olMap);
      loadFromStorage();
      addEscCancelListener();
      addToolbarOutsideClickListener();
      addPointPopupOpenListener();
      updateModeButtons();
    } catch (error) {
      cleanup();
      throw error;
    }
  },

  disable() {
    cleanup();
  },
};
