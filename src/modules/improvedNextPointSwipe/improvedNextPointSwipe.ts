import { waitForElement } from '../../core/dom';
import type { IFeatureModule } from '../../core/moduleRegistry';
import { getOlMap, findLayerByName } from '../../core/olMap';
import type { IOlMap, IOlFeature, IOlVectorSource } from '../../core/olMap';

const MODULE_ID = 'improvedNextPointSwipe';
const INTERACTION_RANGE = 45;
const AUTOZOOM_THRESHOLD = 16;
const AUTOZOOM_TARGET = 17;
const AUTOZOOM_TIMEOUT_MS = 3000;

let map: IOlMap | null = null;
let pointsSource: IOlVectorSource | null = null;
let playerSource: IOlVectorSource | null = null;
const rangeVisited = new Set<string | number>();
let expectedNextGuid: string | null = null;
let lastSeenGuid: string | null = null;
let fakeClickRetries = 0;
const MAX_FAKE_CLICK_RETRIES = 3;
let popupObserver: MutationObserver | null = null;
let autozoomInProgress = false;

// ── Геодезическое расстояние ────────────────────────────────────────────────

/**
 * Геодезическое расстояние между двумя точками в проецированных координатах
 * (EPSG:3857). Возвращает расстояние в метрах. Использует ol.sphere.getLength -
 * тот же метод, что игра в isInRange/getDistance (refs/game/script.js:2751-2757).
 */
export function getGeodeticDistance(coordsA: number[], coordsB: number[]): number {
  const ol = window.ol;
  if (!ol?.geom?.LineString || !ol.sphere?.getLength) return Infinity;
  const line = new ol.geom.LineString([coordsA, coordsB]);
  return ol.sphere.getLength(line);
}

// ── Поиск features ──────────────────────────────────────────────────────────

export function findFeaturesInRange(
  center: number[],
  features: IOlFeature[],
  radiusMeters: number,
): IOlFeature[] {
  const result: IOlFeature[] = [];
  for (const feature of features) {
    const id = feature.getId();
    if (id === undefined) continue;
    const coords = feature.getGeometry().getCoordinates();
    if (getGeodeticDistance(center, coords) <= radiusMeters) {
      result.push(feature);
    }
  }
  return result;
}

/**
 * Ближайшая feature из массива по проецированному расстоянию. Быстро и
 * достаточно для упорядочивания внутри ограниченного радиуса (45 м).
 */
export function findNearestByDistance(center: number[], features: IOlFeature[]): IOlFeature | null {
  let nearest: IOlFeature | null = null;
  let minDistanceSquared = Infinity;
  for (const feature of features) {
    const coords = feature.getGeometry().getCoordinates();
    const dx = coords[0] - center[0];
    const dy = coords[1] - center[1];
    const distanceSquared = dx * dx + dy * dy;
    if (distanceSquared < minDistanceSquared) {
      minDistanceSquared = distanceSquared;
      nearest = feature;
    }
  }
  return nearest;
}

// ── Приоритет по полезности ─────────────────────────────────────────────────

/** Точка имеет свободные слоты для деплоя (< 6 ядер). refs/game/script.js:1246 */
export function hasFreeSlots(feature: IOlFeature): boolean {
  const cores = feature.get?.('cores');
  return cores === undefined || (typeof cores === 'number' && cores < 6);
}

/** Точка доступна для изучения (нет активного кулдауна). refs/game/script.js:636-638 */
export function isDiscoverable(feature: IOlFeature): boolean {
  const id = feature.getId();
  if (id === undefined) return false;
  const cooldowns = JSON.parse(localStorage.getItem('cooldowns') ?? '{}') as Record<
    string,
    { t?: number; c?: number } | undefined
  >;
  const cooldown = cooldowns[String(id)];
  if (!cooldown?.t) return true;
  return cooldown.t <= Date.now() && (cooldown.c ?? 0) > 0;
}

/**
 * Выбор следующей точки с приоритетом по полезности. Порядок: свободные слоты
 * > доступная для изучения > любая. Внутри каждого приоритета - ближайшая по
 * расстоянию.
 */
export function findNextByPriority(center: number[], candidates: IOlFeature[]): IOlFeature | null {
  return (
    findNearestByDistance(center, candidates.filter(hasFreeSlots)) ??
    findNearestByDistance(center, candidates.filter(isDiscoverable)) ??
    findNearestByDistance(center, candidates)
  );
}

// ── Слои и координаты ───────────────────────────────────────────────────────

function getPlayerCoordinates(): number[] | null {
  if (!playerSource) return null;
  const features = playerSource.getFeatures();
  if (features.length === 0) return null;
  return features[0].getGeometry().getCoordinates();
}

function getPopupPointId(): string | null {
  const popup = document.querySelector('.info.popup');
  if (!popup || popup.classList.contains('hidden')) return null;
  return (popup as HTMLElement).dataset.guid ?? null;
}

