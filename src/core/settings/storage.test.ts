import {
  loadSettings,
  saveSettings,
  isModuleEnabled,
  setModuleEnabled,
  setModuleError,
  clearModuleError,
  hasBackup,
  restoreBackup,
} from './storage';
import { DEFAULT_SETTINGS } from './defaults';

describe('settings/storage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test('loadSettings returns defaults when nothing stored', () => {
    const settings = loadSettings();
    expect(settings).toEqual(DEFAULT_SETTINGS);
  });

  test('saveSettings and loadSettings roundtrip', () => {
    const settings = { ...DEFAULT_SETTINGS, modules: { test: true } };
    saveSettings(settings);

    const loaded = loadSettings();
    expect(loaded.modules.test).toBe(true);
  });

  test('loadSettings returns defaults on corrupted data', () => {
    localStorage.setItem('svp_settings', 'not-json');
    const settings = loadSettings();
    expect(settings).toEqual(DEFAULT_SETTINGS);
  });

  test('isModuleEnabled returns stored value', () => {
    const settings = { ...DEFAULT_SETTINGS, modules: { test: false } };
    expect(isModuleEnabled(settings, 'test', true)).toBe(false);
  });

  test('isModuleEnabled returns default when not stored', () => {
    expect(isModuleEnabled(DEFAULT_SETTINGS, 'missing', true)).toBe(true);
    expect(isModuleEnabled(DEFAULT_SETTINGS, 'missing', false)).toBe(false);
  });

  test('setModuleEnabled returns updated settings', () => {
    const updated = setModuleEnabled(DEFAULT_SETTINGS, 'test', true);
    expect(updated.modules.test).toBe(true);
    // Original not mutated
    expect(DEFAULT_SETTINGS.modules).toEqual({});
  });

  test('setModuleError adds error message', () => {
    const updated = setModuleError(DEFAULT_SETTINGS, 'mod-a', 'boom');
    expect(updated.errors['mod-a']).toBe('boom');
    expect(DEFAULT_SETTINGS.errors).toEqual({});
  });

  test('clearModuleError removes error', () => {
    const withError = setModuleError(DEFAULT_SETTINGS, 'mod-a', 'boom');
    const cleared = clearModuleError(withError, 'mod-a');
    expect(cleared.errors).toEqual({});
  });

  test('migration from v1 adds errors field', () => {
    localStorage.setItem('svp_settings', JSON.stringify({ version: 1, modules: { test: true } }));
    const settings = loadSettings();
    expect(settings.version).toBe(2);
    expect(settings.errors).toEqual({});
    expect(settings.modules.test).toBe(true);
  });

  test('migration creates versioned backup', () => {
    const v1 = { version: 1, modules: { test: true } };
    localStorage.setItem('svp_settings', JSON.stringify(v1));
    loadSettings();
    expect(hasBackup(1)).toBe(true);
    expect(localStorage.getItem('svp_settings_backup_v1')).toBe(JSON.stringify(v1));
  });

  test('hasBackup returns false when no backup exists', () => {
    expect(hasBackup(1)).toBe(false);
  });

  test('restoreBackup restores pre-migration settings and removes backup', () => {
    const v1 = { version: 1, modules: { test: true } };
    localStorage.setItem('svp_settings', JSON.stringify(v1));
    loadSettings();

    const restored = restoreBackup(1);
    expect(restored.version).toBe(1);
    expect(restored.modules.test).toBe(true);
    expect(hasBackup(1)).toBe(false);
    expect(localStorage.getItem('svp_settings')).toBe(JSON.stringify(v1));
  });

  test('restoreBackup returns defaults when no backup exists', () => {
    const result = restoreBackup(99);
    expect(result).toEqual(DEFAULT_SETTINGS);
  });
});
