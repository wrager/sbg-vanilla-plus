import type { ISvpSettings } from './types';
import { DEFAULT_SETTINGS, SETTINGS_VERSION } from './defaults';

const STORAGE_KEY = 'svp_settings';

type Migration = (settings: ISvpSettings) => ISvpSettings;

const migrations: Migration[] = [];

function migrate(settings: ISvpSettings): ISvpSettings {
  let current = { ...settings };
  for (let v = current.version; v < SETTINGS_VERSION; v++) {
    const migration = migrations[v - 1] as Migration | undefined;
    if (migration) {
      current = migration(current);
    }
    current.version = v + 1;
  }
  return current;
}

export function loadSettings(): ISvpSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };

    const parsed = JSON.parse(raw) as ISvpSettings;
    if (parsed.version < SETTINGS_VERSION) {
      const migrated = migrate(parsed);
      saveSettings(migrated);
      return migrated;
    }
    return parsed;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: ISvpSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export function isModuleEnabled(
  settings: ISvpSettings,
  id: string,
  defaultEnabled: boolean,
): boolean {
  return settings.modules[id] ?? defaultEnabled;
}

export function setModuleEnabled(
  settings: ISvpSettings,
  id: string,
  enabled: boolean,
): ISvpSettings {
  return {
    ...settings,
    modules: { ...settings.modules, [id]: enabled },
  };
}
