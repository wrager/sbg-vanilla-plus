import { waitForElement } from '../../core/dom';
import type { IFeatureModule } from '../../core/moduleRegistry';
import { getOlMap, findLayerByName } from '../../core/olMap';
import type { IOlMap, IOlFeature, IOlVectorSource } from '../../core/olMap';
import {
  installPopupSwipe,
  registerDirection,
  uninstallPopupSwipe,
  type SwipeOutcome,
} from '../../core/popupSwipe';

const MODULE_ID = 'improvedNextPointSwipe';
const POPUP_SELECTOR = '.info';
const INTERACTION_RANGE = 45;
const AUTOZOOM_THRESHOLD = 16;
const AUTOZOOM_TARGET = 17;
const AUTOZOOM_TIMEOUT_MS = 3000;
// Длительность dismiss/return-анимации (мс). Исходный дефолт core/popupSwipe -
// 300мс - маскировал await /api/point внутри game's showInfo (round-trip
// 100-300мс), но ощущался медленно. 120мс - резкий отклик на жест; кратко
// видна "дыра" между улетающим попапом и появлением нового на медленной сети,
// но "дыра" воспринимается как загрузка, а не как лаг скрипта.
const SWIPE_NEXT_ANIMATION_MS = 120;

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
let unregisterLeft: (() => void) | null = null;
let unregisterRight: (() => void) | null = null;
// installGeneration защищает от race условий между async enable и быстрым
// disable. enable содержит await getOlMap() - если disable отработал во время
// await, мы должны выйти из enable до записи map/pointsSource, регистрации
// направлений и подключения popupSwipe, иначе direction-handler'ы и observer
// останутся вечно при логически-disabled модуле. Тот же паттерн в pointTextFix
// (коммит 168da1a), popoverCloser и nativeGarbageGuard.
let installGeneration = 0;
// Результат decide() запоминается между decide и finalize: на decide мы решаем,
// есть ли следующая точка (true -> 'dismiss'), а в finalize вызываем openPointPopup
// для уже выбранного guid. Хранение между двумя callback'ами избегает второго
// прохода tryNavigateInRange (он недетерминирован при изменениях точек/попапа
// между touchend и transitionend).
let pendingNavigationGuid: string | null = null;

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

/**
 * Выбирает guid следующей точки по приоритету в радиусе действия. Возвращает
 * null если кандидатов нет (все in-range посещены и зацикливание тоже не нашло).
 * НЕ открывает попап и не трогает state - чистая функция выбора, чтобы decide()
 * мог вернуть outcome без побочных эффектов.
 */
export function pickNextGuidInRange(): string | null {
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

  if (!next) return null;
  const nextId = next.getId();
  return nextId === undefined ? null : String(nextId);
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
    const guid = pickNextGuidInRange();
    if (guid) openPointPopup(guid);
  };
  const onSourceChange = (): void => {
    finish();
  };
  pointsSource.on('change', onSourceChange);
  setTimeout(finish, AUTOZOOM_TIMEOUT_MS);
}

// ── Direction handler ───────────────────────────────────────────────────────

/**
 * decide вызывается core/popupSwipe на touchend после passed-threshold жеста.
 * Если кандидат в радиусе есть - запоминаем guid в pendingNavigationGuid и
 * возвращаем 'dismiss' (попап улетает в направлении свайпа). Если кандидатов
 * нет - возвращаем 'return' (анимация возврата как явная обратная связь
 * "следующей нет"). autozoom-fallback запускается при 'return', чтобы при
 * низком зуме после reload точек повторить попытку через openPointPopup
 * напрямую.
 */
function decide(): SwipeOutcome {
  const guid = pickNextGuidInRange();
  if (guid) {
    pendingNavigationGuid = guid;
    return 'dismiss';
  }
  pendingNavigationGuid = null;
  if (!autozoomInProgress) {
    autozoomAndNavigate();
  }
  return 'return';
}

