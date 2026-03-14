export interface IFeatureModule {
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

export function initModules(modules: IFeatureModule[], isEnabled: (id: string) => boolean): void {
  for (const mod of modules) {
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
