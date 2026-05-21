import type { IFeatureModule } from '../../core/moduleRegistry';
import { injectStyles, removeStyles } from '../../core/dom';
import { installDrawFilter, uninstallDrawFilter } from './drawFilter';
import { refreshOpenPopup } from './refreshOpenPopup';
import { migrateLegacyStarCenter } from './starCenter';
import { installSettingsUi, uninstallSettingsUi } from './settingsUi';
import { installStarCenterButton, uninstallStarCenterButton } from './starCenterButton';
import { installStarCenterHighlight, uninstallStarCenterHighlight } from './starCenterHighlight';
import { installStarCenterMapToggle, uninstallStarCenterMapToggle } from './starCenterMapToggle';
import styles from './styles.css?inline';

const MODULE_ID = 'drawingRestrictions';

export const drawingRestrictions: IFeatureModule = {
  id: MODULE_ID,
  name: {
    en: 'Drawing restrictions',
    ru: 'Ограничения рисования',
  },
  description: {
    en: 'Adds a "star" drawing mode and a distance filter',
    ru: 'Добавляет режим рисования «звезда» и фильтр по дальности',
  },
  defaultEnabled: true,
  category: 'feature',

  init() {},

  enable() {
    // Eager миграция legacy-формата starCenter ({guid} -> {guid, active:true})
    // ДО install-функций: starCenterButton / starCenterMapToggle / highlight
    // на первом updateButtons / applyState читают LS, должны увидеть уже
    // унифицированный формат.
    migrateLegacyStarCenter();
    injectStyles(styles, MODULE_ID);
    installDrawFilter();
    installSettingsUi();
    installStarCenterButton();
    installStarCenterMapToggle();
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
    uninstallStarCenterMapToggle();
    uninstallStarCenterHighlight();
    removeStyles(MODULE_ID);
  },
};