function finalize(): void {
  if (!pendingNavigationGuid) return;
  const guid = pendingNavigationGuid;
  pendingNavigationGuid = null;
  openPointPopup(guid);
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
 * gesture-emit на любом Hammer-instance страницы. Если модуль enabled, имя -
 * swipeleft/swiperight и element - .info, нативный listener (refs/game/script.js:727-752,
 * перебор near_points) подавляется: emit просто не доходит до handler'ов
 * игры. Сама навигация теперь делается через core/popupSwipe-touch-listener,
 * параллельно с Hammer'ом по тем же touch-events; Hammer всё равно
 * распознаёт жест и emit'ит, поэтому без этого patch'а игра тоже бы переключила
 * точку через своих listener'ов на swipeleft/swiperight.
 *
 * Patch ставится один раз за жизнь страницы; повторный install no-op. Снять
 * patch нельзя, но при interceptEnabled=false вся ветка - pass-through.
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
        // Нативный обработчик подавлен; навигацию делает наш direction-handler
        // в core/popupSwipe (вызывается из onTouchEnd с анимацией dismiss/return).
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
      const guid = pickNextGuidInRange();
      if (guid) {
        openPointPopup(guid);
      } else if (!autozoomInProgress) {
        autozoomAndNavigate();
      }
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
    en: 'Replaces the native horizontal swipe between adjacent points (cycle through all visible features) with a smarter walk: in the player interaction range, with priority free-deploy-slots > discoverable > nearest. The popup follows the finger during the swipe and animates off-screen on release; if no next point exists, the popup snaps back as explicit feedback. Auto-zooms to 17 if the current zoom is too low to load nearby points. The native swipe handler is suppressed via a Hammer.Manager.prototype.emit patch.',
    ru: 'Заменяет нативный горизонтальный свайп между соседними точками (циклический перебор всех видимых) умной навигацией: только в радиусе действия игрока, с приоритетом свободные слоты > доступная для изучения > ближайшая. Попап едет за пальцем во время свайпа и улетает в сторону при отпускании; если следующей точки нет, попап возвращается на место - явная обратная связь. Если зум слишком низкий и точки рядом не подгружены - сдвигает viewport к игроку и зумит до 17. Нативный обработчик подавляется через patch Hammer.Manager.prototype.emit.',
  },
  defaultEnabled: true,
  category: 'feature',

  init() {
    // installHammerInterceptor раньше вызывался здесь, но это ставило
    // monkey-patch на Hammer.Manager.prototype.emit для всех пользователей,
    // в том числе тех, кто отключил improvedNextPointSwipe через настройки.
    // Внутри patched-функции interceptEnabled-флаг быстро no-op'ит ветку
    // блокировки, но сама обёртка emit остаётся глобальной для всех
    // Hammer-instance'ов страницы. Перенесли установку в enable: если
    // пользователь отключил модуль - patch вообще никогда не появляется,
    // прототип Hammer.Manager не трогается. Аналогичная правка для
    // window.fetch-патча в pointTextFix - коммит 663aa01.
  },

  enable() {
    installGeneration++;
    const myGeneration = installGeneration;
    return getOlMap().then((olMap) => {
      // disable отработал между стартом enable и резолвом getOlMap - выходим до
      // записи map/pointsSource и регистраций direction-handler'ов, чтобы при
      // логически-disabled модуле не остались наши left/right в popupSwipe и
      // observer на попапе.
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
      interceptEnabled = true;
      // Lazy install: первый enable ставит patch; повторные no-op через
      // interceptInstalled внутри installHammerInterceptor. После первого
      // enable patch остаётся жить до конца сессии (повторные enable/disable
      // идемпотентны), потому что снятие patch требует проверить что между
      // install и uninstall никто не переписал Hammer.Manager.prototype.emit
      // поверх - архитектурно дороже выгод.
      installHammerInterceptor();
      observePopup();

      // Регистрация двух направлений с одинаковым handler: и left, и right
      // совершают навигацию к следующей точке по радиусу. Разница только в
      // направлении dismiss-анимации (попап улетает влево или вправо
      // соответственно), что core/popupSwipe рисует автоматически.
      // animationDurationMs=120: дефолт core/popupSwipe (300мс) ощущался как
      // лаг; 120мс - резкий отклик. Аналог per-handler duration в
      // swipeToClosePopup (150мс) - коммит 0096e91.
      unregisterLeft = registerDirection('left', {
        decide,
        finalize,
        animationDurationMs: SWIPE_NEXT_ANIMATION_MS,
      });
      unregisterRight = registerDirection('right', {
        decide,
        finalize,
        animationDurationMs: SWIPE_NEXT_ANIMATION_MS,
      });
      installPopupSwipe(POPUP_SELECTOR);
    });
  },

  disable() {
    installGeneration++;
    interceptEnabled = false;
    if (unregisterLeft) {
      unregisterLeft();
      unregisterLeft = null;
    }
    if (unregisterRight) {
      unregisterRight();
      unregisterRight = null;
    }
    uninstallPopupSwipe();
    pendingNavigationGuid = null;
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
