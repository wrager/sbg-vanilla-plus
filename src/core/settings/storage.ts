import type { ISvpSettings } from './types';
import { DEFAULT_SETTINGS, SETTINGS_VERSION } from './defaults';

const STORAGE_KEY = 'svp_settings';
const BACKUP_PREFIX = 'svp_settings_backup_v';

type Migration = (settings: ISvpSettings) => ISvpSettings;

const migrations: Migration[] = [
  // v1 → v2: добавлено поле errors
  (s) => ({ ...s, errors: {} }),
  // v2 → v3: переименование модуля collapsibleTopPanel → enhancedMainScreen
  (s) => {
    const modules = { ...s.modules };
    if ('collapsibleTopPanel' in modules) {
      modules['enhancedMainScreen'] = modules['collapsibleTopPanel'];
      delete modules['collapsibleTopPanel'];
    }
    const errors = { ...s.errors };
    if ('collapsibleTopPanel' in errors) {
      errors['enhancedMainScreen'] = errors['collapsibleTopPanel'];
      delete errors['collapsibleTopPanel'];
    }
    return { ...s, modules, errors };
  },
  // v3 → v4: слияние disableDoubleTapZoom в ngrsZoom.
  // Если у пользователя был включён хотя бы один из двух — новый ngrsZoom включён.
  // Если оба были явно выключены — выключен. Если пользователь не трогал ни один из
  // них — не создаём запись, defaultEnabled сработает при следующей загрузке.
  (s) => {
    const modules = { ...s.modules };
    const hasLegacy = 'disableDoubleTapZoom' in modules || 'ngrsZoom' in modules;
    if (hasLegacy) {
      const legacyOn = modules['disableDoubleTapZoom'] ?? false;
      const ngrsOn = modules['ngrsZoom'] ?? false;
      modules['ngrsZoom'] = legacyOn || ngrsOn;
    }
    delete modules['disableDoubleTapZoom'];

    const errors = { ...s.errors };
    delete errors['disableDoubleTapZoom'];

    return { ...s, modules, errors };
  },
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

export function saveSettings(settings: ISvpSettings): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    return true;
  } catch (error) {
    // localStorage.setItem бросает QuotaExceededError на переполненном
    // storage и SecurityError в приватном режиме некоторых браузеров.
    // Глотаем и логируем: ронять bootstrap() из-за storage — ошибка
    // хуже чем потеря записи настроек. Возвращаем false, чтобы вызывающий
    // UI-код мог показать пользователю явное уведомление.
    console.error('[SVP] Не удалось сохранить настройки в localStorage:', error);
    return false;
  }
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

export function persistModuleDefaults(
  settings: ISvpSettings,
  modules: ReadonlyArray<{ id: string; defaultEnabled: boolean }>,
): ISvpSettings {
  let updated = settings;
  for (const mod of modules) {
    if (!(mod.id in updated.modules)) {
      updated = setModuleEnabled(updated, mod.id, mod.defaultEnabled);
    }
  }
  return updated;
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
