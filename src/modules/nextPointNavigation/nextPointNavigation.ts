import { injectStyles, removeStyles, waitForElement } from '../../core/dom';
import type { IFeatureModule } from '../../core/moduleRegistry';
import { getOlMap, findLayerByName } from '../../core/olMap';
import type { IOlMap, IOlFeature, IOlVectorSource } from '../../core/olMap';
import styles from './styles.css?inline';

const MODULE_ID = 'nextPointNavigation';
const BUTTON_CLASS = 'svp-next-point-button';
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
let playerMoveHandler: (() => void) | null = null;
let autozoomInProgress = false;
let onRangeButtonClick: (() => void) | null = null;
let sourceChangeHandler: (() => void) | null = null;

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

// ── Навигация: in-range цикл (кнопка →) ─────────────────────────────────────

function tryNavigateInRange(): boolean {
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

  if (!next) return false;

  const nextId = next.getId();
  if (nextId === undefined) return false;

  openPointPopup(String(nextId));
  return true;
}

/**
 * Кратковременный сдвиг viewport к игроку для загрузки ближних точек.
 * Игра автоматически вызывает requestEntities при смене viewport,
 * что загружает точки в новой области. После загрузки обновляет
 * состояние кнопки (disabled/enabled).
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

    // Обновляем состояние кнопки (могли появиться in-range точки)
    updateButtonStates();
  };

  const onSourceChange = (): void => {
    finish();
  };

  pointsSource.on('change', onSourceChange);
  setTimeout(finish, AUTOZOOM_TIMEOUT_MS);
}

function navigateInRange(): void {
  tryNavigateInRange();
}

// ── Инъекция кнопки ─────────────────────────────────────────────────────────

function hasInRangePoints(excludePointId: string | null): boolean {
  if (!pointsSource) return false;
  const playerCoordinates = getPlayerCoordinates();
  if (!playerCoordinates) return false;
  const features = pointsSource.getFeatures();
  const inRange = findFeaturesInRange(playerCoordinates, features, INTERACTION_RANGE);
  return inRange.some((feature) => feature.getId() !== excludePointId);
}

function injectButton(popup: Element): void {
  const buttonsContainer = popup.querySelector('.i-buttons');
  if (!buttonsContainer) return;

  if (!popup.querySelector(`.${BUTTON_CLASS}`)) {
    const rangeButton = document.createElement('button');
    rangeButton.className = BUTTON_CLASS;
    rangeButton.textContent = '→';
    rangeButton.title = 'Следующая точка в радиусе взаимодействия';

    onRangeButtonClick = () => {
      navigateInRange();
    };
    rangeButton.addEventListener('click', (event) => {
      event.stopPropagation();
      onRangeButtonClick?.();
    });

    buttonsContainer.appendChild(rangeButton);
  }

  // Кнопка всегда видна, disabled когда других in-range точек нет
  const inRange = hasInRangePoints(getPopupPointId());
  const rangeButton = popup.querySelector<HTMLButtonElement>(`.${BUTTON_CLASS}`);
  if (rangeButton) {
    rangeButton.disabled = !inRange;
  }

  // Автозум: если in-range точек нет и зум низкий — подгрузить точки рядом с игроком
  if (!inRange && !autozoomInProgress) {
    autozoomAndNavigate();
  }
}

function updateButtonStates(): void {
  const popup = document.querySelector('.info.popup');
  if (!popup || popup.classList.contains('hidden')) return;

  const rangeButton = popup.querySelector<HTMLButtonElement>(`.${BUTTON_CLASS}`);
  if (rangeButton) {
    rangeButton.disabled = !hasInRangePoints(getPopupPointId());
  }
}

function removeButton(): void {
  document.querySelector(`.${BUTTON_CLASS}`)?.remove();
  onRangeButtonClick = null;
}

// ── Наблюдение за попапом ───────────────────────────────────────────────────

function onPopupMutation(popup: Element): void {
  const isVisible = !popup.classList.contains('hidden');
  if (isVisible) {
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
      // чтобы следующий клик перешёл к другой точке, а не зациклился.
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
    injectButton(popup);
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
    injectButton(popup);
  }
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

export const nextPointNavigation: IFeatureModule = {
  id: MODULE_ID,
  name: { en: 'Next point navigation', ru: 'Переход к следующей точке' },
  description: {
    en: 'Cycle through points in interaction range',
    ru: 'Зацикленная навигация по точкам в радиусе взаимодействия',
  },
  defaultEnabled: true,
  category: 'feature',

  init() {},

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

      injectStyles(styles, MODULE_ID);
      observePopup();

      // Обновлять disabled-состояние кнопки при изменении набора точек
      // (сервер подгрузил новые точки после смены viewport)
      sourceChangeHandler = () => {
        updateButtonStates();
      };
      pointsSource.on('change', sourceChangeHandler);

      // Обновлять disabled-состояние кнопки при движении игрока
      // (точки входят/выходят из ренжа). Игра диспатчит playermove на .info.
      const infoElement = document.querySelector('.info');
      if (infoElement) {
        playerMoveHandler = () => {
          updateButtonStates();
        };
        infoElement.addEventListener('playermove', playerMoveHandler);
      }
    });
  },

  disable() {
    if (popupObserver) {
      popupObserver.disconnect();
      popupObserver = null;
    }

    if (playerMoveHandler) {
      document.querySelector('.info')?.removeEventListener('playermove', playerMoveHandler);
      playerMoveHandler = null;
    }

    if (pointsSource && sourceChangeHandler) {
      pointsSource.un('change', sourceChangeHandler);
      sourceChangeHandler = null;
    }

    removeButton();
    removeStyles(MODULE_ID);

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