function findFeatureById(id: string): IOlFeature | null {
  if (!pointsSource) return null;
  for (const feature of pointsSource.getFeatures()) {
    if (feature.getId() === id) return feature;
  }
  return null;
}

// ── Открытие попапа ─────────────────────────────────────────────────────────

function openPointPopup(guid: string): void {
  expectedNextGuid = guid;
  // Прямой вызов showInfo - надёжнее fake click (нет промахов, нет retry).
  // Доступен если скрипт игры пропатчен (src/core/gameScriptPatcher.ts).
  if (typeof window.showInfo === 'function') {
    document.querySelector('.info.popup')?.classList.add('hidden');
    window.showInfo(guid);
    return;
  }
  // Fallback: fake click через карту (если скрипт не пропатчен).
  if (
    !map ||
    typeof map.dispatchEvent !== 'function' ||
    typeof map.getPixelFromCoordinate !== 'function'
  ) {
    return;
  }
  const feature = findFeatureById(guid);
  if (!feature) return;
  const coords = feature.getGeometry().getCoordinates();
  const pixel = map.getPixelFromCoordinate(coords);
  map.dispatchEvent({ type: 'click', pixel, originalEvent: {} });
}

// ── Навигация по приоритету ─────────────────────────────────────────────────

export function tryNavigateInRange(): boolean {
  if (!map || !pointsSource) return false;
  const currentId = getPopupPointId();
  if (!currentId) return false;
  const playerCoordinates = getPlayerCoordinates();
  if (!playerCoordinates) return false;
  rangeVisited.add(currentId);

  const features = pointsSource.getFeatures();
  const inRange = findFeaturesInRange(playerCoordinates, features, INTERACTION_RANGE);
  const candidates = inRange.filter((feature) => {
    const id = feature.getId();
    return id !== undefined && !rangeVisited.has(id);
  });

  let next = findNextByPriority(playerCoordinates, candidates);

  // Все in-range посещены - зацикливаем.
  if (!next) {
    rangeVisited.clear();
    rangeVisited.add(currentId);
    const cycledCandidates = inRange.filter((feature) => {
      const id = feature.getId();
      return id !== undefined && !rangeVisited.has(id);
    });
    next = findNextByPriority(playerCoordinates, cycledCandidates);
  }

  if (!next) return false;
  const nextId = next.getId();
  if (nextId === undefined) return false;
  openPointPopup(String(nextId));
  return true;
}

/**
 * Кратковременный сдвиг viewport к игроку для загрузки ближних точек.
 * Игра автоматически вызывает requestEntities при смене viewport, что подгружает
 * точки в новой области. После загрузки повторяем navigate.
 */
function autozoomAndNavigate(): void {
  if (!map || !pointsSource) return;
  const view = map.getView();
  const currentZoom = view.getZoom?.();
  if (currentZoom === undefined || currentZoom >= AUTOZOOM_THRESHOLD) return;
  const playerCoordinates = getPlayerCoordinates();
  if (!playerCoordinates) return;

  autozoomInProgress = true;
  const savedCenter = view.getCenter();
  const savedZoom = currentZoom;
  view.setCenter(playerCoordinates);
  view.setZoom?.(AUTOZOOM_TARGET);

  let resolved = false;
  const finish = (): void => {
    if (resolved) return;
    resolved = true;
    autozoomInProgress = false;
    pointsSource?.un('change', onSourceChange);
    view.setCenter(savedCenter);
    view.setZoom?.(savedZoom);
    // После подгрузки точек повторяем попытку - новый набор может содержать
    // кандидатов в радиусе, которых не было до зума.
    tryNavigateInRange();
  };
  const onSourceChange = (): void => {
    finish();
  };
  pointsSource.on('change', onSourceChange);
  setTimeout(finish, AUTOZOOM_TIMEOUT_MS);
}

function navigateInRange(): void {
  const navigated = tryNavigateInRange();
  if (!navigated && !autozoomInProgress) {
    // Кандидатов нет - возможно низкий зум и точки рядом не подгружены.
    // Сдвигаем viewport к игроку, ждём загрузки, повторяем.
    autozoomAndNavigate();
  }
}

// ── Перехват нативного horizontal-Hammer ────────────────────────────────────

let interceptInstalled = false;
let interceptEnabled = false;

interface IHammerManagerLike {
  element: Element;
}

interface IHammerStaticLike {
  Manager: {
    prototype: {
      emit: (this: IHammerManagerLike, name: string, data?: unknown) => void;
    };
  };
}

/**
 * Глобальный patch на Hammer.Manager.prototype.emit. Срабатывает при любом
 * gesture-emit на любом Hammer-instance страницы. Если modulle enabled, name -
 * swipeleft/swiperight, и element - .info, нативный listener (refs/game/script.js:727-752,
 * перебор near_points) подменяется нашей навигацией с приоритетом по полезности
 * в радиусе действия. В остальных случаях - pass-through к оригинальному emit.
 *
 * Различение от своего Hammer на .info (модуль swipeToClosePopup) идёт по name:
 * там DIRECTION_VERTICAL и emit'ы swipeup, наш фильтр их не задевает. Patch
 * ставится один раз за жизнь страницы; повторный install no-op. Снять patch
 * нельзя, но при interceptEnabled=false вся ветка - pass-through, оверхед
 * минимален.
 */
