import {
  initModules,
  runModuleAction,
  registerModules,
  getModuleById,
  type IFeatureModule,
} from './moduleRegistry';

function createMockModule(overrides: Partial<IFeatureModule> = {}): IFeatureModule {
  return {
    id: 'test',
    name: { en: 'Test Module', ru: 'Тестовый модуль' },
    description: { en: 'A test module', ru: 'Тестовый модуль' },
    defaultEnabled: true,
    category: 'ui',
    init: jest.fn(),
    enable: jest.fn(),
    disable: jest.fn(),
    ...overrides,
  };
}

describe('runModuleAction', () => {
  test('calls action and returns void for sync action', () => {
    const action = jest.fn();
    const onError = jest.fn();

    const result = runModuleAction(action, onError);

    expect(action).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
    expect(result).toBeUndefined();
  });

  test('catches sync errors and calls onError', () => {
    const error = new Error('sync boom');
    const action = jest.fn(() => {
      throw error;
    });
    const onError = jest.fn();

    void runModuleAction(action, onError);

    expect(onError).toHaveBeenCalledWith(error);
  });

  test('returns promise for async action', () => {
    const action = jest.fn(() => Promise.resolve());
    const onError = jest.fn();

    const result = runModuleAction(action, onError);

    expect(result).toBeInstanceOf(Promise);
  });

  test('catches async errors and calls onError', async () => {
    const error = new Error('async boom');
    const action = jest.fn(() => Promise.reject(error));
    const onError = jest.fn();

    await runModuleAction(action, onError);

    expect(onError).toHaveBeenCalledWith(error);
  });
});

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

    expect(onError).toHaveBeenCalledWith('err-cb', expect.stringContaining('kaboom'));
  });

  test('logs init errors via console.error with phase label', () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation();
    const mod = createMockModule({
      id: 'init-log',
      init: jest.fn(() => {
        throw new Error('init broke');
      }),
    });

    initModules([mod], () => true);

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('инициализации'),
      expect.any(Error),
    );
    errorSpy.mockRestore();
  });

  test('logs enable errors via console.error with phase label', () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation();
    const mod = createMockModule({
      id: 'enable-log',
      enable: jest.fn(() => {
        throw new Error('enable broke');
      }),
    });

    initModules([mod], () => true);

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('включении'), expect.any(Error));
    errorSpy.mockRestore();
  });

  test('does not call onError for successful modules', () => {
    const onError = jest.fn();
    const mod = createMockModule({ id: 'ok-mod' });

    initModules([mod], () => true, onError);

    expect(onError).not.toHaveBeenCalled();
  });

  test('catches sync enable errors', () => {
    const onError = jest.fn();
    const mod = createMockModule({
      id: 'sync-enable-fail',
      enable: jest.fn(() => {
        throw new Error('enable boom');
      }),
    });

    initModules([mod], () => true, onError);

    expect(mod.status).toBe('failed');
    expect(onError).toHaveBeenCalledWith(
      'sync-enable-fail',
      expect.stringContaining('enable boom'),
    );
  });

  test('catches async enable errors', async () => {
    const onError = jest.fn();
    const mod = createMockModule({
      id: 'async-enable-fail',
      enable: jest.fn(() => Promise.reject(new Error('async enable boom'))),
    });

    initModules([mod], () => true, onError);

    await Promise.resolve();

    expect(mod.status).toBe('failed');
    expect(onError).toHaveBeenCalledWith(
      'async-enable-fail',
      expect.stringContaining('async enable boom'),
    );
  });

  test('catches async init errors', async () => {
    const onError = jest.fn();
    const mod = createMockModule({
      id: 'async-init-fail',
      init: jest.fn(() => Promise.reject(new Error('async init boom'))),
    });

    initModules([mod], () => true, onError);

    await Promise.resolve();

    expect(mod.status).toBe('failed');
    expect(onError).toHaveBeenCalledWith(
      'async-init-fail',
      expect.stringContaining('async init boom'),
    );
  });

  test('does not call enable after async init failure', async () => {
    const mod = createMockModule({
      id: 'async-init-no-enable',
      init: jest.fn(() => Promise.reject(new Error('init failed'))),
    });

    initModules([mod], () => true);

    await Promise.resolve();
    await Promise.resolve();

    expect(mod.enable).not.toHaveBeenCalled();
  });

  test('calls enable after async init success', async () => {
    const mod = createMockModule({
      id: 'async-init-then-enable',
      init: jest.fn(() => Promise.resolve()),
    });

    initModules([mod], () => true);

    await Promise.resolve();
    await Promise.resolve();

    expect(mod.enable).toHaveBeenCalledTimes(1);
    expect(mod.status).toBe('ready');
  });

  test('does not call onReady when async enable fails', async () => {
    const onReady = jest.fn();
    const mod = createMockModule({
      id: 'async-enable-no-ready',
      enable: jest.fn(() => Promise.reject(new Error('enable failed'))),
    });

    initModules([mod], () => true, undefined, onReady);

    await Promise.resolve();
    await Promise.resolve();

    expect(mod.status).toBe('failed');
    expect(onReady).not.toHaveBeenCalled();
  });

  test('calls onReady after async enable succeeds', async () => {
    const onReady = jest.fn();
    const mod = createMockModule({
      id: 'async-enable-ready',
      enable: jest.fn(() => Promise.resolve()),
    });

    initModules([mod], () => true, undefined, onReady);

    await Promise.resolve();
    await Promise.resolve();

    expect(mod.status).toBe('ready');
    expect(onReady).toHaveBeenCalledWith('async-enable-ready');
  });

  test('marks failed when async init rejects after delay', async () => {
    const onError = jest.fn();
    const mod = createMockModule({
      id: 'delayed-init-fail',
      init: jest.fn(
        () =>
          new Promise<void>((_resolve, reject) => {
            setTimeout(() => {
              reject(new Error('timeout'));
            }, 10);
          }),
      ),
    });

    initModules([mod], () => true, onError);

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(mod.status).toBe('failed');
    expect(mod.enable).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith('delayed-init-fail', expect.stringContaining('timeout'));
  });

  test('marks failed when async enable rejects after delay', async () => {
    const onError = jest.fn();
    const mod = createMockModule({
      id: 'delayed-enable-fail',
      enable: jest.fn(
        () =>
          new Promise<void>((_resolve, reject) => {
            setTimeout(() => {
              reject(new Error('enable timeout'));
            }, 10);
          }),
      ),
    });

    initModules([mod], () => true, onError);

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(mod.status).toBe('failed');
    expect(onError).toHaveBeenCalledWith(
      'delayed-enable-fail',
      expect.stringContaining('enable timeout'),
    );
  });
});

// ── registerModules / getModuleById ──────────────────────────────────────────

describe('registerModules / getModuleById', () => {
  afterEach(() => {
    registerModules([]);
  });

  test('getModuleById returns registered module', () => {
    const mod = createMockModule({ id: 'testA' });
    registerModules([mod]);
    expect(getModuleById('testA')).toBe(mod);
  });

  test('getModuleById returns undefined for unknown id', () => {
    registerModules([createMockModule({ id: 'testA' })]);
    expect(getModuleById('unknown')).toBeUndefined();
  });

  test('getModuleById returns undefined when no modules registered', () => {
    expect(getModuleById('anything')).toBeUndefined();
  });
});
