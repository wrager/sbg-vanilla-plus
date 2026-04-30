import { waitForElement } from '../../core/dom';
import type { IFeatureModule } from '../../core/moduleRegistry';
import { getOlMap, findLayerByName } from '../../core/olMap';
import type { IOlMap, IOlFeature, IOlVectorSource } from '../../core/olMap';
import {
  installPopupSwipe,
  registerDirection,
  uninstallPopupSwipe,
  type ISwipeDirectionHandler,
  type SwipeOutcome,
} from '../../core/popupSwipe';

const MODULE_ID = 'nextPointNavigation';
const POPUP_SELECTOR = '.info.popup';
const INTERACTION_RANGE = 45;
const AUTOZOOM_THRESHOLD = 16;
const AUTOZOOM_TARGET = 17;
const AUTOZOOM_TIMEOUT_MS = 3000;
// Длительность dismiss/return-анимации (мс). Короче дефолтных 300мс из core/popupSwipe:
// горизонтальный свайп должен ощущаться как мгновенная навигация, а 300мс
// маскировали бы apiQuery внутри showInfo (round-trip 100-300мс). 120мс — резкий
// отклик; кратко видна "дыра" между улетающим попапом и приходом нового на
// медленной сети, но воспринимается как загрузка, не как лаг скрипта.
const SWIPE_ANIMATION_MS = 120;

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
let unregisterLeftDirection: (() => void) | null = null;
let unregisterRightDirection: (() => void) | null = null;
// Guid точки, выбранной в decide() и ожидающей открытия в finalize() после
// dismiss-анимации. Сериализован state machine'ом core/popupSwipe (idle ->
// tracking -> swiping -> animating -> idle), поэтому race между параллельными
// жестами невозможен.
let pendingNextGuid: string | null = null;
// Защита от race-disable: enable содержит await getOlMap(). Если disable
// вызовется до резолва, текущий generation расходится с myGeneration —
// выходим до registerDirection и observePopup (иначе остались бы вечные
// регистрации при логически-disabled модуле).
let installGeneration = 0;

// ── Геодезическое расстояние ────────────────────────────────────────────────

/**
 * Геодезическое расстояние между двумя точками в проецированных координатах (EPSG:3857).
 * Возвращает расстояние в метрах. Использует ol.sphere.getLength — тот же метод,
 * что и игра в isInRange/getDistance (refs/game/script.js:2751-2757).
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

export function findNearestInRange(
  center: number[],
  features: IOlFeature[],
  radiusMeters: number,
  visitedSet: Set<string | number>,
): IOlFeature | null {
  const candidates = features.filter((feature) => {
    const id = feature.getId();
    if (id === undefined || visitedSet.has(id)) return false;
    const coords = feature.getGeometry().getCoordinates();
    return getGeodeticDistance(center, coords) <= radiusMeters;
  });
  return findNearestByDistance(center, candidates);
}

/**
 * Ближайшая feature из массива по проецированному расстоянию.
 * Быстро и достаточно для порядка внутри ограниченного радиуса.
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

// ── Приоритет по полезности ──────────────────────────────────────────────────

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
 * Выбор следующей точки с приоритетом по полезности.
 * Порядок: свободные слоты → доступна для изучения → любая.
 * Внутри каждого приоритета — ближайшая по расстоянию.
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
  const popup = document.querySelector(POPUP_SELECTOR);
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

  // Прямой вызов showInfo — надёжнее fake click (нет промахов, нет retry).
  // Доступен если скрипт игры пропатчен (src/core/gameScriptPatcher.ts).
  // Попап НЕ скрывается перед вызовом: showInfo сам зовёт removeClass('hidden')
  // и обновляет содержимое (см. refs/game/script.js:2120). Скрытие даёт визуальное
  // мерцание в течение await apiQuery (~100-300мс), которого нет в нативном
  // свайпе игры (refs/game/script.js:751 - просто showInfo(guid) без скрытия).
  if (typeof window.showInfo === 'function') {
    window.showInfo(guid);
    return;
  }

  // Fallback: fake click через карту (если скрипт не пропатчен)
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

// ── Выбор следующей точки в радиусе ─────────────────────────────────────────

/**
 * Возвращает следующую точку в радиусе взаимодействия для свайпа/finalize.
 * Не открывает попап — вызывающий код решает что делать с результатом.
 * Side-effect: помещает текущую точку в rangeVisited (чтобы цикл шёл вперёд),
 * при пустом множестве — сбрасывает visited и зацикливает.
 */
