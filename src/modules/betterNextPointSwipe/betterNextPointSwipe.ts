import type { IFeatureModule } from '../../core/moduleRegistry';
import { isModuleActive } from '../../core/moduleRegistry';
import { getOlMap, findLayerByName } from '../../core/olMap';
import type { IOlMap, IOlVectorSource } from '../../core/olMap';
import { pickNextInRange } from '../../core/nextPointPicker';

const MODULE_ID = 'betterNextPointSwipe';
const ANIMATION_MODULE_ID = 'nextPointSwipeAnimation';
const POPUP_SELECTOR = '.info.popup';
const INTERACTION_RANGE = 45;

interface IHammerProto {
  emit(this: unknown, name: string, data: unknown): void;
}
interface HammerWindow {
  Hammer?: { Manager?: { prototype: IHammerProto } };
}

let map: IOlMap | null = null;
let pointsSource: IOlVectorSource | null = null;
let playerSource: IOlVectorSource | null = null;
const rangeVisited = new Set<string | number>();
let originalHammerEmit: ((this: unknown, name: string, data: unknown) => void) | null = null;
// Защита от race-disable: enable содержит await getOlMap. Если disable
// вызовется до резолва, текущий generation расходится с myGeneration -
// выходим до установки override.
let installGeneration = 0;

function getPlayerCoords(): number[] | null {
  if (!playerSource) return null;
  const features = playerSource.getFeatures();
  if (features.length === 0) return null;
  return features[0].getGeometry().getCoordinates();
}

/**
 * Свайп влево/вправо на .info (вне .splide-карусели ядер) - открывает
 * следующую точку по нашему приоритету в радиусе действия игрока, без
 * нативной проверки near_points.length <= 1 и без isInRange-фильтра, который
 * блокирует нативный свайп когда игрок далеко от точек.
 */
function navigateToNextPoint(): void {
  if (!map || !pointsSource) return;
  if (typeof window.showInfo !== 'function') return;
  const playerCoords = getPlayerCoords();
  if (!playerCoords) return;
  const popup = document.querySelector(POPUP_SELECTOR);
  if (!popup || popup.classList.contains('hidden')) return;
  const currentGuid = (popup as HTMLElement).dataset.guid;
  if (!currentGuid) return;

  const next = pickNextInRange({
    playerCoords,
    features: pointsSource.getFeatures(),
    currentGuid,
    visited: rangeVisited,
    radiusMeters: INTERACTION_RANGE,
  });
  if (!next) return;
  const nextId = next.getId();
  if (nextId === undefined) return;
  rangeVisited.add(String(nextId));
  window.showInfo(String(nextId));
}

/**
 * Runtime-override на Hammer.Manager.prototype.emit. На swipeleft/swiperight
 * с target внутри .info (но не внутри .splide-карусели ядер) - подавляем
 * нативный handler игры (он бы упёрся в проверку near_points.length <= 1
 * для пустого radius) и зовём свою навигацию. Если активен модуль анимации
 * (nextPointSwipeAnimation), не вызываем свою навигацию - она же сделает
 * это в своём finalize после dismiss-анимации, не дублируем.
 *
 * Альтернативный путь через text-патч game-script (gameScriptPatcher) не
 * выбран: runtime-override менее инвазивен, не требует обновления
 * поисковой строки при минорных правках script.js игры.
 */
function installHammerOverride(): void {
  const proto = (window as unknown as HammerWindow).Hammer?.Manager?.prototype;
  if (!proto || typeof proto.emit !== 'function') {
    console.warn(`[SVP ${MODULE_ID}] Hammer.Manager.prototype.emit недоступен`);
    return;
  }
  if (originalHammerEmit) return;
  // eslint-disable-next-line @typescript-eslint/unbound-method -- сохраняем оригинал для restore и call.apply через any-this
  originalHammerEmit = proto.emit;
  proto.emit = function (this: unknown, name: string, data: unknown): void {
    if (name === 'swipeleft' || name === 'swiperight') {
      const eventData = data as { target?: Element | null } | undefined;
      const target = eventData?.target;
      if (
        target instanceof Element &&
        target.closest('.info') !== null &&
        target.closest('.splide') === null
      ) {
        if (!isModuleActive(ANIMATION_MODULE_ID)) {
          navigateToNextPoint();
        }
        return;
      }
    }
    originalHammerEmit?.call(this, name, data);
  };
}

function uninstallHammerOverride(): void {
  if (!originalHammerEmit) return;
  const proto = (window as unknown as HammerWindow).Hammer?.Manager?.prototype;
  if (proto) proto.emit = originalHammerEmit;
  originalHammerEmit = null;
}

export const betterNextPointSwipe: IFeatureModule = {
  id: MODULE_ID,
  name: {
    en: 'Better next point swipe',
    ru: 'Улучшенный свайп к следующей точке',
  },
  description: {
    en: 'Swipe left/right on the point popup jumps to the next point in interaction range with priority routing (free slots > discoverable > nearest)',
    ru: 'Свайп влево/вправо на попапе точки переходит к следующей точке в радиусе взаимодействия с приоритетом по полезности (свободные слоты > доступная для изучения > ближайшая)',
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
      map = olMap;
      pointsSource = source;
      playerSource = playerLayer?.getSource() ?? null;
      installHammerOverride();
    });
  },
  disable() {
    installGeneration++;
    uninstallHammerOverride();
    map = null;
    pointsSource = null;
    playerSource = null;
    rangeVisited.clear();
  },
};

// ── Test hooks ───────────────────────────────────────────────────────────────

export function navigateToNextPointForTest(): void {
  navigateToNextPoint();
}