export function installHammerInterceptor(): void {
  if (interceptInstalled) return;
  const Hammer = (window as unknown as { Hammer?: IHammerStaticLike }).Hammer;
  const proto = Hammer?.Manager.prototype;
  if (!proto) return;
  interceptInstalled = true;
  const originalEmit = proto.emit;
  proto.emit = function patched(this: IHammerManagerLike, name: string, data?: unknown): void {
    if (interceptEnabled && (name === 'swipeleft' || name === 'swiperight')) {
      const element = this.element;
      if (element instanceof Element && element.matches('.info')) {
        navigateInRange();
        return;
      }
    }
    originalEmit.call(this, name, data);
  };
}

/** Тестовый сброс patch'а. Только для тестов. */
export function uninstallHammerInterceptorForTest(): void {
  interceptInstalled = false;
  interceptEnabled = false;
}

// ── Отслеживание попапа для цепочки visited ─────────────────────────────────

function onPopupMutation(popup: Element): void {
  const isVisible = !popup.classList.contains('hidden');
  if (!isVisible) return;
  const currentGuid = (popup as HTMLElement).dataset.guid ?? null;
  if (expectedNextGuid !== null) {
    if (currentGuid === lastSeenGuid && fakeClickRetries < MAX_FAKE_CLICK_RETRIES) {
      // Фейковый клик переоткрыл ту же точку - повторить навигацию.
      fakeClickRetries++;
      expectedNextGuid = null;
      navigateInRange();
      return;
    }
    if (currentGuid === lastSeenGuid && expectedNextGuid) {
      rangeVisited.add(expectedNextGuid);
    }
    fakeClickRetries = 0;
    if (currentGuid !== expectedNextGuid && currentGuid) {
      rangeVisited.add(currentGuid);
    }
    expectedNextGuid = null;
  } else if (currentGuid !== lastSeenGuid) {
    // Ручное открытие другой точки - сбрасываем цепочку.
    fakeClickRetries = 0;
    rangeVisited.clear();
  }
  lastSeenGuid = currentGuid;
}

function startObservingPopup(popup: Element): void {
  popupObserver = new MutationObserver(() => {
    onPopupMutation(popup);
  });
  popupObserver.observe(popup, {
    attributes: true,
    attributeFilter: ['class', 'data-guid'],
    childList: true,
    subtree: true,
  });
}

function observePopup(): void {
  const popup = document.querySelector('.info.popup');
  if (popup) {
    startObservingPopup(popup);
    return;
  }
  void waitForElement('.info.popup').then((element) => {
    if (!map) return;
    startObservingPopup(element);
  });
}

// ── Модуль ──────────────────────────────────────────────────────────────────

export const improvedNextPointSwipe: IFeatureModule = {
  id: MODULE_ID,
  name: { en: 'Improved next point swipe', ru: 'Улучшенный свайп к следующей точке' },
  description: {
    en: 'Replaces the native horizontal swipe between adjacent points (cycle through all visible features) with a smarter walk: in the player interaction range, with priority free-deploy-slots > discoverable > nearest. Auto-zooms to 17 if the current zoom is too low to load nearby points. The native swipe handler is suppressed via a Hammer.Manager.prototype.emit patch.',
    ru: 'Заменяет нативный горизонтальный свайп между соседними точками (циклический перебор всех видимых) умной навигацией: только в радиусе действия игрока, с приоритетом свободные слоты > доступная для изучения > ближайшая. Если зум слишком низкий и точки рядом не подгружены - сдвигает viewport к игроку и зумит до 17. Нативный обработчик подавляется через patch Hammer.Manager.prototype.emit.',
  },
  defaultEnabled: true,
  category: 'feature',

  init() {
    installHammerInterceptor();
  },

  enable() {
    return getOlMap().then((olMap) => {
      const pointsLayer = findLayerByName(olMap, 'points');
      if (!pointsLayer) return;
      const source = pointsLayer.getSource();
      if (!source) return;
      const playerLayer = findLayerByName(olMap, 'player');
      const playerLayerSource = playerLayer?.getSource() ?? null;

      map = olMap;
      pointsSource = source;
      playerSource = playerLayerSource;
      interceptEnabled = true;
      // На случай, если Hammer глобал появился позже init (порядок загрузки
      // скриптов на странице): повторный install no-op, если уже установлен.
      installHammerInterceptor();
      observePopup();
    });
  },

  disable() {
    interceptEnabled = false;
    if (popupObserver) {
      popupObserver.disconnect();
      popupObserver = null;
    }
    map = null;
    pointsSource = null;
    playerSource = null;
    rangeVisited.clear();
    expectedNextGuid = null;
    lastSeenGuid = null;
    fakeClickRetries = 0;
    autozoomInProgress = false;
  },
};
