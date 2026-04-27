import { bootstrap, resetBootstrapForTest } from './bootstrap';
import { resetDetectedVersionForTest, setDetectedVersionForTest } from './gameVersion';
import type { IFeatureModule } from './moduleRegistry';
import type { ISvpSettings } from './settings/types';
import * as storage from './settings/storage';

const SCOUT_UA = 'Mozilla/5.0 (Linux; Android 13) SbgScout/1.2.3';
const BROWSER_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0';
const ORIGINAL_USER_AGENT = navigator.userAgent;

function setUserAgent(value: string): void {
  Object.defineProperty(navigator, 'userAgent', { value, configurable: true });
}

function createMockModule(overrides: Partial<IFeatureModule> = {}): IFeatureModule {
  return {
    id: 'test',
    name: { en: 'Test', ru: 'Тест' },
    description: { en: 'Test module', ru: 'Тестовый модуль' },
    defaultEnabled: true,
    category: 'ui',
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
    resetBootstrapForTest();
    resetDetectedVersionForTest();
    setUserAgent(ORIGINAL_USER_AGENT);
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

  test('creates settings entry in game settings', () => {
    document.body.innerHTML = '<div class="settings-content"></div>';
    jest.spyOn(storage, 'loadSettings').mockReturnValue({ version: 2, modules: {}, errors: {} });

    bootstrap([createMockModule()]);

    expect(document.getElementById('svp-game-settings-entry')).not.toBeNull();
  });

  test('persists error for failed module', () => {
    let lastSaved: ISvpSettings | undefined;
    jest.spyOn(storage, 'saveSettings').mockImplementation((s: ISvpSettings) => {
      lastSaved = s;
      return true;
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
    expect(lastSaved?.errors['fail-mod']).toContain('test error');
  });

  test('persists error for async init failure', async () => {
    let lastSaved: ISvpSettings | undefined;
    jest.spyOn(storage, 'saveSettings').mockImplementation((s: ISvpSettings) => {
      lastSaved = s;
      return true;
    });
    jest.spyOn(storage, 'loadSettings').mockReturnValue({ version: 2, modules: {}, errors: {} });

    const failing = createMockModule({
      id: 'async-fail',
      init: jest.fn(() => Promise.reject(new Error('async init error'))),
    });

    bootstrap([failing]);

    await Promise.resolve();

    expect(lastSaved).toBeDefined();
    expect(lastSaved?.errors['async-fail']).toContain('async init error');
  });

  test('persists error for async enable failure', async () => {
    let lastSaved: ISvpSettings | undefined;
    jest.spyOn(storage, 'saveSettings').mockImplementation((s: ISvpSettings) => {
      lastSaved = s;
      return true;
    });
    jest.spyOn(storage, 'loadSettings').mockReturnValue({ version: 2, modules: {}, errors: {} });

    const failing = createMockModule({
      id: 'async-enable-fail',
      enable: jest.fn(() => Promise.reject(new Error('async enable error'))),
    });

    bootstrap([failing]);

    await Promise.resolve();

    expect(lastSaved).toBeDefined();
    expect(lastSaved?.errors['async-enable-fail']).toContain('async enable error');
  });

  test('clears previous error for async-init module after init resolves', async () => {
    let lastSaved: ISvpSettings | undefined;
    jest.spyOn(storage, 'saveSettings').mockImplementation((s: ISvpSettings) => {
      lastSaved = s;
      return true;
    });
    jest
      .spyOn(storage, 'loadSettings')
      .mockReturnValue({ version: 2, modules: {}, errors: { 'async-mod': 'old error' } });

    const mod = createMockModule({
      id: 'async-mod',
      init: jest.fn(() => Promise.resolve()),
    });
    bootstrap([mod]);

    await Promise.resolve();
    await Promise.resolve();

    expect(lastSaved).toBeDefined();
    expect(lastSaved?.errors['async-mod']).toBeUndefined();
  });

  test('clears previous error for successful module', () => {
    let lastSaved: ISvpSettings | undefined;
    jest.spyOn(storage, 'saveSettings').mockImplementation((s: ISvpSettings) => {
      lastSaved = s;
      return true;
    });
    jest
      .spyOn(storage, 'loadSettings')
      .mockReturnValue({ version: 2, modules: {}, errors: { 'ok-mod': 'old error' } });

    const mod = createMockModule({ id: 'ok-mod' });
    bootstrap([mod]);

    expect(lastSaved).toBeDefined();
    expect(lastSaved?.errors['ok-mod']).toBeUndefined();
  });

  describe('идемпотентность: повторный вызов bootstrap', () => {
    test('второй вызов не вызывает init/enable модулей повторно', () => {
      jest.spyOn(storage, 'loadSettings').mockReturnValue({
        version: 2,
        modules: { 'idem-mod': true },
        errors: {},
      });
      const mod = createMockModule({ id: 'idem-mod' });

      bootstrap([mod]);
      bootstrap([mod]);

      expect(mod.init).toHaveBeenCalledTimes(1);
      expect(mod.enable).toHaveBeenCalledTimes(1);
    });

    test('второй вызов не создаёт дубликат settings panel', () => {
      jest.spyOn(storage, 'loadSettings').mockReturnValue({ version: 2, modules: {}, errors: {} });
      const mod = createMockModule({ id: 'panel-mod' });

      bootstrap([mod]);
      bootstrap([mod]);

      const panels = document.querySelectorAll('#svp-settings-panel');
      expect(panels.length).toBe(1);
    });

    test('второй вызов пишет console.warn', () => {
      jest.spyOn(storage, 'loadSettings').mockReturnValue({ version: 2, modules: {}, errors: {} });
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
      const mod = createMockModule({ id: 'warn-mod' });

      bootstrap([mod]);
      bootstrap([mod]);

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('bootstrap() вызван повторно'));
    });

    test('после resetBootstrapForTest() bootstrap снова работает', () => {
      jest.spyOn(storage, 'loadSettings').mockReturnValue({ version: 2, modules: {}, errors: {} });
      const mod = createMockModule({ id: 'reset-mod' });

      bootstrap([mod]);
      resetBootstrapForTest();
      // После reset — следующий вызов должен снова пройти полный цикл.
      bootstrap([mod]);

      expect(mod.init).toHaveBeenCalledTimes(2);
      expect(mod.enable).toHaveBeenCalledTimes(2);
    });
  });

  describe('модули, несовместимые с хостом', () => {
    test('в SBG Scout keepScreenOn не enable-ится, даже если в settings был true', () => {
      setUserAgent(SCOUT_UA);
      jest.spyOn(storage, 'loadSettings').mockReturnValue({
        version: 2,
        modules: { keepScreenOn: true },
        errors: {},
      });

      const keepScreenOn = createMockModule({ id: 'keepScreenOn', defaultEnabled: true });
      bootstrap([keepScreenOn]);

      expect(keepScreenOn.enable).not.toHaveBeenCalled();
    });

    test('в SBG Scout keepScreenOn не перезаписывает пользовательский true в settings', () => {
      // Runtime-блокировка в Scout НЕ должна трогать persisted settings:
      // иначе при возврате в обычный браузер defaultEnabled=true больше не
      // сработает (ключ keepScreenOn уже есть со значением false), и пользователь
      // увидит выключенный модуль без причины.
      setUserAgent(SCOUT_UA);
      let lastSaved: ISvpSettings | undefined;
      jest.spyOn(storage, 'saveSettings').mockImplementation((s: ISvpSettings) => {
        lastSaved = s;
        return true;
      });
      jest.spyOn(storage, 'loadSettings').mockReturnValue({
        version: 2,
        modules: { keepScreenOn: true },
        errors: {},
      });

      const keepScreenOn = createMockModule({ id: 'keepScreenOn', defaultEnabled: true });
      bootstrap([keepScreenOn]);

      expect(keepScreenOn.enable).not.toHaveBeenCalled();
      expect(lastSaved?.modules['keepScreenOn']).toBe(true);
    });

    test('в SBG Scout другие модули работают нормально', () => {
      setUserAgent(SCOUT_UA);
      jest.spyOn(storage, 'loadSettings').mockReturnValue({
        version: 2,
        modules: { 'other-mod': true },
        errors: {},
      });

      const other = createMockModule({ id: 'other-mod', defaultEnabled: true });
      bootstrap([other]);

      expect(other.enable).toHaveBeenCalledTimes(1);
    });

    test('в обычном браузере keepScreenOn включается как обычно', () => {
      setUserAgent(BROWSER_UA);
      jest.spyOn(storage, 'loadSettings').mockReturnValue({
        version: 2,
        modules: { keepScreenOn: true },
        errors: {},
      });

      const keepScreenOn = createMockModule({ id: 'keepScreenOn', defaultEnabled: true });
      bootstrap([keepScreenOn]);

      expect(keepScreenOn.enable).toHaveBeenCalledTimes(1);
    });

    test('roundtrip Scout→браузер: после первого запуска в Scout keepScreenOn включается в браузере', () => {
      // Реальный localStorage (без мока load/save), симулируем запуск в Scout,
      // затем тот же localStorage читается в браузере. defaultEnabled=true
      // должен срабатывать в браузере, независимо от того, что пользователь
      // раньше заходил в Scout.
      setUserAgent(SCOUT_UA);
      const keepScreenOnScout = createMockModule({
        id: 'keepScreenOn',
        defaultEnabled: true,
      });
      bootstrap([keepScreenOnScout]);
      expect(keepScreenOnScout.enable).not.toHaveBeenCalled();

      resetBootstrapForTest();
      document.head.innerHTML = '';
      document.body.innerHTML = '';
      setUserAgent(BROWSER_UA);

      const keepScreenOnBrowser = createMockModule({
        id: 'keepScreenOn',
        defaultEnabled: true,
      });
      bootstrap([keepScreenOnBrowser]);

      expect(keepScreenOnBrowser.enable).toHaveBeenCalledTimes(1);
    });
  });

  describe('модули, нативные в SBG 0.6.1', () => {
    test('на 0.6.1 favoritedPoints не enable-ится', () => {
      // Версия детектится из заголовка x-sbg-version; наш модуль перекрывается
      // нативным избранным в 0.6.1 и должен быть подавлен.
      setDetectedVersionForTest('0.6.1');
      jest.spyOn(storage, 'loadSettings').mockReturnValue({
        version: 2,
        modules: { favoritedPoints: true },
        errors: {},
      });

      const favoritedPoints = createMockModule({ id: 'favoritedPoints', defaultEnabled: true });
      bootstrap([favoritedPoints]);

      expect(favoritedPoints.enable).not.toHaveBeenCalled();
    });

    test('в 0.6.1 favoritedPoints не перезаписывает пользовательский true в settings', () => {
      // Runtime-блокировка по версии игры НЕ должна трогать persisted settings:
      // поведение симметрично host-гейту.
      setDetectedVersionForTest('0.6.1');
      let lastSaved: ISvpSettings | undefined;
      jest.spyOn(storage, 'saveSettings').mockImplementation((s: ISvpSettings) => {
        lastSaved = s;
        return true;
      });
      jest.spyOn(storage, 'loadSettings').mockReturnValue({
        version: 2,
        modules: { favoritedPoints: true },
        errors: {},
      });

      const favoritedPoints = createMockModule({ id: 'favoritedPoints', defaultEnabled: true });
      bootstrap([favoritedPoints]);

      expect(favoritedPoints.enable).not.toHaveBeenCalled();
      expect(lastSaved?.modules['favoritedPoints']).toBe(true);
    });

    test('на 0.6.0 favoritedPoints включается как обычно', () => {
      // На проде (0.6.0) гейт 0.6.1+ не срабатывает, модуль работает штатно.
      setDetectedVersionForTest('0.6.0');
      jest.spyOn(storage, 'loadSettings').mockReturnValue({
        version: 2,
        modules: { favoritedPoints: true },
        errors: {},
      });

      const favoritedPoints = createMockModule({ id: 'favoritedPoints', defaultEnabled: true });
      bootstrap([favoritedPoints]);

      expect(favoritedPoints.enable).toHaveBeenCalledTimes(1);
    });

    test('в 0.6.1 другие (не-native) модули работают нормально', () => {
      setDetectedVersionForTest('0.6.1');
      jest.spyOn(storage, 'loadSettings').mockReturnValue({
        version: 2,
        modules: { 'other-mod': true },
        errors: {},
      });

      const other = createMockModule({ id: 'other-mod', defaultEnabled: true });
      bootstrap([other]);

      expect(other.enable).toHaveBeenCalledTimes(1);
    });
  });
});
