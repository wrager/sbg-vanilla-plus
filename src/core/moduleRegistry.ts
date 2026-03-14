import type { ILocalizedString } from './l10n';
import { t } from './l10n';

export interface IFeatureModule {
  id: string;
  name: ILocalizedString;
  description: ILocalizedString;
  defaultEnabled: boolean;
  script: 'style' | 'features';
  requiresReload?: boolean;
  status?: 'ready' | 'failed';
  init(): void;
  enable(): void;
  disable(): void;
}

export function initModules(modules: IFeatureModule[], isEnabled: (id: string) => boolean): void {
  for (const mod of modules) {
    try {
      mod.init();
      if (isEnabled(mod.id)) {
        mod.enable();
      }
      mod.status = 'ready';
    } catch (e) {
      console.warn(`[SVP] Модуль "${t(mod.name)}" не загрузился:`, e);
      mod.status = 'failed';
    }
  }
}
