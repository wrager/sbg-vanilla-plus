import type { IFeatureModule } from '../../core/moduleRegistry';
import { getOlMap, findLayerByName } from '../../core/olMap';
import type { IOlMap, IOlVectorSource, IOlLayer } from '../../core/olMap';
import { readInventoryReferences } from '../../core/inventoryCache';
import { getTextColor, getBackgroundColor } from '../../core/themeColors';

const MODULE_ID = 'keyCountFix';
const MIN_ZOOM = 13;
const DEBOUNCE_MS = 100;
// SBG 0.6.1 layers-config: байт 2 поля map-config.h задаёт «текстовый канал»
// для FeatureStyles.LIGHT (refs/game-beta/script.js:556 далее). Значение 7 =
// References — нативно рисует количество ключей текстом 32px поверх кольца
// точки. Маскируем байт 2 в 0 (None), пока модуль активен — наш слой ниже
// показывает те же числа адаптивным шрифтом.
const TEXT_CHANNEL_SHIFT = 16;
const TEXT_CHANNEL_MASK = 0xff << TEXT_CHANNEL_SHIFT;
const REFERENCES_MODE_VALUE = 7;
const MAP_CONFIG_KEY = 'map-config';

/** clamp(low, value, high) — возвращает value, ограниченный диапазоном [low, high]. */
function clamp(low: number, value: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

/**
 * Адаптивный размер шрифта в зависимости от зума. На MIN_ZOOM (13) — мелкий
 * 10px, на zoom 18+ — 16px. Линейная интерполяция в диапазоне.
 *
 * Нативный рендер игры (refs/game-beta/script.js:570 — `bold 32px Manrope`)
 * слишком крупный на низких зумах (числа закрывают сами точки и соседние
 * подписи); наш более мелкий и масштабируемый шрифт остаётся читаемым.
 */
export function fontSizeForZoom(zoom: number): number {
  return Math.round(clamp(10, zoom - 3, 16));
}

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
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let mutationObserver: MutationObserver | null = null;
let onPointsChange: (() => void) | null = null;
let onZoomChange: (() => void) | null = null;

// Оригинальная localStorage.getItem, сохраняется на activate и восстанавливается
// на deactivate. Хук маскирует текстовый канал в map-config.h, чтобы нативный
// LIGHT-renderer не рисовал свой 32px-текст параллельно с нашим слоем.
let originalGetItem: typeof Storage.prototype.getItem | null = null;
let getItemPatchTarget: 'instance' | 'prototype' | null = null;

// Перехват localStorage.setItem нужен для реакции на смену text channel
// в layers-config БЕЗ перезагрузки страницы. Игра при сохранении настроек
// слоёв вызывает `localStorage.setItem('map-config', ...)` и сразу
// `requestEntities()` для перерисовки точек. Если мы поймаем setItem,
// мы можем синхронно activate/deactivate наш слой - и в момент когда
// игра делает getItem для нового highlight, наш патч уже стоит (или
// наоборот, снят).
let originalSetItem: typeof Storage.prototype.setItem | null = null;
let setItemPatchTarget: 'instance' | 'prototype' | null = null;

function maskReferencesInMapConfig(rawValue: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawValue) as unknown;
  } catch {
    return rawValue;
  }
  if (typeof parsed !== 'object' || parsed === null) return rawValue;
  const config = parsed as Record<string, unknown>;
  if (typeof config.h !== 'number') return rawValue;
  const textChannel = (config.h & TEXT_CHANNEL_MASK) >> TEXT_CHANNEL_SHIFT;
  if (textChannel !== REFERENCES_MODE_VALUE) return rawValue;
  config.h = config.h & ~TEXT_CHANNEL_MASK;
  return JSON.stringify(config);
}

/**
 * Читает `map-config` напрямую (минуя любые наши патчи) и проверяет, выбран ли
 * пользователем нативный канал References для текстового слоя. Используется
 * на enable, чтобы решить, активировать ли наш слой и подавление нативного
 * рендера: если игрок выключил References в layers-config, нативный 32px-текст
 * не рисуется, наш фикс ему не нужен — модуль уходит в no-op.
 */
