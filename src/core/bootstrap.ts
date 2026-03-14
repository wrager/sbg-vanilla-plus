import type { IFeatureModule } from './moduleRegistry';
import { initModules } from './moduleRegistry';
import { loadSettings, isModuleEnabled } from './settings/storage';
import { initSettingsUI } from './settings/ui';

export function bootstrap(modules: IFeatureModule[]): void {
  const settings = loadSettings();

  initModules(modules, (id) => {
    const mod = modules.find((m) => m.id === id);
    return isModuleEnabled(settings, id, mod?.defaultEnabled ?? true);
  });

  initSettingsUI(modules);
}
