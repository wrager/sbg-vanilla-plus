import type { IFeatureModule } from '../../core/moduleRegistry';
import { injectStyles, removeStyles } from '../../core/dom';
import { installSettingsUi, uninstallSettingsUi } from './settingsUi';
import styles from './styles.css?inline';

const MODULE_ID = 'drawingRestrictions';

export const drawingRestrictions: IFeatureModule = {
  id: MODULE_ID,
  name: {
    en: 'Drawing restrictions',
    ru: 'Ограничения рисования',
  },
  description: {
    en: 'Hide favorited targets, too-far targets, and non-center targets (star mode) from the draw list. Prevents accidental line drawing to unwanted points.',
    ru: 'Скрывает из списка рисования избранные цели, слишком далёкие цели и все цели кроме центра звезды. Предотвращает случайное рисование линий на нежелательные точки.',
  },
  defaultEnabled: true,
  category: 'feature',

  init() {
    // Загружает настройки (и мигрирует hideLastFavRef из favoritedPoints при первом запуске).
    // Дальше фильтр подключается в enable() — см. последующие коммиты.
  },

  enable() {
    injectStyles(styles, MODULE_ID);
    installSettingsUi();
  },

  disable() {
    uninstallSettingsUi();
    removeStyles(MODULE_ID);
  },
};
