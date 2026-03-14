import { getModules, initModules } from './moduleRegistry';
import { loadSettings, isModuleEnabled } from './settings/storage';
import { initSettingsUI } from './settings/ui';

export function bootstrap(script: 'style' | 'features'): void {
  const settings = loadSettings();

  initModules(script, (id) => {
    const mod = getModules().find((m) => m.id === id);
    return isModuleEnabled(settings, id, mod?.defaultEnabled ?? true);
  });

  if (script === 'features') {
    initSettingsUI();
  }
}
