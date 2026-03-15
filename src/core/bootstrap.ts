import type { IFeatureModule } from './moduleRegistry';
import { initModules } from './moduleRegistry';
import {
  loadSettings,
  saveSettings,
  isModuleEnabled,
  setModuleError,
  clearModuleError,
} from './settings/storage';
import { initSettingsUI } from './settings/ui';

export function bootstrap(modules: IFeatureModule[]): void {
  let settings = loadSettings();

  initModules(
    modules,
    (id) => {
      const mod = modules.find((m) => m.id === id);
      return isModuleEnabled(settings, id, mod?.defaultEnabled ?? true);
    },
    (id, message) => {
      settings = setModuleError(settings, id, message);
      saveSettings(settings);
    },
  );

  // Очистить ошибки для успешно загруженных модулей
  for (const mod of modules) {
    if (mod.status === 'ready' && settings.errors[mod.id]) {
      settings = clearModuleError(settings, mod.id);
    }
  }

  saveSettings(settings);
  initSettingsUI(modules);
}
