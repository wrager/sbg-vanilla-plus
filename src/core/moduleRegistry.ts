import type { ILocalizedString } from './l10n';
import { t } from './l10n';

export interface IFeatureModule {
  id: string;
  name: ILocalizedString;
  description: ILocalizedString;
  defaultEnabled: boolean;
  category: 'ui' | 'map' | 'utility' | 'fix';
  requiresReload?: boolean;
  status?: 'ready' | 'failed';
  init(): void;
  enable(): void | Promise<void>;
  disable(): void | Promise<void>;
}

export type ModuleErrorCallback = (id: string, message: string) => void;

function handleModuleError(mod: IFeatureModule, e: unknown, onError?: ModuleErrorCallback): void {
  const errorString = e instanceof Error ? (e.stack ?? e.message) : String(e);
  console.warn(`[SVP] Модуль "${t(mod.name)}" не загрузился:`, e);
  mod.status = 'failed';
  onError?.(mod.id, errorString);
}

export function catchAsyncModuleError(
  action: () => void | Promise<void>,
  onError: (e: unknown) => void,
): void {
  const result = action();
  if (result instanceof Promise) {
    result.catch(onError);
  }
}

export function initModules(
  modules: IFeatureModule[],
  isEnabled: (id: string) => boolean,
  onError?: ModuleErrorCallback,
): void {
  for (const mod of modules) {
    try {
      mod.init();
      if (isEnabled(mod.id)) {
        catchAsyncModuleError(mod.enable.bind(mod), (e: unknown) => {
          handleModuleError(mod, e, onError);
        });
      }
      mod.status = 'ready';
    } catch (e) {
      handleModuleError(mod, e, onError);
    }
  }
}
