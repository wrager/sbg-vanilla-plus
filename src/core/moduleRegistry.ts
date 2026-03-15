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

export type ModulePhase = 'init' | 'enable' | 'disable';

export type ModuleErrorCallback = (id: string, message: string) => void;

const PHASE_LABELS: Record<ModulePhase, string> = {
  init: 'инициализации',
  enable: 'включении',
  disable: 'выключении',
};

function handleModuleError(
  mod: IFeatureModule,
  phase: ModulePhase,
  e: unknown,
  onError?: ModuleErrorCallback,
): void {
  const message = e instanceof Error ? e.message : String(e);
  console.error(`[SVP] Ошибка при ${PHASE_LABELS[phase]} модуля "${t(mod.name)}":`, e);
  mod.status = 'failed';
  onError?.(mod.id, message);
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
  onReady?: (id: string) => void,
): void {
  for (const mod of modules) {
    const initErrorHandler = (e: unknown): void => {
      handleModuleError(mod, 'init', e, onError);
    };
    const enableErrorHandler = (e: unknown): void => {
      handleModuleError(mod, 'enable', e, onError);
    };

    const markReady = (): void => {
      if (mod.status !== 'failed') {
        mod.status = 'ready';
        onReady?.(mod.id);
      }
    };

    const enableIfNeeded = (): void => {
      if (mod.status !== 'failed' && isEnabled(mod.id)) {
        const result = runModuleAction(mod.enable.bind(mod), enableErrorHandler);
        if (result instanceof Promise) {
          void result.then(markReady);
          return;
        }
      }
      markReady();
    };

    const initResult = runModuleAction(mod.init.bind(mod), initErrorHandler);

    if (initResult instanceof Promise) {
      void initResult.then(enableIfNeeded);
    } else {
      enableIfNeeded();
    }
  }
}
