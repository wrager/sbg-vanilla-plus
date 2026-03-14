import {
  registerModule,
  getModules,
  getModulesByScript,
  initModules,
  type FeatureModule,
} from '../../src/core/moduleRegistry';

function createMockModule(overrides: Partial<FeatureModule> = {}): FeatureModule {
  return {
    id: 'test',
    name: 'Test Module',
    description: 'A test module',
    defaultEnabled: true,
    script: 'style',
    init: jest.fn(),
    enable: jest.fn(),
    disable: jest.fn(),
    ...overrides,
  };
}

describe('moduleRegistry', () => {
  test('registerModule adds module to registry', () => {
    const mod = createMockModule({ id: 'reg-test' });
    const before = getModules().length;
    registerModule(mod);
    expect(getModules().length).toBe(before + 1);
  });

  test('getModulesByScript filters correctly', () => {
    const styleMod = createMockModule({ id: 'style-mod', script: 'style' });
    const featuresMod = createMockModule({ id: 'features-mod', script: 'features' });
    registerModule(styleMod);
    registerModule(featuresMod);

    const styleModules = getModulesByScript('style');
    expect(styleModules.some((m) => m.id === 'style-mod')).toBe(true);
    expect(styleModules.some((m) => m.id === 'features-mod')).toBe(false);
  });

  test('initModules calls init and enable for enabled modules', () => {
    const mod = createMockModule({ id: 'init-test', script: 'features' });
    registerModule(mod);

    initModules('features', () => true);

    expect(mod.init).toHaveBeenCalledTimes(1);
    expect(mod.enable).toHaveBeenCalledTimes(1);
  });

  test('initModules marks failed modules', () => {
    const mod = createMockModule({
      id: 'fail-test',
      script: 'features',
      init: jest.fn(() => {
        throw new Error('boom');
      }),
    });
    registerModule(mod);

    initModules('features', () => true);

    expect(mod.status).toBe('failed');
  });
});
