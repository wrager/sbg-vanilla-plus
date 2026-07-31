import { getToastifyFactory } from '../../core/toastify';
import type { IFeatureModule } from '../../core/moduleRegistry';
import { installToastBlock } from './toastBlock';

const MODULE_ID = 'compactToasts';

let restorePatch: (() => void) | null = null;

export const compactToasts: IFeatureModule = {
  id: MODULE_ID,
  name: { en: 'Compact toasts', ru: 'Компактные тосты' },
  description: {
    en: 'Notifications shown at the same time merge into one block with a repeat counter',
    ru: 'Одновременные уведомления собираются в один блок со счётчиком повторов',
  },
  defaultEnabled: true,
  category: 'ui',
  init() {},
  enable() {
    const factory = getToastifyFactory();
    if (factory === null) {
      // Игра без Toastify не стартует (refs/game/script.js:16-27), так что
      // собирать нечего. Бросать нельзя: модуль ушёл бы в failed и повесил
      // ошибку в настройках там, где не работает и сама игра.
      console.warn('[SVP] Toastify недоступен, сборка тостов не включена');
      return;
    }
    restorePatch = installToastBlock(factory.prototype);
  },
  disable() {
    restorePatch?.();
    restorePatch = null;
  },
};
