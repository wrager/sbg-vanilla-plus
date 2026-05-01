import type { IFeatureModule } from '../../core/moduleRegistry';
import { injectStyles, removeStyles } from '../../core/dom';
import { POINT_POPUP_SELECTOR } from '../../core/pointPopup';
import {
  installPopupSwipe,
  registerDirection,
  uninstallPopupSwipe,
  type ISwipeDirectionHandler,
  type SwipeOutcome,
} from '../../core/popupSwipe';
import styles from './styles.css?inline';

const MODULE_ID = 'swipeToClosePopup';

// Длительность dismiss/return-анимации (мс). Вдвое короче дефолтных 300мс
// в core/popupSwipe: пользователь хочет почувствовать, что попап ушёл сразу,
// без ожидания.
const SWIPE_TO_CLOSE_ANIMATION_MS = 150;

const CORES_SLIDER_ANCESTOR_SELECTORS = ['.deploy-slider-wrp', '.splide', '#cores-list'];

/**
 * canStart-фильтр: исключает touchstart на слайдере ядер. Splide там обрабатывает
 * собственные жесты карусели, и если мы перехватим вертикаль, пользователь не
 * сможет прокручивать слайдер пальцем.
 */
export function isWithinCoresSlider(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  for (const selector of CORES_SLIDER_ANCESTOR_SELECTORS) {
    if (target.closest(selector)) return true;
  }
  return false;
}

function canStart(event: TouchEvent): boolean {
  return !isWithinCoresSlider(event.target);
}

function decide(): SwipeOutcome {
  return 'dismiss';
}

function finalize(): void {
  // Закрываем через игровую кнопку - оригинальный closePopup делает весь
  // нужный cleanup (popovers, info_cooldown/score таймеры, abort draw).
  const popup = document.querySelector<HTMLElement>(POINT_POPUP_SELECTOR);
  if (!popup) return;
  const closeButton = popup.querySelector('.popup-close');
  if (closeButton instanceof HTMLElement) {
    closeButton.click();
    if (popup.classList.contains('hidden')) return;
  }
  // Fallback: просто прячем, если нет нативной кнопки.
  popup.classList.add('hidden');
  for (const toast of popup.querySelectorAll('.toastify')) {
    toast.remove();
  }
}

let unregister: (() => void) | null = null;

export const swipeToClosePopup: IFeatureModule = {
  id: MODULE_ID,
  name: { en: 'Swipe to close popup', ru: 'Свайп для закрытия попапа' },
  description: {
    en: 'Closes the point popup with a swipe-up gesture.',
    ru: 'Закрывает попап точки свайпом вверх.',
  },
  defaultEnabled: true,
  category: 'feature',
  init() {},
  enable() {
    injectStyles(styles, MODULE_ID);
    const handler: ISwipeDirectionHandler = {
      canStart,
      decide,
      finalize,
      animationDurationMs: SWIPE_TO_CLOSE_ANIMATION_MS,
    };
    unregister = registerDirection('up', handler);
    installPopupSwipe(POINT_POPUP_SELECTOR);
  },
  disable() {
    if (unregister) {
      unregister();
      unregister = null;
    }
    // uninstallPopupSwipe вызывается тут безусловно: если в будущем появятся
    // другие модули-потребители popupSwipe, ref-counter в core корректно
    // развяжет одновременные install/uninstall. Повторный install идемпотентен
    // по touch-action, зарегистрированные handler'ы не сбрасываются.
    uninstallPopupSwipe();
    removeStyles(MODULE_ID);
  },
};