function isReferencesEnabledInMapConfig(): boolean {
  const raw = localStorage.getItem(MAP_CONFIG_KEY);
  if (raw === null) return false;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return false;
  }
  if (typeof parsed !== 'object' || parsed === null) return false;
  const config = parsed as Record<string, unknown>;
  if (typeof config.h !== 'number') return false;
  const textChannel = (config.h & TEXT_CHANNEL_MASK) >> TEXT_CHANNEL_SHIFT;
  return textChannel === REFERENCES_MODE_VALUE;
}

function installMapConfigGetItemHook(): void {
  if (originalGetItem !== null) return;

  // eslint-disable-next-line @typescript-eslint/unbound-method -- bind переносится через call внутри patchedGetItem
  const nativeGetItem = localStorage.getItem;
  originalGetItem = nativeGetItem;

  const wrapper = function patchedGetItem(this: Storage, key: string): string | null {
    const value = nativeGetItem.call(this, key);
    if (this !== localStorage || key !== MAP_CONFIG_KEY || value === null) return value;
    return maskReferencesInMapConfig(value);
  };

  // В современных WebView (Android 16+ / Chrome 146+) `localStorage.getItem` -
  // own-свойство объекта, а не унаследованное от Storage.prototype. Патч
  // прототипа в этом случае НЕ перехватывает вызовы `localStorage.getItem(...)`,
  // и игра видит сырой map-config с text channel = 7. Сначала пробуем патчить
  // localStorage напрямую; если среда не позволяет (jsdom возвращает то же
  // дескрипторное наследование), откатываемся на прототип.
  localStorage.getItem = wrapper;
  if (localStorage.getItem === wrapper) {
    getItemPatchTarget = 'instance';
  } else {
    Storage.prototype.getItem = wrapper;
    getItemPatchTarget = 'prototype';
  }
}

function uninstallMapConfigGetItemHook(): void {
  if (originalGetItem === null || getItemPatchTarget === null) return;
  if (getItemPatchTarget === 'instance') {
    localStorage.getItem = originalGetItem;
  } else {
    Storage.prototype.getItem = originalGetItem;
  }
  originalGetItem = null;
  getItemPatchTarget = null;
}

/**
 * Извлекает значение text channel (байт 2 поля `h`) из строки map-config.
 * Возвращает -1, если значение не парсится как ожидаемая структура.
 */
function parseTextChannel(rawValue: string): number {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawValue) as unknown;
  } catch {
    return -1;
  }
  if (typeof parsed !== 'object' || parsed === null) return -1;
  const config = parsed as Record<string, unknown>;
  if (typeof config.h !== 'number') return -1;
  return (config.h & TEXT_CHANNEL_MASK) >> TEXT_CHANNEL_SHIFT;
}

function onMapConfigChanged(newValue: string): void {
  const channel = parseTextChannel(newValue);
  const shouldBeActive = channel === REFERENCES_MODE_VALUE;
  if (shouldBeActive && !isActivated()) {
    void activate();
  } else if (!shouldBeActive && isActivated()) {
    deactivate();
  }
}

function installMapConfigSetItemHook(): void {
  if (originalSetItem !== null) return;

  // eslint-disable-next-line @typescript-eslint/unbound-method -- bind через call внутри wrapper
  const nativeSetItem = localStorage.setItem;
  originalSetItem = nativeSetItem;

  const wrapper = function patchedSetItem(this: Storage, key: string, value: string): void {
    nativeSetItem.call(this, key, value);
    if (this !== localStorage || key !== MAP_CONFIG_KEY) return;
    // Синхронно реагируем: getItem hook должен быть установлен/снят ДО того,
    // как игра в `requestEntities()` сделает getItem('map-config') для
    // перерисовки features с новым highlight.
    onMapConfigChanged(value);
  };

  // Адаптивный патч (instance vs prototype) - см. installMapConfigGetItemHook.
  localStorage.setItem = wrapper;
  if (localStorage.setItem === wrapper) {
    setItemPatchTarget = 'instance';
  } else {
    Storage.prototype.setItem = wrapper;
    setItemPatchTarget = 'prototype';
  }
}

