import { $, injectStyles, removeStyles } from '../../core/dom';
import type { IFeatureModule } from '../../core/moduleRegistry';
import styles from './styles.css?inline';
import wandButtonStyles from './wandButton.css?inline';

const MODULE_ID = 'enhancedPointPopupUi';
const WAND_BUTTON_MODULE_ID = `${MODULE_ID}-wand`;
const WAND_BUTTON_SELECTOR = '#magic-deploy-btn';

let wandButtonObserver: MutationObserver | null = null;

function syncWandButtonStyles(): void {
  if ($(WAND_BUTTON_SELECTOR)) {
    if (!document.getElementById(`svp-${WAND_BUTTON_MODULE_ID}`)) {
      injectStyles(wandButtonStyles, WAND_BUTTON_MODULE_ID);
    }
  } else {
    removeStyles(WAND_BUTTON_MODULE_ID);
  }
}

export const enhancedPointPopupUi: IFeatureModule = {
  id: MODULE_ID,
  name: { en: 'Enhanced Point Popup UI', ru: 'Улучшенный UI попапа точки' },
  description: {
    en: 'Larger buttons, smaller text, auto-deploy hidden from accidental taps',
    ru: 'Крупные кнопки, мелкий текст, авто-простановка убрана от случайных нажатий',
  },
  defaultEnabled: true,
  category: 'ui',
  init() {},
  enable() {
    injectStyles(styles, MODULE_ID);
    wandButtonObserver?.disconnect();
    wandButtonObserver = new MutationObserver(syncWandButtonStyles);
    wandButtonObserver.observe(document.body, { childList: true, subtree: true });
    syncWandButtonStyles();
  },
  disable() {
    wandButtonObserver?.disconnect();
    wandButtonObserver = null;
    removeStyles(WAND_BUTTON_MODULE_ID);
    removeStyles(MODULE_ID);
  },
};