export function pickNextInRange(): IOlFeature | null {
  if (!map || !pointsSource) return null;

  const currentId = getPopupPointId();
  if (!currentId) return null;

  const playerCoordinates = getPlayerCoordinates();
  if (!playerCoordinates) return null;

  rangeVisited.add(currentId);

  const features = pointsSource.getFeatures();
  const inRange = findFeaturesInRange(playerCoordinates, features, INTERACTION_RANGE);
  const candidates = inRange.filter((feature) => {
    const id = feature.getId();
    return id !== undefined && !rangeVisited.has(id);
  });

  let next = findNextByPriority(playerCoordinates, candidates);

  // Все in-range посещены — зацикливаем
  if (!next) {
    rangeVisited.clear();
    rangeVisited.add(currentId);
    const cycledCandidates = inRange.filter((feature) => {
      const id = feature.getId();
      return id !== undefined && !rangeVisited.has(id);
    });
    next = findNextByPriority(playerCoordinates, cycledCandidates);
  }

  return next;
}

function navigateInRange(): boolean {
  const next = pickNextInRange();
  if (!next) return false;
  const nextId = next.getId();
  if (nextId === undefined) return false;
  openPointPopup(String(nextId));
  return true;
}

/**
 * Кратковременный сдвиг viewport к игроку для загрузки ближних точек.
 * Игра автоматически вызывает requestEntities при смене viewport,
 * что загружает точки в новой области. После загрузки точки появляются
 * в pointsSource и доступны следующему свайпу.
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

  // Ждём загрузку точек через source 'change' или таймаут
  let resolved = false;

  const finish = (): void => {
    if (resolved) return;
    resolved = true;
    autozoomInProgress = false;
    pointsSource?.un('change', onSourceChange);

    // Восстанавливаем viewport
    view.setCenter(savedCenter);
    view.setZoom?.(savedZoom);
  };

  const onSourceChange = (): void => {
    finish();
  };

  pointsSource.on('change', onSourceChange);
  setTimeout(finish, AUTOZOOM_TIMEOUT_MS);
}

// ── Свайп-handler через core/popupSwipe ─────────────────────────────────────

/**
 * Фильтр canStart: исключает свайпы внутри карусели слайдов (cores splide).
 * Зеркалит логику нативного hammer-handler'а игры (refs/game/script.js:728-738),
 * чтобы свайп влево/вправо на карусели ядер не открывал следующую точку.
 */
function canStartSwipe(event: TouchEvent): boolean {
  const target = event.target;
  if (!(target instanceof Element)) return true;
  if (target.classList.contains('info')) return true;
  let pointer: Element | null = target.parentElement;
  while (pointer) {
    if (pointer.classList.contains('splide')) return false;
    if (pointer.classList.contains('info')) return true;
    pointer = pointer.parentElement;
  }
  return true;
}

function decideSwipeOutcome(): SwipeOutcome {
  const next = pickNextInRange();
  if (!next) return 'return';
  const nextId = next.getId();
  if (nextId === undefined) return 'return';
  pendingNextGuid = String(nextId);
  return 'dismiss';
}

function finalizeSwipe(): void {
  if (pendingNextGuid !== null) {
    openPointPopup(pendingNextGuid);
    pendingNextGuid = null;
  }
}

const swipeDirectionHandler: ISwipeDirectionHandler = {
  canStart: canStartSwipe,
  decide: decideSwipeOutcome,
  finalize: finalizeSwipe,
  animationDurationMs: SWIPE_ANIMATION_MS,
};

// ── Наблюдение за попапом ───────────────────────────────────────────────────

