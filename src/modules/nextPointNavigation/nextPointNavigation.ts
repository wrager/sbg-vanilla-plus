import { injectStyles, removeStyles, waitForElement } from '../../core/dom';
import type { IFeatureModule } from '../../core/moduleRegistry';
import { getOlMap } from '../../core/olMap';
import type { IOlMap, IOlFeature, IOlVectorSource, IOlLayer } from '../../core/olMap';
import styles from './styles.css?inline';

const MODULE_ID = 'nextPointNavigation';
const BUTTON_CLASS = 'svp-next-point-button';

let map: IOlMap | null = null;
let pointsSource: IOlVectorSource | null = null;
const visited = new Set<string | number>();
let chainOrigin: number[] | null = null;
let expectedNextGuid: string | null = null;
let lastSeenGuid: string | null = null;
let popupObserver: MutationObserver | null = null;
let onButtonClick: (() => void) | null = null;

export function findNearestUnvisited(
  origin: number[],
  features: IOlFeature[],
  visitedSet: Set<string | number>,
): IOlFeature | null {
  let nearest: IOlFeature | null = null;
  let minDistanceSquared = Infinity;

  for (const feature of features) {
    const id = feature.getId();
    if (id === undefined || visitedSet.has(id)) continue;

    const coords = feature.getGeometry().getCoordinates();
    const dx = coords[0] - origin[0];
    const dy = coords[1] - origin[1];
    const distanceSquared = dx * dx + dy * dy;

    if (distanceSquared < minDistanceSquared) {
      minDistanceSquared = distanceSquared;
      nearest = feature;
    }
  }

  return nearest;
}

function findPointsLayer(olMap: IOlMap): IOlLayer | null {
  for (const layer of olMap.getLayers().getArray()) {
    if (layer.get('name') === 'points') return layer;
  }
  return null;
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

function openPointPopup(guid: string): void {
  if (
    !map ||
    typeof map.dispatchEvent !== 'function' ||
    typeof map.getPixelFromCoordinate !== 'function'
  ) {
    return;
  }

  const feature = findFeatureById(guid);
  if (!feature) return;

  expectedNextGuid = guid;
  const coords = feature.getGeometry().getCoordinates();
  const pixel = map.getPixelFromCoordinate(coords);
  map.dispatchEvent({ type: 'click', pixel, originalEvent: {} });
}

function navigateToNext(): void {
  if (!map || !pointsSource) return;

  const currentId = getPopupPointId();
  if (!currentId) return;

  const currentFeature = findFeatureById(currentId);
  if (!currentFeature) return;

  // Первый клик в цепочке — запомнить начальную точку
  if (!chainOrigin) {
    chainOrigin = currentFeature.getGeometry().getCoordinates();
  }

  visited.add(currentId);

  const features = pointsSource.getFeatures();
  const next = findNearestUnvisited(chainOrigin, features, visited);

  if (!next) {
    visited.clear();
    chainOrigin = null;
    return;
  }

  const nextId = next.getId();
  if (nextId === undefined) return;

  visited.add(nextId);
  openPointPopup(String(nextId));
}

function injectButton(popup: Element): void {
  if (popup.querySelector(`.${BUTTON_CLASS}`)) return;

  const buttonsContainer = popup.querySelector('.i-buttons');
  if (!buttonsContainer) return;

  const button = document.createElement('button');
  button.className = BUTTON_CLASS;
  button.textContent = '→';
  button.title = 'Следующая ближайшая точка';

  onButtonClick = () => {
    navigateToNext();
  };
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    onButtonClick?.();
  });

  buttonsContainer.appendChild(button);
}

function removeButton(): void {
  document.querySelector(`.${BUTTON_CLASS}`)?.remove();
  onButtonClick = null;
}

function onPopupMutation(popup: Element): void {
  const isVisible = !popup.classList.contains('hidden');
  if (isVisible) {
    const currentGuid = (popup as HTMLElement).dataset.guid ?? null;
    // MutationObserver может сработать несколько раз для одного открытия
    // (class, data-guid, childList). Обнулять expectedNextGuid только
    // когда он совпал или когда точно ручное открытие другой точки.
    if (currentGuid === expectedNextGuid) {
      expectedNextGuid = null;
    } else if (currentGuid !== lastSeenGuid) {
      visited.clear();
      chainOrigin = null;
      expectedNextGuid = null;
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

export const nextPointNavigation: IFeatureModule = {
  id: MODULE_ID,
  name: { en: 'Next point navigation', ru: 'Переход к следующей точке' },
  description: {
    en: 'Navigate sequentially to the nearest unvisited points from the popup',
    ru: 'Последовательная навигация по ближайшим точкам из попапа',
  },
  defaultEnabled: true,
  category: 'feature',

  init() {},

  enable() {
    return getOlMap().then((olMap) => {
      const pointsLayer = findPointsLayer(olMap);
      if (!pointsLayer) return;

      const source = pointsLayer.getSource();
      if (!source) return;

      map = olMap;
      pointsSource = source;

      injectStyles(styles, MODULE_ID);
      observePopup();
    });
  },

  disable() {
    if (popupObserver) {
      popupObserver.disconnect();
      popupObserver = null;
    }

    removeButton();
    removeStyles(MODULE_ID);

    map = null;
    pointsSource = null;
    visited.clear();
    chainOrigin = null;
    expectedNextGuid = null;
    lastSeenGuid = null;
  },
};
