import type { IFeatureModule } from '../../core/moduleRegistry';
import { isModuleActive } from '../../core/moduleRegistry';
import { getOlMap, findLayerByName } from '../../core/olMap';
import type { IOlMap, IOlVectorSource } from '../../core/olMap';
import {
  installPopupSwipe,
  registerDirection,
  uninstallPopupSwipe,
  type ISwipeDirectionHandler,
  type SwipeOutcome,
} from '../../core/popupSwipe';
import { pickNextInRange } from '../../core/nextPointPicker';

const MODULE_ID = 'nextPointSwipeAnimation';
const FEATURE_MODULE_ID = 'betterNextPointSwipe';
const POPUP_SELECTOR = '.info.popup';
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
// Guid точки, выбранной в decide() и ожидающей открытия в finalize() после
// dismiss-анимации. Сериализован state machine'ом core/popupSwipe (idle ->
// tracking -> swiping -> animating -> idle) - race между жестами невозможен.
let pendingNextGuid: string | null = null;
let unregisterLeft: (() => void) | null = null;
let unregisterRight: (() => void) | null = null;
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
 * dismiss выполняем когда переключение точки реально произойдёт - либо нашим
 * priority (pickNextInRange), либо нативным handler-ом игры (если он не
 * подавлен модулем betterNextPointSwipe и near_points достаточно). Native
 * near_points недоступен из closure, поэтому approximate: visible features
 * count > 1 = native почти наверняка переключит. Без этой проверки если у
 * пользователя нет точек в радиусе действия (наш pickNext возвращает null),
 * decide возвращал бы 'return' даже когда native handler параллельно делает
 * navigation - визуальный конфликт "попап отскочил, точка переключилась".
 *
 * pendingNextGuid сохраняется только для нашего priority. При native-кейсе
 * pendingNextGuid=null - finalize ничего не делает, native showInfo уже
 * сработал синхронно в touchend параллельно с нашим animateDismiss.
 */
function decideSwipe(): SwipeOutcome {
  if (!map || !pointsSource) return 'return';
  const popup = document.querySelector(POPUP_SELECTOR);
  if (!popup || popup.classList.contains('hidden')) return 'return';
  const currentGuid = (popup as HTMLElement).dataset.guid;
  if (!currentGuid) return 'return';

  const features = pointsSource.getFeatures();

  // (1) Наш priority: если есть кандидат в радиусе - dismiss с pending guid.
  const playerCoords = getPlayerCoords();
  if (playerCoords) {
    const next = pickNextInRange({
      playerCoords,
      features,
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

  // (2) Priority пусто. Если betterNext активен - native подавлен, переключения
  // не будет, фейковая анимация уместна.
  if (isModuleActive(FEATURE_MODULE_ID)) {
    return 'return';
  }

  // (3) betterNext выключен - native handler жив. Переключит ли он? Native
  // условие: near_points.length > 1. Approximate через visible features count.
  const visibleCount = features.filter((feature) => feature.getId() !== undefined).length;
  if (visibleCount > 1) {
    pendingNextGuid = null;
    return 'dismiss';
  }

  // (4) И наш не нашёл, и native не переключит - true фейковая.
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
  // betterNextPointSwipe выключен), либо наш finalize вызовет showInfo
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
      installPopupSwipe(POPUP_SELECTOR);
    });
  },
  disable() {
    installGeneration++;
    unregisterLeft?.();
    unregisterLeft = null;
    unregisterRight?.();
    unregisterRight = null;
    uninstallPopupSwipe();
    map = null;
    pointsSource = null;
    playerSource = null;
    rangeVisited.clear();
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