function onPopupMutation(popup: Element): void {
  const isVisible = !popup.classList.contains('hidden');
  if (!isVisible) return;

  const currentGuid = (popup as HTMLElement).dataset.guid ?? null;
  if (expectedNextGuid !== null) {
    if (currentGuid === lastSeenGuid && fakeClickRetries < MAX_FAKE_CLICK_RETRIES) {
      // Фейковый клик переоткрыл ту же точку — повторить навигацию
      fakeClickRetries++;
      expectedNextGuid = null;
      navigateInRange();
      return;
    }
    // Retry исчерпаны или попап открылся для другой точки.
    // Если фейковый клик так и не попал в цель — пометить цель как visited,
    // чтобы следующий свайп перешёл к другой точке, а не зациклился.
    if (currentGuid === lastSeenGuid && expectedNextGuid) {
      rangeVisited.add(expectedNextGuid);
    }
    fakeClickRetries = 0;
    // Фейковый клик мог попасть в соседнюю точку — принимаем как часть цепочки.
    if (currentGuid !== expectedNextGuid && currentGuid) {
      rangeVisited.add(currentGuid);
    }
    expectedNextGuid = null;
  } else if (currentGuid !== lastSeenGuid) {
    // Ручное открытие другой точки — сбрасываем цепочку
    fakeClickRetries = 0;
    rangeVisited.clear();
  }
  lastSeenGuid = currentGuid;

  // Если в радиусе нет других точек и зум низкий — подгружаем ближние через
  // кратковременный viewport-зум. После загрузки следующий свайп найдёт цель.
  const playerCoordinates = getPlayerCoordinates();
  if (!playerCoordinates || !pointsSource) return;
  const features = pointsSource.getFeatures();
  const inRangeOthers = findFeaturesInRange(playerCoordinates, features, INTERACTION_RANGE).filter(
    (feature) => feature.getId() !== currentGuid,
  );
  if (inRangeOthers.length === 0 && !autozoomInProgress) {
    autozoomAndNavigate();
  }
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

  if (!popup.classList.contains('hidden')) {
    onPopupMutation(popup);
  }
}

function observePopup(): void {
  const popup = document.querySelector(POPUP_SELECTOR);
  if (popup) {
    startObservingPopup(popup);
    return;
  }

  void waitForElement(POPUP_SELECTOR).then((element) => {
    if (!map) return;
    startObservingPopup(element);
  });
}

// ── Модуль ──────────────────────────────────────────────────────────────────

export const nextPointNavigation: IFeatureModule = {
  id: MODULE_ID,
  name: { en: 'Next point navigation', ru: 'Переход к следующей точке' },
  description: {
    en: 'Swipe left/right on the point popup to jump to the next point in interaction range, prioritized by usefulness',
    ru: 'Свайп влево/вправо на попапе точки переходит к следующей точке в радиусе взаимодействия с приоритетом по полезности',
  },
  defaultEnabled: true,
  category: 'feature',

  init() {},

  enable() {
    installGeneration++;
    const myGeneration = installGeneration;
    return getOlMap().then((olMap) => {
      if (myGeneration !== installGeneration) return;

      const pointsLayer = findLayerByName(olMap, 'points');
      if (!pointsLayer) return;

      const source = pointsLayer.getSource();
      if (!source) return;

      const playerLayer = findLayerByName(olMap, 'player');
      const playerLayerSource = playerLayer?.getSource() ?? null;

      map = olMap;
      pointsSource = source;
      playerSource = playerLayerSource;

      // Регистрируем обработчик и для left, и для right: оба направления зовут
      // navigateInRange (наша приоритетная навигация одна на оба направления,
      // в отличие от нативного next/prev). registerDirection бросает на
      // повторную регистрацию, поэтому unregister-функции хранятся для disable.
      unregisterLeftDirection = registerDirection('left', swipeDirectionHandler);
      unregisterRightDirection = registerDirection('right', swipeDirectionHandler);
      installPopupSwipe(POPUP_SELECTOR);

      observePopup();
    });
  },

  disable() {
    installGeneration++;

    if (popupObserver) {
      popupObserver.disconnect();
      popupObserver = null;
    }

    unregisterLeftDirection?.();
    unregisterLeftDirection = null;
    unregisterRightDirection?.();
    unregisterRightDirection = null;
    uninstallPopupSwipe();

    map = null;
    pointsSource = null;
    playerSource = null;
    rangeVisited.clear();
    expectedNextGuid = null;
    lastSeenGuid = null;
    fakeClickRetries = 0;
    autozoomInProgress = false;
    pendingNextGuid = null;
  },
};
