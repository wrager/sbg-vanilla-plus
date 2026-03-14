import type { SvpSettings } from './types';
import { DEFAULT_SETTINGS, SETTINGS_VERSION } from './defaults';

const STORAGE_KEY = 'svp_settings';

type Migration = (settings: SvpSettings) => SvpSettings;

const migrations: Migration[] = [];

function migrate(settings: SvpSettings): SvpSettings {
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

export function loadSettings(): SvpSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };

    const parsed = JSON.parse(raw) as SvpSettings;
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

export function saveSettings(settings: SvpSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export function isModuleEnabled(settings: SvpSettings, id: string, defaultEnabled: boolean): boolean {
  return settings.modules[id] ?? defaultEnabled;
}

export function setModuleEnabled(settings: SvpSettings, id: string, enabled: boolean): SvpSettings {
  return {
    ...settings,
    modules: { ...settings.modules, [id]: enabled },
  };
}
