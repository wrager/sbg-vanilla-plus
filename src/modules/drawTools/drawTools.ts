import type { IFeatureModule } from '../../core/moduleRegistry';
import { $, injectStyles, removeStyles, waitForElement } from '../../core/dom';
import { t } from '../../core/l10n';
import { showToast } from '../../core/toast';
import { createDragPanControl, findLayerByName, getOlMap } from '../../core/olMap';
import type { IDragPanControl, IOlFeature, IOlInteraction, IOlLayer, IOlMap, IOlVectorSource } from '../../core/olMap';
import { parseIitcDrawItems, stringifyIitcDrawItems } from './iitcFormat';
import type { IIitcDrawItem, IIitcLatLng } from './iitcFormat';
import styles from './styles.css?inline';

const MODULE_ID = 'drawTools';
const STORAGE_KEY = 'svp_drawTools';
const DRAW_LAYER_NAME = 'svp-draw-tools';
const SNAP_THRESHOLD_PX = 100;
const DEFAULT_COLOR = '#a24ac3';
const MENU_ICON = '\u270E\uFE0E';

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
let dragPanControl: IDragPanControl | null = null;

let menuButton: HTMLButtonElement | null = null;
let toolbar: HTMLDivElement | null = null;
let lineButton: HTMLButtonElement | null = null;
let polygonButton: HTMLButtonElement | null = null;
let editButton: HTMLButtonElement | null = null;
let deleteButton: HTMLButtonElement | null = null;
let colorInput: HTMLInputElement | null = null;

let currentMode: ToolMode = 'none';
let currentColor = DEFAULT_COLOR;

let drawInteraction: IObservableInteraction | null = null;
let modifyInteraction: IObservableInteraction | null = null;
let deleteClickHandler: ((event: Record<string, unknown>) => void) | null = null;
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

function isFeature(value: unknown): value is IOlFeature {
  if (!isRecord(value)) return false;
  return (
    typeof value.getGeometry === 'function' &&
    typeof value.getId === 'function' &&
    typeof value.setId === 'function' &&
    typeof value.setStyle === 'function'
  );
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
  if (latLngs.length < 3) return latLngs;
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
    // Keep module usable even with broken storage.
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
    zIndex: 9,
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
    map.un?.('click', deleteClickHandler as (event: { type: string; pixel: number[]; originalEvent: Record<string, unknown> }) => void);
    deleteClickHandler = null;
  }

  dragPanControl?.restore();
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
      const feature = event.feature;
      if (isFeature(feature)) {
        setFeatureColor(feature, currentColor);
      }
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

  deleteClickHandler = (event: Record<string, unknown>) => {
      const pixelRaw = event.pixel;
      if (!isNumberPair(pixelRaw) || !map?.forEachFeatureAtPixel || !drawSource) return;
      const source = drawSource;
      const pixel = [pixelRaw[0], pixelRaw[1]];
      map.forEachFeatureAtPixel(
        pixel,
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

  map.on?.(
    'click',
    deleteClickHandler as (event: { type: string; pixel: number[]; originalEvent: Record<string, unknown> }) => void,
  );
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
      en: `Snap complete: moved ${moved} point(s)`,
      ru: `Привязка завершена: перемещено ${moved} точек`,
    }),
  );
}

async function copyDrawData(): Promise<void> {
  const raw = stringifyIitcDrawItems(getDrawItems());

  try {
    await navigator.clipboard.writeText(raw);
    showToast(t({ en: 'Copied draw data', ru: 'Схема скопирована' }));
    return;
  } catch {
    // Fallback to prompt below
  }

  window.prompt(t({ en: 'Copy draw data', ru: 'Скопируйте схему' }), raw);
}

