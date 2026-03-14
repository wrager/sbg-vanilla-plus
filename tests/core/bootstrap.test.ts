import { bootstrap } from '../../src/core/bootstrap';
import type { IFeatureModule } from '../../src/core/moduleRegistry';
import type { ISvpSettings } from '../../src/core/settings/types';
import * as storage from '../../src/core/settings/storage';

function createMockModule(overrides: Partial<IFeatureModule> = {}): IFeatureModule {
  return {
    id: 'test',
    name: { en: 'Test', ru: 'Тест' },
    description: { en: 'Test module', ru: 'Тестовый модуль' },
    defaultEnabled: true,
    script: 'features',
    init: jest.fn(),
    enable: jest.fn(),
    disable: jest.fn(),
    ...overrides,
  };
}

describe('bootstrap', () => {
  afterEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    localStorage.clear();
    jest.restoreAllMocks();
  });

  test('enables module when enabled in settings', () => {
    const mod = createMockModule({ id: 'mod-a' });
    jest
      .spyOn(storage, 'loadSettings')
      .mockReturnValue({ version: 2, modules: { 'mod-a': true }, errors: {} });

    bootstrap([mod]);

    expect(mod.enable).toHaveBeenCalledTimes(1);
  });

  test('disables module when disabled in settings', () => {
    const mod = createMockModule({ id: 'mod-b', defaultEnabled: true });
    jest
      .spyOn(storage, 'loadSettings')
      .mockReturnValue({ version: 2, modules: { 'mod-b': false }, errors: {} });

    bootstrap([mod]);

    expect(mod.enable).not.toHaveBeenCalled();
  });

  test('uses defaultEnabled when module not in settings', () => {
    const enabled = createMockModule({ id: 'default-on', defaultEnabled: true });
    const disabled = createMockModule({ id: 'default-off', defaultEnabled: false });
    jest.spyOn(storage, 'loadSettings').mockReturnValue({ version: 2, modules: {}, errors: {} });

    bootstrap([enabled, disabled]);

    expect(enabled.enable).toHaveBeenCalledTimes(1);
    expect(disabled.enable).not.toHaveBeenCalled();
  });

  test('creates settings button in DOM', () => {
    jest.spyOn(storage, 'loadSettings').mockReturnValue({ version: 2, modules: {}, errors: {} });

    bootstrap([createMockModule()]);

    expect(document.getElementById('svp-settings-btn')).not.toBeNull();
  });

  test('persists error for failed module', () => {
    let lastSaved: ISvpSettings | undefined;
    jest.spyOn(storage, 'saveSettings').mockImplementation((s: ISvpSettings) => {
      lastSaved = s;
    });
    jest.spyOn(storage, 'loadSettings').mockReturnValue({ version: 2, modules: {}, errors: {} });

    const failing = createMockModule({
      id: 'fail-mod',
      init: jest.fn(() => {
        throw new Error('test error');
      }),
    });

    bootstrap([failing]);

    expect(lastSaved).toBeDefined();
    expect(lastSaved?.errors['fail-mod']).toBe('test error');
  });

  test('clears previous error for successful module', () => {
    let lastSaved: ISvpSettings | undefined;
    jest.spyOn(storage, 'saveSettings').mockImplementation((s: ISvpSettings) => {
      lastSaved = s;
    });
    jest
      .spyOn(storage, 'loadSettings')
      .mockReturnValue({ version: 2, modules: {}, errors: { 'ok-mod': 'old error' } });

    const mod = createMockModule({ id: 'ok-mod' });
    bootstrap([mod]);

    expect(lastSaved).toBeDefined();
    expect(lastSaved?.errors['ok-mod']).toBeUndefined();
  });
});