function uninstallMapConfigSetItemHook(): void {
  if (originalSetItem === null || setItemPatchTarget === null) return;
  if (setItemPatchTarget === 'instance') {
    localStorage.setItem = originalSetItem;
  } else {
    Storage.prototype.setItem = originalSetItem;
  }
  originalSetItem = null;
  setItemPatchTarget = null;
}

function isActivated(): boolean {
  // Источник истины: установлен ли getItem hook. Слой создаётся асинхронно
  // (await getOlMap), но getItem hook ставится синхронно первым.
  return originalGetItem !== null;
}

function renderLabels(): void {
  if (!labelsSource || !map || !pointsSource) return;

  labelsSource.clear();

  const zoom = map.getView().getZoom?.() ?? 0;
  if (zoom < MIN_ZOOM) return;

  const refCounts = buildRefCounts();
  if (refCounts.size === 0) return;

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
  const fontSize = fontSizeForZoom(zoom);

  for (const feature of pointsSource.getFeatures()) {
    const id = feature.getId();
    if (typeof id !== 'string') continue;
    const count = refCounts.get(id);
    if (!count || count <= 0) continue;

    const coords = feature.getGeometry().getCoordinates();
    const label = new OlFeature({ geometry: new OlPoint(coords) });
    label.setId(id + ':key-label');
    label.setStyle(
      new OlStyle({
        text: new OlText({
          font: `${fontSize}px Manrope`,
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

export const keyCountFix: IFeatureModule = {
  id: MODULE_ID,
  name: { en: 'Key count on points', ru: 'Количество ключей на точках' },
  description: {
    en: 'When the native References layer is on, replaces it with adaptive-size labels that stay readable at low zoom and do not rotate with the map. Inactive when References is off.',
    ru: 'Когда у игрока включён слой References, заменяет нативную подсветку адаптивными подписями: читаемый размер на любом зуме, числа не вращаются вместе с картой. Если References выключен — модуль ничего не делает.',
  },
  defaultEnabled: true,
  category: 'map',

  init() {},

  enable() {
    // setItem hook ставится ВСЕГДА - это наш канал для реакции на смену
    // text channel в layers-config без перезагрузки страницы.
    installMapConfigSetItemHook();

    // Если игрок сейчас выбрал References - активируемся сразу. Иначе остаёмся
    // пассивными, ждём smetup-event через setItem hook.
    if (isReferencesEnabledInMapConfig()) {
      return activate();
    }
    return undefined;
  },

  disable() {
    deactivate();
    uninstallMapConfigSetItemHook();
  },
};

/**
 * Активирует слой подписей: ставит getItem hook (маскирует нативный канал),
 * создаёт OL Vector layer с числами, подписывается на события точек и зума.
 * Идемпотентно: если уже активирован (`originalGetItem !== null`), no-op.
 */
function activate(): Promise<void> | undefined {
  if (isActivated()) return undefined;
  installMapConfigGetItemHook();

  return getOlMap().then((olMap) => {
    if (!isActivated()) return; // могли deactivate за время await
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
    labelsSource = new OlVectorSource();
    labelsLayer = new OlVectorLayer({
      source: labelsSource as unknown as Record<string, unknown>,
      zIndex: 5,
    });

    olMap.addLayer(labelsLayer);

    onPointsChange = scheduleRender;
    pointsSource.on('change', onPointsChange);

    onZoomChange = renderLabels;
    olMap.getView().on?.('change:resolution', onZoomChange);

    const invEl = document.getElementById('self-info__inv');
    if (invEl) {
      mutationObserver = new MutationObserver(renderLabels);
      mutationObserver.observe(invEl, { characterData: true, childList: true, subtree: true });
    }

    renderLabels();
  });
}

/**
 * Деактивирует слой: снимает getItem hook, убирает OL слой, отписывается от
 * событий. Идемпотентно: если уже деактивирован, no-op.
 */
function deactivate(): void {
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

  if (map && labelsLayer) {
    map.removeLayer(labelsLayer);
  }

  map = null;
  pointsSource = null;
  labelsSource = null;
  labelsLayer = null;

  uninstallMapConfigGetItemHook();
}
