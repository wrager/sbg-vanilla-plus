import type { IFeatureModule } from './moduleRegistry';
import { initModules, registerModules } from './moduleRegistry';
import {
  loadSettings,
  saveSettings,
  persistModuleDefaults,
  isModuleEnabled,
  setModuleError,
  clearModuleError,
} from './settings/storage';
import { initSettingsUI } from './settings/ui';
import { injectStyles } from './dom';
import toastStyles from './toast.css?inline';

export function bootstrap(modules: IFeatureModule[]): void {
  injectStyles(toastStyles, 'svp-toast');
  registerModules(modules);
  let settings = loadSettings();
  settings = persistModuleDefaults(settings, modules);

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