function pasteDrawData(): void {
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
  } catch {
    showToast(t({ en: 'Import failed: invalid JSON', ru: 'Импорт не удался: некорректный JSON' }));
    return;
  }

  const hasData = (drawSource?.getFeatures().length ?? 0) > 0;
  if (hasData) {
    const ok = confirm(
      t({
        en: 'Replace current draw data with imported data?',
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

function resetDrawData(): void {
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
  showToast(t({ en: 'Draw data cleared', ru: 'Схема очищена' }));
}

function setToolbarOpen(open: boolean): void {
  if (!toolbar) return;
  toolbar.classList.toggle('svp-draw-tools-toolbar-open', open);
}

function toggleToolbar(): void {
  if (!toolbar) return;
  setToolbarOpen(!toolbar.classList.contains('svp-draw-tools-toolbar-open'));
}

function createToolButton(label: string, title: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'svp-draw-tools-tool-button';
  button.textContent = label;
  button.title = title;
  button.addEventListener('click', onClick);
  return button;
}

function applyGameIcon(
  button: HTMLButtonElement,
  iconId: string,
  fallbackLabel: string,
  viewBox = '0 0 512 512',
): void {
  const iconSource = document.getElementById(iconId);
  if (!iconSource) {
    button.textContent = fallbackLabel;
    return;
  }

  button.textContent = '';
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', viewBox);
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.classList.add('svp-draw-tools-icon');

  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#${iconId}`);
  svg.appendChild(use);
  button.appendChild(svg);
}

function createToolbar(): HTMLDivElement {
  const panel = document.createElement('div');
  panel.className = 'svp-draw-tools-toolbar';

  lineButton = createToolButton('L', t({ en: 'Line', ru: 'Линия' }), () => {
    setMode('line');
  });
  polygonButton = createToolButton('P', t({ en: 'Polygon', ru: 'Полигон' }), () => {
    setMode('polygon');
  });
  editButton = createToolButton('E', t({ en: 'Edit', ru: 'Редактирование' }), () => {
    setMode('edit');
  });
  applyGameIcon(editButton, 'fas-wrench', 'E');

  deleteButton = createToolButton('D', t({ en: 'Delete mode', ru: 'Удаление' }), () => {
    setMode('delete');
  });
  applyGameIcon(deleteButton, 'fas-trash-can', 'D');

  colorInput = document.createElement('input');
  colorInput.type = 'color';
  colorInput.className = 'svp-draw-tools-color';
  colorInput.value = currentColor;
  colorInput.title = t({ en: 'Color', ru: 'Цвет' });
  colorInput.addEventListener('input', () => {
    if (!colorInput) return;
    currentColor = colorInput.value;
    if (currentMode === 'line' || currentMode === 'polygon') {
      setMode(currentMode, true);
    }
  });

  const snapButton = createToolButton(
    'S',
    t({ en: 'Snap all to nearest portals (100px)', ru: 'Привязать к ближайшим точкам (100px)' }),
    snapAllToPortals,
  );
  applyGameIcon(snapButton, 'fas-location-dot', 'S');

  const copyButton = createToolButton('C', t({ en: 'Copy JSON', ru: 'Копировать JSON' }), () => {
    void copyDrawData();
  });
  applyGameIcon(copyButton, 'fas-share-nodes', 'C');

  const pasteButton = createToolButton('V', t({ en: 'Paste JSON', ru: 'Вставить JSON' }), pasteDrawData);
  applyGameIcon(pasteButton, 'fas-wand-magic-sparkles', 'V', '0 0 586 512');

  const resetButton = createToolButton('R', t({ en: 'Clear all', ru: 'Очистить всё' }), resetDrawData);
  applyGameIcon(resetButton, 'fas-trash-can', 'R');

  const closeButton = createToolButton('[x]', t({ en: 'Close', ru: 'Закрыть' }), () => {
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

async function mountMenuButton(): Promise<void> {
  let menu = $('.game-menu');
  if (!menu) {
    const found = await waitForElement('.game-menu');
    if (!(found instanceof HTMLElement)) {
      throw new Error('Game menu not found');
    }
    menu = found;
  }

  if (!(menu instanceof HTMLElement)) {
    throw new Error('Game menu not found');
  }

  const settingsButton = $('#settings', menu);
  if (!(settingsButton instanceof HTMLButtonElement)) {
    throw new Error('Settings button not found');
  }

  const button = document.createElement('button');
  button.id = 'svp-draw-tools-menu-button';
  button.className = 'svp-draw-tools-menu-button';
  button.textContent = MENU_ICON;
  button.title = t({ en: 'Draw tools', ru: 'Инструменты рисования' });
  button.addEventListener('click', toggleToolbar);

  settingsButton.insertAdjacentElement('afterend', button);
  menuButton = button;
}

function unmountMenuButton(): void {
  if (menuButton) {
    menuButton.removeEventListener('click', toggleToolbar);
    menuButton.remove();
    menuButton = null;
  }
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
  setMode('none');
  clearInteractions();
  unmountToolbar();
  unmountMenuButton();
  removeDrawLayer();
  removeStyles(MODULE_ID);
  dragPanControl = null;
  map = null;
}

export const drawTools: IFeatureModule = {
  id: MODULE_ID,
  name: { en: 'Draw tools', ru: 'Инструменты рисования' },
  description: {
    en: 'Draw and edit line schemes on map (IITC draw-tools JSON format)',
    ru: 'Рисование и редактирование схем линий на карте (формат IITC draw-tools JSON)',
  },
  defaultEnabled: false,
  category: 'map',

  init() {},

  async enable() {
    const myToken = ++enableToken;
    injectStyles(styles, MODULE_ID);

    try {
      mountToolbar();
      await mountMenuButton();

      const olMap = await getOlMap();
      if (myToken !== enableToken) return;

      map = olMap;
      if (!dragPanControl) {
        dragPanControl = createDragPanControl(olMap);
      }

      createDrawLayer(olMap);
      loadFromStorage();
      addEscCancelListener();
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


