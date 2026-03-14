import { initModules, type IFeatureModule } from '../../src/core/moduleRegistry';

function createMockModule(overrides: Partial<IFeatureModule> = {}): IFeatureModule {
  return {
    id: 'test',
    name: { en: 'Test Module', ru: 'Тестовый модуль' },
    description: { en: 'A test module', ru: 'Тестовый модуль' },
    defaultEnabled: true,
    script: 'style',
    init: jest.fn(),
    enable: jest.fn(),
    disable: jest.fn(),
    ...overrides,
  };
}

describe('initModules', () => {
  test('calls init and enable for enabled modules', () => {
    const mod = createMockModule({ id: 'init-test' });

    initModules([mod], () => true);

    expect(mod.init).toHaveBeenCalledTimes(1);
    expect(mod.enable).toHaveBeenCalledTimes(1);
  });

  test('calls init but not enable for disabled modules', () => {
    const mod = createMockModule({ id: 'disabled-test' });

    initModules([mod], () => false);

    expect(mod.init).toHaveBeenCalledTimes(1);
    expect(mod.enable).not.toHaveBeenCalled();
  });

  test('marks failed modules without blocking others', () => {
    const failing = createMockModule({
      id: 'fail-test',
      init: jest.fn(() => {
        throw new Error('boom');
      }),
    });
    const healthy = createMockModule({ id: 'healthy-test' });

    initModules([failing, healthy], () => true);

    expect(failing.status).toBe('failed');
    expect(healthy.status).toBe('ready');
    expect(healthy.init).toHaveBeenCalledTimes(1);
  });
});
