import type { IFeatureModule } from '../../core/moduleRegistry';
import { installPopoverCloser, uninstallPopoverCloser } from './popoverCloser';

const MODULE_ID = 'betterRefPopoverClosing';

export const betterRefPopoverClosing: IFeatureModule = {
  id: MODULE_ID,
  name: { en: 'Ref actions menu auto-close', ru: 'Закрытие меню действий ключа' },
  description: {
    en: 'Auto-closes the actions popover (Favorite / Lock / Removal menu) after a click. Native game leaves the popover open and requires a second click on the ellipsis menu.',
    ru: 'Авто-закрытие выпадающего меню действий (Favorite / Lock / Removal menu) после клика. В нативной игре меню остаётся открытым и требует повторного клика по троеточию.',
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
