import type { ISvpSettings } from './types';
import { DEFAULT_SETTINGS, SETTINGS_VERSION } from './defaults';

const STORAGE_KEY = 'svp_settings';
const BACKUP_PREFIX = 'svp_settings_backup_v';

type Migration = (settings: ISvpSettings) => ISvpSettings;

const migrations: Migration[] = [
  // v1 → v2: добавлено поле errors
  (s) => ({ ...s, errors: {} }),
];

function isSvpSettings(val: unknown): val is ISvpSettings {
  return (
    typeof val === 'object' &&
    val !== null &&
    'version' in val &&
    typeof val.version === 'number' &&
    'modules' in val &&
    typeof val.modules === 'object' &&
    val.modules !== null
  );
}

function migrate(settings: ISvpSettings): ISvpSettings {
  let current = { ...settings };
  for (let v = current.version; v < SETTINGS_VERSION; v++) {
    const idx = v - 1;
    if (idx >= 0 && idx < migrations.length) {
      current = migrations[idx](current);
    }
    current.version = v + 1;
  }
  return current;
}

export function loadSettings(): ISvpSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };

    const parsed: unknown = JSON.parse(raw);
    if (!isSvpSettings(parsed)) return { ...DEFAULT_SETTINGS };
    if (parsed.version < SETTINGS_VERSION) {
      localStorage.setItem(BACKUP_PREFIX + String(parsed.version), raw);
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

export function hasBackup(version: number): boolean {
  return localStorage.getItem(BACKUP_PREFIX + String(version)) !== null;
}

export function restoreBackup(version: number): ISvpSettings {
  const key = BACKUP_PREFIX + String(version);
  const raw = localStorage.getItem(key);
  if (!raw) return { ...DEFAULT_SETTINGS };

  localStorage.setItem(STORAGE_KEY, raw);
  localStorage.removeItem(key);

  const parsed: unknown = JSON.parse(raw);
  if (!isSvpSettings(parsed)) return { ...DEFAULT_SETTINGS };
  return parsed;
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

export function setModuleError(settings: ISvpSettings, id: string, message: string): ISvpSettings {
  return {
    ...settings,
    errors: { ...settings.errors, [id]: message },
  };
}

export function clearModuleError(settings: ISvpSettings, id: string): ISvpSettings {
  const errors = Object.fromEntries(Object.entries(settings.errors).filter(([key]) => key !== id));
  return { ...settings, errors };
}
