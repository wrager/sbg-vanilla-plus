import type { IFeatureModule } from '../../core/moduleRegistry';
import { injectStyles, removeStyles } from '../../core/dom';
import {
  installPopupSwipe,
  registerDirection,
  uninstallPopupSwipe,
  type ISwipeDirectionHandler,
  type SwipeOutcome,
} from '../../core/popupSwipe';
import styles from './styles.css?inline';

const MODULE_ID = 'swipeToClosePopup';

const POPUP_SELECTOR = '.info';

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
  const popup = document.querySelector<HTMLElement>(POPUP_SELECTOR);
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
    en: 'Closes the point popup with a swipe up gesture: the popup follows the finger, then animates off-screen on release. Anywhere inside the popup except the cores slider, where the swipe stays for the carousel.',
    ru: 'Закрывает попап точки жестом свайпа вверх: попап едет за пальцем и при отпускании плавно улетает наверх. Работает по всему попапу кроме слайдера ядер, где свайп остаётся за каруселью.',
  },
  defaultEnabled: true,
  category: 'feature',
  init() {},
  enable() {
    injectStyles(styles, MODULE_ID);
    const handler: ISwipeDirectionHandler = { canStart, decide, finalize };
    unregister = registerDirection('up', handler);
    installPopupSwipe(POPUP_SELECTOR);
  },
  disable() {
    if (unregister) {
      unregister();
      unregister = null;
    }
    // uninstallPopupSwipe вызывается тут безусловно: если другой модуль (например,
    // improvedNextPointSwipe) тоже пользуется popupSwipe, его enable()
    // переинициализирует listener'ы. Это допустимо: повторный install
    // идемпотентен по touch-action, и зарегистрированные handler'ы не сбрасываются.
    uninstallPopupSwipe();
    removeStyles(MODULE_ID);
  },
};
