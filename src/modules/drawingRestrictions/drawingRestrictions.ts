import type { IFeatureModule } from '../../core/moduleRegistry';
import { injectStyles, removeStyles } from '../../core/dom';
import { installDrawFilter, uninstallDrawFilter } from './drawFilter';
import { refreshOpenPopup } from './refreshOpenPopup';
import { installSettingsUi, uninstallSettingsUi } from './settingsUi';
import { installStarCenterButton, uninstallStarCenterButton } from './starCenterButton';
import {
  installStarCenterClearControl,
  uninstallStarCenterClearControl,
} from './starCenterClearControl';
import { installStarCenterHighlight, uninstallStarCenterHighlight } from './starCenterHighlight';
import styles from './styles.css?inline';

const MODULE_ID = 'drawingRestrictions';

export const drawingRestrictions: IFeatureModule = {
  id: MODULE_ID,
  name: {
    en: 'Drawing restrictions',
    ru: 'Ограничения рисования',
  },
  description: {
    en: 'Adds a star drawing mode (many lines converging on one fixed center) and a distance filter for the drawing target list.',
    ru: 'Добавляет режим рисования звезды (множество линий, сходящихся в одну зафиксированную точку-центр) и фильтр дальности целей рисования.',
  },
  defaultEnabled: true,
  category: 'feature',

  init() {},

  enable() {
    injectStyles(styles, MODULE_ID);
    installDrawFilter();
    installSettingsUi();
    installStarCenterButton();
    installStarCenterClearControl();
    installStarCenterHighlight();
    // Runtime включение модуля при уже открытом попапе: игра получила список
    // целей без фильтра, possible_lines в closure'е stale. Без переоткрытия
    // клик "Рисовать" использует нефильтрованный список, пока пользователь
    // сам не закроет точку.
    refreshOpenPopup();
  },

  disable() {
    uninstallDrawFilter();
    uninstallSettingsUi();
    uninstallStarCenterButton();
    uninstallStarCenterClearControl();
    uninstallStarCenterHighlight();
    removeStyles(MODULE_ID);
  },
};
