export interface FeatureModule {
  id: string;
  name: string;
  description: string;
  defaultEnabled: boolean;
  script: 'style' | 'features';
  status?: 'ready' | 'failed';
  init(): void;
  enable(): void;
  disable(): void;
}

const modules: FeatureModule[] = [];

export function registerModule(mod: FeatureModule): void {
  modules.push(mod);
}

export function getModules(): readonly FeatureModule[] {
  return modules;
}

export function getModulesByScript(script: 'style' | 'features'): readonly FeatureModule[] {
  return modules.filter((m) => m.script === script);
}

export function initModules(
  script: 'style' | 'features',
  isEnabled: (id: string) => boolean,
): void {
  for (const mod of getModulesByScript(script)) {
    try {
      mod.init();
      if (isEnabled(mod.id)) {
        mod.enable();
      }
      mod.status = 'ready';
    } catch (e) {
      console.warn(`[SVP] Модуль "${mod.name}" не загрузился:`, e);
      mod.status = 'failed';
    }
  }
}
