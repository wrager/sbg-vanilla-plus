import type { ILocalizedString } from './l10n';
import { t } from './l10n';

export interface IFeatureModule {
  id: string;
  name: ILocalizedString;
  description: ILocalizedString;
  defaultEnabled: boolean;
  category: 'style' | 'feature' | 'bugfix';
  requiresReload?: boolean;
  status?: 'ready' | 'failed';
  init(): void;
  enable(): void;
  disable(): void;
}

export type ModuleErrorCallback = (id: string, message: string) => void;

export function initModules(
  modules: IFeatureModule[],
  isEnabled: (id: string) => boolean,
  onError?: ModuleErrorCallback,
): void {
  for (const mod of modules) {
    try {
      mod.init();
      if (isEnabled(mod.id)) {
        mod.enable();
      }
      mod.status = 'ready';
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.warn(`[SVP] Модуль "${t(mod.name)}" не загрузился:`, e);
      mod.status = 'failed';
      onError?.(mod.id, message);
    }
  }
}
