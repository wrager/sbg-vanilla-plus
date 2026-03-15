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
  init(): void | Promise<void>;
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

export function runModuleAction(
  action: () => void | Promise<void>,
  onError: (e: unknown) => void,
): void | Promise<void> {
  try {
    const result = action();
    if (result instanceof Promise) {
      return result.catch(onError);
    }
  } catch (e) {
    onError(e);
  }
}

export function initModules(
  modules: IFeatureModule[],
  isEnabled: (id: string) => boolean,
  onError?: ModuleErrorCallback,
): void {
  for (const mod of modules) {
    const errorHandler = (e: unknown): void => {
      handleModuleError(mod, e, onError);
    };

    const enableIfNeeded = (): void => {
      if (mod.status !== 'failed' && isEnabled(mod.id)) {
        void runModuleAction(mod.enable.bind(mod), errorHandler);
      }
      if (mod.status !== 'failed') {
        mod.status = 'ready';
      }
    };

    const initResult = runModuleAction(mod.init.bind(mod), errorHandler);

    if (initResult instanceof Promise) {
      void initResult.then(enableIfNeeded);
    } else {
      enableIfNeeded();
    }
  }
}
