import type { IFeatureModule } from '../../core/moduleRegistry';
import { isModuleActive } from '../../core/moduleRegistry';
import { getOlMap, findLayerByName } from '../../core/olMap';
import type { IOlFeature, IOlMap, IOlMapEvent, IOlVectorSource } from '../../core/olMap';
import {
  installPopupSwipe,
  registerDirection,
  uninstallPopupSwipe,
  type ISwipeDirectionHandler,
  type SwipeOutcome,
} from '../../core/popupSwipe';
import { findFeaturesInRange, pickNextInRange } from '../../core/nextPointPicker';
import { POINT_POPUP_SELECTOR } from '../../core/pointPopup';

const MODULE_ID = 'nextPointSwipeAnimation';
const FEATURE_MODULE_ID = 'improvedNextPointSwipe';
const INTERACTION_RANGE = 45;
// Длительность dismiss/return-анимации (мс). Короче дефолтных 300мс из
// core/popupSwipe: горизонтальный свайп должен ощущаться мгновенным, а 300мс
// маскировали бы apiQuery внутри showInfo (round-trip 100-300мс). 120мс -
// резкий отклик; кратко видна "дыра" между улетающим попапом и приходом
// нового на медленной сети, но воспринимается как загрузка, не как лаг скрипта.
const SWIPE_ANIMATION_MS = 120;

let map: IOlMap | null = null;
let pointsSource: IOlVectorSource | null = null;
let playerSource: IOlVectorSource | null = null;
const rangeVisited = new Set<string | number>();
// Снапшот near_points игры: id точек, бывших в радиусе игрока на момент
// последнего тапа по точке на карте. Игра поддерживает свой near_points через
// map.singleclick handler (refs/game/script.js:540-560), наш модуль ведёт
// собственный параллельный снимок, чтобы decideSwipe (в режиме без
// improvedNextPointSwipe) точно предсказывал, переключит ли native handler точку
// при свайпе. Live-вычисление через findFeaturesInRange расходилось бы с
// near_points, если игрок успевал двинуться между тапом и свайпом - предиктор
// тогда давал бы false-positive/false-negative и dismiss-анимация рассинхронилась
// бы с native showInfo.
let nearPointsSnapshot = new Set<string | number>();
// Guid точки, выбранной в decide() и ожидающей открытия в finalize() после
// dismiss-анимации. Сериализован state machine'ом core/popupSwipe (idle ->
// tracking -> swiping -> animating -> idle) - race между жестами невозможен.
let pendingNextGuid: string | null = null;
let unregisterLeft: (() => void) | null = null;
let unregisterRight: (() => void) | null = null;
let onMapSingleClickRef: ((event: IOlMapEvent) => void) | null = null;
// Защита от race-disable: enable содержит await getOlMap. Если disable
// вызовется до резолва, текущий generation расходится с myGeneration -
// выходим до registerDirection.
let installGeneration = 0;

function getPlayerCoords(): number[] | null {
  if (!playerSource) return null;
  const features = playerSource.getFeatures();
  if (features.length === 0) return null;
  return features[0].getGeometry().getCoordinates();
}

/**
 * Реплика игрового map.singleclick-handler (refs/game/script.js:540-560):
 * если клик пришёл по фиче слоя `points`, обновляем снапшот точек в радиусе
 * игрока. Игра использует это значение в своём horizontal-swipe handler
 * (refs/game/script.js:741-751) - переключает на следующую точку только если
 * `near_points.length > 1`. Воспроизводим то же поведение, чтобы предиктор
 * dismiss-анимации в decideSwipe (когда improvedNextPointSwipe выключен) был
 * синхронен с тем, что фактически сделает native handler.
 */
function onMapSingleClick(event: IOlMapEvent): void {
  if (!map || !pointsSource) return;
  if (typeof map.forEachFeatureAtPixel !== 'function') return;
  // Игра в singleclick собирает попадания в массив `piv` (refs/game/script.js:540)
  // и проверяет .length > 0; повторяем тот же паттерн.
  const hits: IOlFeature[] = [];
  map.forEachFeatureAtPixel(event.pixel, (feature, layer) => {
    if (layer.get('name') === 'points') hits.push(feature);
  });
  if (hits.length === 0) return;
  const playerCoords = getPlayerCoords();
  if (!playerCoords) {
    nearPointsSnapshot.clear();
    return;
  }
  const inRange = findFeaturesInRange(playerCoords, pointsSource.getFeatures(), INTERACTION_RANGE);
  const nextSnapshot = new Set<string | number>();
  for (const feature of inRange) {
    const id = feature.getId();
    if (id !== undefined) nextSnapshot.add(id);
  }
  nearPointsSnapshot = nextSnapshot;
}

/**
 * canStart-фильтр: исключает горизонтальный свайп внутри карусели ядер
 * (.splide). Splide там обрабатывает свои жесты, мы не должны им мешать.
 */
function canStartHorizontalSwipe(event: TouchEvent): boolean {
  const target = event.target;
  if (!(target instanceof Element)) return true;
  if (target.classList.contains('info')) return true;
  if (target.closest('.splide') !== null) return false;
  return true;
}

