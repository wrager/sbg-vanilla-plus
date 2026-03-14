import { initModules, type IFeatureModule } from './moduleRegistry';

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

  test('calls onError callback with module id and error message', () => {
    const onError = jest.fn();
    const failing = createMockModule({
      id: 'err-cb',
      init: jest.fn(() => {
        throw new Error('kaboom');
      }),
    });

    initModules([failing], () => true, onError);

    expect(onError).toHaveBeenCalledWith('err-cb', 'kaboom');
  });

  test('does not call onError for successful modules', () => {
    const onError = jest.fn();
    const mod = createMockModule({ id: 'ok-mod' });

    initModules([mod], () => true, onError);

    expect(onError).not.toHaveBeenCalled();
  });
});
