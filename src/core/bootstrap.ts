import { isModuleDisallowedInCurrentHost } from './host';
import type { IFeatureModule } from './moduleRegistry';
import { initModules, registerModules } from './moduleRegistry';
import {
  loadSettings,
  saveSettings,
  persistModuleDefaults,
  isModuleEnabled,
  setModuleEnabled,
  setModuleError,
  clearModuleError,
} from './settings/storage';
import { initSettingsUI } from './settings/ui';
import { injectStyles } from './dom';
import toastStyles from './toast.css?inline';

// Guard от повторного вызова bootstrap(). Повторный init/enable уже
// инициализированных модулей привёл бы к двойным side-effects (например,
// двойной выдаче dragPanControl или двойному оборачиванию view.calculateExtent
// при регрессе в модулях) и к созданию дубликата settings panel в DOM.
// Сценарий повторного вызова в проде: SPA-перенавигация, которая заново
// триггерит DOMContentLoaded; нештатные перезапуски entry.ts.
let bootstrapped = false;

/** Сбрасывает guard. Только для тестов. */
export function resetBootstrapForTest(): void {
  bootstrapped = false;
}

export function bootstrap(modules: IFeatureModule[]): void {
  if (bootstrapped) {
    console.warn('[SVP] bootstrap() вызван повторно — игнорирую. Модули уже инициализированы.');
    return;
  }
  bootstrapped = true;

  injectStyles(toastStyles, 'svp-toast');
  registerModules(modules);
  let settings = loadSettings();
  settings = persistModuleDefaults(settings, modules);

  // Модули, несовместимые с текущим хостом (например, keepScreenOn в SBG Scout),
  // принудительно выключаем в settings. Это гарантирует и пропуск enable в
  // initModules ниже, и постоянную запись false в localStorage — чтобы при
  // возврате в другое окружение бывший выбор пользователя был переопределён
  // только для окружений с конфликтом.
  for (const mod of modules) {
    if (isModuleDisallowedInCurrentHost(mod.id) && settings.modules[mod.id]) {
      settings = setModuleEnabled(settings, mod.id, false);
    }
  }

  const errorDisplay = new Map<string, (message: string | null) => void>();

  initModules(
    modules,
    (id) => {
      const mod = modules.find((m) => m.id === id);
      return isModuleEnabled(settings, id, mod?.defaultEnabled ?? true);
    },
    (id, message) => {
      settings = setModuleError(settings, id, message);
      saveSettings(settings);
      errorDisplay.get(id)?.(message);
    },
    (id) => {
      if (settings.errors[id]) {
        settings = clearModuleError(settings, id);
        saveSettings(settings);
        errorDisplay.get(id)?.(null);
      }
    },
  );

  saveSettings(settings);
  initSettingsUI(modules, errorDisplay);
}
