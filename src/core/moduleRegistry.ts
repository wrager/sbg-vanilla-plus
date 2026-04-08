import type { ILocalizedString } from './l10n';
import { t } from './l10n';
import { loadSettings, isModuleEnabled } from './settings/storage';

export interface IFeatureModule {
  id: string;
  name: ILocalizedString;
  description: ILocalizedString;
  defaultEnabled: boolean;
  category: 'ui' | 'map' | 'feature' | 'utility' | 'fix';
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

// ── Реестр модулей ───────────────────────────────────────────────────────────

let registeredModules: readonly IFeatureModule[] = [];

/** Регистрирует массив модулей для lookup по id. Вызывается из bootstrap(). */
export function registerModules(modules: readonly IFeatureModule[]): void {
  registeredModules = modules;
}

/** Возвращает модуль по id или undefined, если не найден. */
export function getModuleById(id: string): IFeatureModule | undefined {
  return registeredModules.find((mod) => mod.id === id);
}

/**
 * Модуль и включён пользователем в настройках, И успешно прошёл init/enable
 * (status='ready'). Используется для межмодульных проверок: стоит ли считать,
 * что функции модуля работают и на их результаты можно полагаться.
 */
export function isModuleActive(id: string): boolean {
  const mod = getModuleById(id);
  if (!mod) return false;
  if (mod.status !== 'ready') return false;
  const settings = loadSettings();
  return isModuleEnabled(settings, id, mod.defaultEnabled);
}

// ── Lifecycle ────────────────────────────────────────────────────────────────

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
          void result.then(markReady).catch(enableErrorHandler);
          return;
        }
      }
      markReady();
    };

    const initResult = runModuleAction(mod.init.bind(mod), initErrorHandler);

    if (initResult instanceof Promise) {
      void initResult.then(enableIfNeeded).catch(initErrorHandler);
    } else {
      enableIfNeeded();
    }
  }
}
