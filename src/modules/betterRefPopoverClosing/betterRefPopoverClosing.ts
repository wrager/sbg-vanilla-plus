import type { IFeatureModule } from '../../core/moduleRegistry';
import { installPopoverCloser, uninstallPopoverCloser } from './popoverCloser';

const MODULE_ID = 'betterRefPopoverClosing';

export const betterRefPopoverClosing: IFeatureModule = {
  id: MODULE_ID,
  name: { en: 'Ref actions menu auto-close', ru: 'Закрытие меню действий ключа' },
  description: {
    en: 'Auto-closes the ref actions menu (Favorite / Lock / Removal) after a click.',
    ru: 'Авто-закрытие меню действий ключа (Favorite / Lock / Removal) после клика.',
  },
  defaultEnabled: true,
  category: 'fix',
  init() {},
  enable() {
    installPopoverCloser();
  },
  disable() {
    uninstallPopoverCloser();
  },
};