/**
 * Решает, анимировать dismiss (попап улетит) или return (фейковая, отскок).
 *
 * Поведение определяется состоянием improvedNextPointSwipe:
 *
 *  - improvedNextPointSwipe активен: native handler подавлен через Hammer-override.
 *    Используем нашу priority logic (pickNextInRange). Нашли кандидата -
 *    dismiss + pendingNextGuid, finalize вызовет window.showInfo. Не нашли -
 *    return (анимация впустую, переключения не будет).
 *  - improvedNextPointSwipe выключен: native handler жив. Наша priority НЕ должна
 *    срабатывать - пользователь специально отключил «улучшенный свайп»,
 *    ожидая чисто нативного поведения. Предсказываем native-условие
 *    `near_points.length > 1` через свой `nearPointsSnapshot`, который
 *    обновляется в `onMapSingleClick`-handler-е по той же логике, что и
 *    игровой near_points (refs/game/script.js:540-560). >= 2 точек в снапшоте -
 *    dismiss без pendingNextGuid: native showInfo сработает синхронно в
 *    touchend, наш finalize ничего не делает. Иначе - return.
 */
function decideSwipe(): SwipeOutcome {
  if (!map || !pointsSource) return 'return';
  const popup = document.querySelector(POINT_POPUP_SELECTOR);
  if (!popup || popup.classList.contains('hidden')) return 'return';
  const currentGuid = (popup as HTMLElement).dataset.guid;
  if (!currentGuid) return 'return';

  if (isModuleActive(FEATURE_MODULE_ID)) {
    const playerCoords = getPlayerCoords();
    if (playerCoords) {
      const next = pickNextInRange({
        playerCoords,
        features: pointsSource.getFeatures(),
        currentGuid,
        visited: rangeVisited,
        radiusMeters: INTERACTION_RANGE,
      });
      if (next) {
        const nextId = next.getId();
        if (nextId !== undefined) {
          pendingNextGuid = String(nextId);
          return 'dismiss';
        }
      }
    }
    return 'return';
  }

  if (nearPointsSnapshot.size > 1) {
    pendingNextGuid = null;
    return 'dismiss';
  }
  return 'return';
}

function finalizeSwipe(): void {
  if (pendingNextGuid === null) return;
  const guid = pendingNextGuid;
  pendingNextGuid = null;
  if (typeof window.showInfo !== 'function') return;
  rangeVisited.add(guid);
  window.showInfo(guid);
}

const swipeHandler: ISwipeDirectionHandler = {
  canStart: canStartHorizontalSwipe,
  decide: decideSwipe,
  finalize: finalizeSwipe,
  animationDurationMs: SWIPE_ANIMATION_MS,
  // data-guid меняется во время animateDismiss в двух кейсах: либо native
  // game's Hammer-handler синхронно в touchend сделал showInfo (когда
  // improvedNextPointSwipe выключен), либо наш finalize вызовет showInfo
  // после transitionend. В обоих случаях animation должна досмотреть -
  // popupSwipe observer не должен её рвать через cleanupAnimation.
  keepAnimatingOnDataGuidChange: true,
};

export const nextPointSwipeAnimation: IFeatureModule = {
  id: MODULE_ID,
  name: {
    en: 'Next point swipe animation',
    ru: 'Анимация свайпа к следующей точке',
  },
  description: {
    en: 'Animates the popup during left/right swipe: flies away when next point exists, bounces back when not',
    ru: 'Анимация попапа при свайпе влево/вправо: улетает в направлении жеста когда есть следующая точка, отскакивает обратно когда нет',
  },
  defaultEnabled: true,
  category: 'ui',
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
      map = olMap;
      pointsSource = source;
      playerSource = playerLayer?.getSource() ?? null;
      unregisterLeft = registerDirection('left', swipeHandler);
      unregisterRight = registerDirection('right', swipeHandler);
      installPopupSwipe(POINT_POPUP_SELECTOR);
      if (typeof olMap.on === 'function') {
        onMapSingleClickRef = onMapSingleClick;
        olMap.on('singleclick', onMapSingleClickRef);
      }
    });
  },
  disable() {
    installGeneration++;
    if (map && onMapSingleClickRef && typeof map.un === 'function') {
      map.un('singleclick', onMapSingleClickRef);
    }
    onMapSingleClickRef = null;
    unregisterLeft?.();
    unregisterLeft = null;
    unregisterRight?.();
    unregisterRight = null;
    uninstallPopupSwipe();
    map = null;
    pointsSource = null;
    playerSource = null;
    rangeVisited.clear();
    nearPointsSnapshot.clear();
    pendingNextGuid = null;
  },
};

// ── Test hooks ───────────────────────────────────────────────────────────────

export function decideForTest(): SwipeOutcome {
  return decideSwipe();
}

export function finalizeForTest(): void {
  finalizeSwipe();
}

export function canStartForTest(target: EventTarget | null): boolean {
  return canStartHorizontalSwipe({ target } as TouchEvent);
}

export function dispatchSingleClickForTest(event: IOlMapEvent): void {
  onMapSingleClick(event);
}
