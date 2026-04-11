import {
  loadSettings,
  saveSettings,
  persistModuleDefaults,
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
    expect(settings.version).toBe(4);
    expect(settings.errors).toEqual({});
    expect(settings.modules.test).toBe(true);
  });

  test('migration from v2 renames collapsibleTopPanel to enhancedMainScreen', () => {
    localStorage.setItem(
      'svp_settings',
      JSON.stringify({
        version: 2,
        modules: { collapsibleTopPanel: false },
        errors: { collapsibleTopPanel: 'some error' },
      }),
    );
    const settings = loadSettings();
    expect(settings.version).toBe(4);
    expect(settings.modules['enhancedMainScreen']).toBe(false);
    expect(settings.modules['collapsibleTopPanel']).toBeUndefined();
    expect(settings.errors['enhancedMainScreen']).toBe('some error');
    expect(settings.errors['collapsibleTopPanel']).toBeUndefined();
  });

  describe('migration from v3 merges disableDoubleTapZoom into ngrsZoom', () => {
    function loadV3(modules: Record<string, boolean>, errors: Record<string, string> = {}) {
      localStorage.setItem('svp_settings', JSON.stringify({ version: 3, modules, errors }));
      return loadSettings();
    }

    test('both flags true → ngrsZoom stays true, legacy key removed', () => {
      const s = loadV3({ ngrsZoom: true, disableDoubleTapZoom: true });
      expect(s.version).toBe(4);
      expect(s.modules['ngrsZoom']).toBe(true);
      expect(s.modules).not.toHaveProperty('disableDoubleTapZoom');
    });

    test('ngrsZoom true + disableDoubleTapZoom false → ngrsZoom true', () => {
      const s = loadV3({ ngrsZoom: true, disableDoubleTapZoom: false });
      expect(s.modules['ngrsZoom']).toBe(true);
      expect(s.modules).not.toHaveProperty('disableDoubleTapZoom');
    });

    test('ngrsZoom false + disableDoubleTapZoom true → ngrsZoom true (OR)', () => {
      const s = loadV3({ ngrsZoom: false, disableDoubleTapZoom: true });
      expect(s.modules['ngrsZoom']).toBe(true);
      expect(s.modules).not.toHaveProperty('disableDoubleTapZoom');
    });

    test('both flags false → ngrsZoom false, legacy key removed', () => {
      const s = loadV3({ ngrsZoom: false, disableDoubleTapZoom: false });
      expect(s.modules['ngrsZoom']).toBe(false);
      expect(s.modules).not.toHaveProperty('disableDoubleTapZoom');
    });

    test('only ngrsZoom present (true) → preserved', () => {
      const s = loadV3({ ngrsZoom: true });
      expect(s.modules['ngrsZoom']).toBe(true);
      expect(s.modules).not.toHaveProperty('disableDoubleTapZoom');
    });

    test('only ngrsZoom present (false) → preserved', () => {
      const s = loadV3({ ngrsZoom: false });
      expect(s.modules['ngrsZoom']).toBe(false);
      expect(s.modules).not.toHaveProperty('disableDoubleTapZoom');
    });

    test('only disableDoubleTapZoom present (true) → ngrsZoom true, legacy removed', () => {
      const s = loadV3({ disableDoubleTapZoom: true });
      expect(s.modules['ngrsZoom']).toBe(true);
      expect(s.modules).not.toHaveProperty('disableDoubleTapZoom');
    });

    test('only disableDoubleTapZoom present (false) → ngrsZoom false, legacy removed', () => {
      const s = loadV3({ disableDoubleTapZoom: false });
      expect(s.modules['ngrsZoom']).toBe(false);
      expect(s.modules).not.toHaveProperty('disableDoubleTapZoom');
    });

    test('neither flag present → ngrsZoom key not created (defaultEnabled applies later)', () => {
      const s = loadV3({ someOther: true });
      expect(s.modules).not.toHaveProperty('ngrsZoom');
      expect(s.modules).not.toHaveProperty('disableDoubleTapZoom');
      expect(s.modules['someOther']).toBe(true);
    });

    test('errors.disableDoubleTapZoom is removed', () => {
      const s = loadV3(
        { disableDoubleTapZoom: true },
        { disableDoubleTapZoom: 'legacy error', other: 'keep' },
      );
      expect(s.errors).not.toHaveProperty('disableDoubleTapZoom');
      expect(s.errors['other']).toBe('keep');
    });

    test('errors.ngrsZoom is preserved', () => {
      const s = loadV3(
        { ngrsZoom: true, disableDoubleTapZoom: true },
        { ngrsZoom: 'pre-existing error' },
      );
      expect(s.errors['ngrsZoom']).toBe('pre-existing error');
    });

    test('full chain v1 → v4 with disableDoubleTapZoom=true ends with ngrsZoom=true', () => {
      localStorage.setItem(
        'svp_settings',
        JSON.stringify({ version: 1, modules: { disableDoubleTapZoom: true } }),
      );
      const s = loadSettings();
      expect(s.version).toBe(4);
      expect(s.modules['ngrsZoom']).toBe(true);
      expect(s.modules).not.toHaveProperty('disableDoubleTapZoom');
    });

    test('loadSettings creates svp_settings_backup_v3 when migrating from v3', () => {
      const v3 = { version: 3, modules: { ngrsZoom: true }, errors: {} };
      localStorage.setItem('svp_settings', JSON.stringify(v3));
      loadSettings();
      expect(hasBackup(3)).toBe(true);
      expect(localStorage.getItem('svp_settings_backup_v3')).toBe(JSON.stringify(v3));
    });
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

  test('persistModuleDefaults writes defaults for missing modules', () => {
    const result = persistModuleDefaults(DEFAULT_SETTINGS, [
      { id: 'alpha', defaultEnabled: true },
      { id: 'beta', defaultEnabled: false },
    ]);
    expect(result.modules['alpha']).toBe(true);
    expect(result.modules['beta']).toBe(false);
  });

  test('persistModuleDefaults does not overwrite existing module state', () => {
    const settings = setModuleEnabled(DEFAULT_SETTINGS, 'alpha', false);
    const result = persistModuleDefaults(settings, [{ id: 'alpha', defaultEnabled: true }]);
    expect(result.modules['alpha']).toBe(false);
  });

  test('persistModuleDefaults preserves unrelated modules', () => {
    const settings = setModuleEnabled(DEFAULT_SETTINGS, 'existing', true);
    const result = persistModuleDefaults(settings, [{ id: 'newModule', defaultEnabled: false }]);
    expect(result.modules['existing']).toBe(true);
    expect(result.modules['newModule']).toBe(false);
  });
});
