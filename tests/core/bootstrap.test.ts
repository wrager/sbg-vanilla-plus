import { bootstrap } from '../../src/core/bootstrap';
import type { FeatureModule } from '../../src/core/moduleRegistry';
import * as storage from '../../src/core/settings/storage';

function createMockModule(overrides: Partial<FeatureModule> = {}): FeatureModule {
  return {
    id: 'test',
    name: 'Test',
    description: 'Test module',
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
    jest.spyOn(storage, 'loadSettings').mockReturnValue({ version: 1, modules: { 'mod-a': true } });

    bootstrap([mod]);

    expect(mod.enable).toHaveBeenCalledTimes(1);
  });

  test('disables module when disabled in settings', () => {
    const mod = createMockModule({ id: 'mod-b', defaultEnabled: true });
    jest
      .spyOn(storage, 'loadSettings')
      .mockReturnValue({ version: 1, modules: { 'mod-b': false } });

    bootstrap([mod]);

    expect(mod.enable).not.toHaveBeenCalled();
  });

  test('uses defaultEnabled when module not in settings', () => {
    const enabled = createMockModule({ id: 'default-on', defaultEnabled: true });
    const disabled = createMockModule({ id: 'default-off', defaultEnabled: false });
    jest.spyOn(storage, 'loadSettings').mockReturnValue({ version: 1, modules: {} });

    bootstrap([enabled, disabled]);

    expect(enabled.enable).toHaveBeenCalledTimes(1);
    expect(disabled.enable).not.toHaveBeenCalled();
  });

  test('creates settings button in DOM', () => {
    jest.spyOn(storage, 'loadSettings').mockReturnValue({ version: 1, modules: {} });

    bootstrap([createMockModule()]);

    expect(document.getElementById('svp-settings-btn')).not.toBeNull();
  });
});
