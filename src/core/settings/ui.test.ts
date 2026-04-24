import { resetDetectedVersionForTest, setDetectedVersionForTest } from '../gameVersion';
import type { IFeatureModule } from '../moduleRegistry';
import type { ILocalizedString } from '../l10n';
import { initSettingsUI } from './ui';

function createMockModule(overrides: Partial<IFeatureModule> = {}): IFeatureModule {
  return {
    id: 'testModule',
    name: { en: 'Test', ru: 'Тест' },
    description: { en: 'Test description', ru: 'Тестовое описание' },
    defaultEnabled: true,
    category: 'ui',
    init: jest.fn(),
    enable: jest.fn(),
    disable: jest.fn(),
    ...overrides,
  };
}

describe('initSettingsUI render error boundary', () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '';
    document.head.querySelectorAll('style[id^="svp-"]').forEach((node) => {
      node.remove();
    });
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  test('падение рендера одного модуля не ломает рендер соседних модулей', () => {
    const goodBefore = createMockModule({ id: 'goodBefore' });
    const broken = createMockModule({
      id: 'broken',
      // Намеренно ломаем t(mod.name) — вызов str[locale] на null бросит TypeError.
      name: null as unknown as ILocalizedString,
    });
    const goodAfter = createMockModule({ id: 'goodAfter' });

    initSettingsUI([goodBefore, broken, goodAfter], new Map());

    const panel = document.getElementById('svp-settings-panel');
    expect(panel).not.toBeNull();

    const normalRows = panel?.querySelectorAll('.svp-module-row');
    expect(normalRows?.length).toBe(2);
    const normalRowIds = Array.from(normalRows ?? []).map(
      (row) => row.querySelector('.svp-module-id')?.textContent,
    );
    expect(normalRowIds).toEqual(['goodBefore', 'goodAfter']);

    const errorRows = panel?.querySelectorAll('.svp-module-row-render-error');
    expect(errorRows?.length).toBe(1);
    expect(errorRows?.[0].getAttribute('data-svp-module-id')).toBe('broken');
    expect(errorRows?.[0].textContent).toContain('broken: render error');
  });

  test('ошибка рендера логируется через console.error с id модуля', () => {
    const broken = createMockModule({
      id: 'brokenModule',
      name: null as unknown as ILocalizedString,
    });

    initSettingsUI([broken], new Map());

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Ошибка рендера настроек модуля "brokenModule"'),
      expect.any(Error),
    );
  });

  test('падение рендера в одной категории не ломает последующие категории', () => {
    const brokenUi = createMockModule({
      id: 'brokenUi',
      category: 'ui',
      name: null as unknown as ILocalizedString,
    });
    const goodMap = createMockModule({ id: 'goodMap', category: 'map' });
    const goodFix = createMockModule({ id: 'goodFix', category: 'fix' });

    initSettingsUI([brokenUi, goodMap, goodFix], new Map());

    const panel = document.getElementById('svp-settings-panel');
    expect(panel).not.toBeNull();

    // Секции следующих категорий должны быть созданы.
    const sections = panel?.querySelectorAll('.svp-settings-section');
    expect(sections?.length).toBe(3);

    const normalRows = panel?.querySelectorAll('.svp-module-row');
    const normalIds = Array.from(normalRows ?? []).map(
      (row) => row.querySelector('.svp-module-id')?.textContent,
    );
    expect(normalIds).toEqual(['goodMap', 'goodFix']);

    const errorRows = panel?.querySelectorAll('.svp-module-row-render-error');
    expect(errorRows?.length).toBe(1);
  });

  test('футер, кнопка закрытия и version отрисовываются даже при ошибке в одном модуле', () => {
    const broken = createMockModule({
      id: 'broken',
      name: null as unknown as ILocalizedString,
    });
    const good = createMockModule({ id: 'good' });

    initSettingsUI([broken, good], new Map());

    const panel = document.getElementById('svp-settings-panel');
    expect(panel?.querySelector('.svp-settings-footer')).not.toBeNull();
    expect(panel?.querySelector('.svp-settings-version')).not.toBeNull();
    expect(panel?.querySelector('.svp-settings-close')).not.toBeNull();
  });
});

describe('initSettingsUI onChange — свежее состояние storage', () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '';
    document.head.querySelectorAll('style[id^="svp-"]').forEach((node) => {
      node.remove();
    });
    // initSettingsUI читает storage, но не пишет — заряжаем начальный snapshot.
    localStorage.setItem('svp_settings', JSON.stringify({ version: 4, modules: {}, errors: {} }));
  });

  function getStoredSettings(): {
    version: number;
    modules: Record<string, boolean>;
    errors: Record<string, string>;
  } {
    const raw = localStorage.getItem('svp_settings');
    if (!raw) throw new Error('svp_settings not set');
    return JSON.parse(raw) as {
      version: number;
      modules: Record<string, boolean>;
      errors: Record<string, string>;
    };
  }

  function getFirstModuleCheckbox(): HTMLInputElement {
    const panel = document.getElementById('svp-settings-panel');
    if (!panel) throw new Error('svp-settings-panel not rendered');
    const checkbox = panel.querySelector<HTMLInputElement>('.svp-module-row .svp-module-checkbox');
    if (!checkbox) throw new Error('module checkbox not found');
    return checkbox;
  }

  test('клик по чекбоксу сохраняет errors, добавленные в storage после построения панели', () => {
    const alpha = createMockModule({ id: 'alpha', defaultEnabled: true });
    const beta = createMockModule({ id: 'beta', defaultEnabled: true });

    initSettingsUI([alpha, beta], new Map());

    // Внешняя правка storage уже ПОСЛЕ построения панели: какой-то модуль
    // упал в runtime и его ошибка сохранена в svp_settings.errors.
    const current = getStoredSettings();
    localStorage.setItem(
      'svp_settings',
      JSON.stringify({
        ...current,
        errors: { ...current.errors, beta: 'runtime crash after panel built' },
      }),
    );

    // Пользователь кликает чекбокс alpha — onChange должен смёрджить правку
    // со свежим storage, а не перетереть его stale-снимком.
    const alphaCheckbox = getFirstModuleCheckbox();
    alphaCheckbox.checked = false;
    alphaCheckbox.dispatchEvent(new Event('change'));

    const after = getStoredSettings();
    expect(after.modules['alpha']).toBe(false);
    expect(after.errors['beta']).toBe('runtime crash after panel built');
  });

  test('клик по чекбоксу не перетирает modules других модулей, изменённых после построения', () => {
    const alpha = createMockModule({ id: 'alpha', defaultEnabled: true });
    const beta = createMockModule({ id: 'beta', defaultEnabled: true });
    const gamma = createMockModule({ id: 'gamma', defaultEnabled: true });

    initSettingsUI([alpha, beta, gamma], new Map());

    // Внешняя правка: beta и gamma переключились программно.
    const current = getStoredSettings();
    localStorage.setItem(
      'svp_settings',
      JSON.stringify({
        ...current,
        modules: { ...current.modules, beta: false, gamma: false },
      }),
    );

    const alphaCheckbox = getFirstModuleCheckbox();
    alphaCheckbox.checked = false;
    alphaCheckbox.dispatchEvent(new Event('change'));

    const after = getStoredSettings();
    expect(after.modules['alpha']).toBe(false);
    expect(after.modules['beta']).toBe(false);
    expect(after.modules['gamma']).toBe(false);
  });

  test('очистка ошибки после успешного toggle использует свежий snapshot', () => {
    const alpha = createMockModule({
      id: 'alpha',
      defaultEnabled: true,
      enable: jest.fn(),
    });

    // В storage уже есть ошибка alpha + ошибка другого модуля.
    localStorage.setItem(
      'svp_settings',
      JSON.stringify({
        version: 4,
        modules: { alpha: false },
        errors: { alpha: 'old error', unrelated: 'keep me' },
      }),
    );

    initSettingsUI([alpha], new Map());

    const alphaCheckbox = getFirstModuleCheckbox();
    alphaCheckbox.checked = true;
    alphaCheckbox.dispatchEvent(new Event('change'));

    const after = getStoredSettings();
    expect(after.modules['alpha']).toBe(true);
    expect(after.errors['alpha']).toBeUndefined();
    // Ошибка несвязанного модуля не должна быть потеряна.
    expect(after.errors['unrelated']).toBe('keep me');
  });

  test('onToggleError при синхронном падении enable сохраняет свежие errors', () => {
    const alpha = createMockModule({
      id: 'alpha',
      defaultEnabled: false,
      enable: jest.fn(() => {
        throw new Error('enable boom');
      }),
    });

    initSettingsUI([alpha], new Map());

    // Внешняя правка storage после построения: добавилась ошибка другого модуля.
    const current = getStoredSettings();
    localStorage.setItem(
      'svp_settings',
      JSON.stringify({
        ...current,
        errors: { ...current.errors, unrelated: 'other module failed' },
      }),
    );

    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
    const alphaCheckbox = getFirstModuleCheckbox();
    alphaCheckbox.checked = true;
    alphaCheckbox.dispatchEvent(new Event('change'));
    consoleErrorSpy.mockRestore();

    const after = getStoredSettings();
    // alpha провалился — его ошибка должна быть записана.
    expect(after.errors['alpha']).toContain('enable boom');
    // Ошибка несвязанного модуля, записанная через внешнюю правку, не должна
    // быть потеряна.
    expect(after.errors['unrelated']).toBe('other module failed');
  });
});

describe('initSettingsUI onChange — откат чекбокса при провале enable/disable', () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '';
    document.head.querySelectorAll('style[id^="svp-"]').forEach((node) => {
      node.remove();
    });
    localStorage.setItem('svp_settings', JSON.stringify({ version: 4, modules: {}, errors: {} }));
  });

  function getFirstModuleCheckbox(): HTMLInputElement {
    const panel = document.getElementById('svp-settings-panel');
    if (!panel) throw new Error('svp-settings-panel not rendered');
    const checkbox = panel.querySelector<HTMLInputElement>('.svp-module-row .svp-module-checkbox');
    if (!checkbox) throw new Error('module checkbox not found');
    return checkbox;
  }

  function getStoredSettings(): {
    version: number;
    modules: Record<string, boolean>;
    errors: Record<string, string>;
  } {
    const raw = localStorage.getItem('svp_settings');
    if (!raw) throw new Error('svp_settings not set');
    return JSON.parse(raw) as {
      version: number;
      modules: Record<string, boolean>;
      errors: Record<string, string>;
    };
  }

  test('sync throw в enable: checkbox и storage откатываются в false', () => {
    const alpha = createMockModule({
      id: 'alpha',
      defaultEnabled: false,
      enable: jest.fn(() => {
        throw new Error('enable sync boom');
      }),
    });

    initSettingsUI([alpha], new Map());

    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
    const alphaCheckbox = getFirstModuleCheckbox();
    expect(alphaCheckbox.checked).toBe(false);
    alphaCheckbox.checked = true;
    alphaCheckbox.dispatchEvent(new Event('change'));
    consoleErrorSpy.mockRestore();

    expect(alphaCheckbox.checked).toBe(false);
    const after = getStoredSettings();
    expect(after.modules['alpha']).toBe(false);
    expect(after.errors['alpha']).toContain('enable sync boom');
  });

  test('sync throw в disable: checkbox и storage откатываются в true', () => {
    const alpha = createMockModule({
      id: 'alpha',
      defaultEnabled: true,
      disable: jest.fn(() => {
        throw new Error('disable sync boom');
      }),
    });

    initSettingsUI([alpha], new Map());

    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
    const alphaCheckbox = getFirstModuleCheckbox();
    expect(alphaCheckbox.checked).toBe(true);
    alphaCheckbox.checked = false;
    alphaCheckbox.dispatchEvent(new Event('change'));
    consoleErrorSpy.mockRestore();

    expect(alphaCheckbox.checked).toBe(true);
    const after = getStoredSettings();
    expect(after.modules['alpha']).toBe(true);
    expect(after.errors['alpha']).toContain('disable sync boom');
  });

  test('async rejection в enable: checkbox и storage откатываются после await', async () => {
    const alpha = createMockModule({
      id: 'alpha',
      defaultEnabled: false,
      enable: jest.fn(() => Promise.reject(new Error('enable async boom'))),
    });

    initSettingsUI([alpha], new Map());

    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
    const alphaCheckbox = getFirstModuleCheckbox();
    alphaCheckbox.checked = true;
    alphaCheckbox.dispatchEvent(new Event('change'));

    // Ждём микротаски, чтобы async enable успел зареджектиться и откат
    // применился.
    await Promise.resolve();
    await Promise.resolve();
    consoleErrorSpy.mockRestore();

    expect(alphaCheckbox.checked).toBe(false);
    const after = getStoredSettings();
    expect(after.modules['alpha']).toBe(false);
    expect(after.errors['alpha']).toContain('enable async boom');
  });

  test('успешный enable: checkbox остаётся в новом положении, storage обновлён', () => {
    const alpha = createMockModule({
      id: 'alpha',
      defaultEnabled: false,
      enable: jest.fn(),
    });

    initSettingsUI([alpha], new Map());

    const alphaCheckbox = getFirstModuleCheckbox();
    alphaCheckbox.checked = true;
    alphaCheckbox.dispatchEvent(new Event('change'));

    expect(alphaCheckbox.checked).toBe(true);
    const after = getStoredSettings();
    expect(after.modules['alpha']).toBe(true);
    expect(after.errors['alpha']).toBeUndefined();
  });
});

describe('initSettingsUI toggle-all — откат чекбоксов при частичном провале', () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '';
    document.head.querySelectorAll('style[id^="svp-"]').forEach((node) => {
      node.remove();
    });
    localStorage.setItem('svp_settings', JSON.stringify({ version: 4, modules: {}, errors: {} }));
  });

  function getToggleAllCheckbox(): HTMLInputElement {
    const panel = document.getElementById('svp-settings-panel');
    if (!panel) throw new Error('svp-settings-panel not rendered');
    const checkbox = panel.querySelector<HTMLInputElement>('.svp-toggle-all-checkbox');
    if (!checkbox) throw new Error('toggle-all checkbox not found');
    return checkbox;
  }

  function getModuleCheckboxes(): HTMLInputElement[] {
    const panel = document.getElementById('svp-settings-panel');
    if (!panel) throw new Error('svp-settings-panel not rendered');
    return Array.from(
      panel.querySelectorAll<HTMLInputElement>('.svp-module-row .svp-module-checkbox'),
    );
  }

  function getStoredSettings(): {
    version: number;
    modules: Record<string, boolean>;
    errors: Record<string, string>;
  } {
    const raw = localStorage.getItem('svp_settings');
    if (!raw) throw new Error('svp_settings not set');
    return JSON.parse(raw) as {
      version: number;
      modules: Record<string, boolean>;
      errors: Record<string, string>;
    };
  }

  test('успешные модули остаются в новом положении, упавший откатывается', async () => {
    const alpha = createMockModule({ id: 'alpha', defaultEnabled: false, enable: jest.fn() });
    const beta = createMockModule({
      id: 'beta',
      defaultEnabled: false,
      enable: jest.fn(() => {
        throw new Error('beta enable boom');
      }),
    });
    const gamma = createMockModule({ id: 'gamma', defaultEnabled: false, enable: jest.fn() });

    initSettingsUI([alpha, beta, gamma], new Map());

    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
    const toggleAll = getToggleAllCheckbox();
    toggleAll.checked = true;
    toggleAll.dispatchEvent(new Event('change'));
    await Promise.resolve();
    await Promise.resolve();
    consoleErrorSpy.mockRestore();

    const [alphaCheckbox, betaCheckbox, gammaCheckbox] = getModuleCheckboxes();
    expect(alphaCheckbox.checked).toBe(true);
    expect(betaCheckbox.checked).toBe(false);
    expect(gammaCheckbox.checked).toBe(true);

    const after = getStoredSettings();
    expect(after.modules['alpha']).toBe(true);
    expect(after.modules['beta']).toBe(false);
    expect(after.modules['gamma']).toBe(true);
    expect(after.errors['beta']).toContain('beta enable boom');
    expect(after.errors['alpha']).toBeUndefined();
    expect(after.errors['gamma']).toBeUndefined();
  });

  test('async rejection одного модуля не мешает другим продолжиться', async () => {
    const alpha = createMockModule({ id: 'alpha', defaultEnabled: false, enable: jest.fn() });
    const beta = createMockModule({
      id: 'beta',
      defaultEnabled: false,
      enable: jest.fn(() => Promise.reject(new Error('beta async boom'))),
    });
    const gamma = createMockModule({ id: 'gamma', defaultEnabled: false, enable: jest.fn() });

    initSettingsUI([alpha, beta, gamma], new Map());

    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
    const toggleAll = getToggleAllCheckbox();
    toggleAll.checked = true;
    toggleAll.dispatchEvent(new Event('change'));
    // Ждём микротаски, чтобы async rejection в beta и последующий цикл для
    // gamma завершились.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    consoleErrorSpy.mockRestore();

    const [alphaCheckbox, betaCheckbox, gammaCheckbox] = getModuleCheckboxes();
    expect(alphaCheckbox.checked).toBe(true);
    expect(betaCheckbox.checked).toBe(false);
    expect(gammaCheckbox.checked).toBe(true);

    const after = getStoredSettings();
    expect(after.modules['alpha']).toBe(true);
    expect(after.modules['beta']).toBe(false);
    expect(after.modules['gamma']).toBe(true);
    expect(after.errors['beta']).toContain('beta async boom');
  });

  test('toggle-all master checkbox в indeterminate после смешанного результата', async () => {
    const alpha = createMockModule({ id: 'alpha', defaultEnabled: false, enable: jest.fn() });
    const beta = createMockModule({
      id: 'beta',
      defaultEnabled: false,
      enable: jest.fn(() => {
        throw new Error('fail');
      }),
    });

    initSettingsUI([alpha, beta], new Map());

    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
    const toggleAll = getToggleAllCheckbox();
    toggleAll.checked = true;
    toggleAll.dispatchEvent(new Event('change'));
    await Promise.resolve();
    await Promise.resolve();
    consoleErrorSpy.mockRestore();

    // После обработки: alpha=true, beta=false. updateMasterState() должен
    // перевести master в indeterminate, а checked в false (1 из 2 включён).
    expect(toggleAll.indeterminate).toBe(true);
    expect(toggleAll.checked).toBe(false);
  });
});

describe('initSettingsUI — модули, несовместимые с хостом', () => {
  const SCOUT_UA = 'Mozilla/5.0 (Linux; Android 13) SbgScout/1.2.3';
  const BROWSER_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0';
  const ORIGINAL_USER_AGENT = navigator.userAgent;

  function setUserAgent(value: string): void {
    Object.defineProperty(navigator, 'userAgent', { value, configurable: true });
  }

  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '';
    document.head.querySelectorAll('style[id^="svp-"]').forEach((node) => {
      node.remove();
    });
  });

  afterEach(() => {
    setUserAgent(ORIGINAL_USER_AGENT);
  });

  function getCheckboxByModuleId(moduleId: string): HTMLInputElement {
    const panel = document.getElementById('svp-settings-panel');
    if (!panel) throw new Error('svp-settings-panel not rendered');
    const rows = panel.querySelectorAll('.svp-module-row');
    for (const row of rows) {
      const id = row.querySelector('.svp-module-id')?.textContent;
      if (id === moduleId) {
        const checkbox = row.querySelector<HTMLInputElement>('.svp-module-checkbox');
        if (!checkbox) throw new Error(`checkbox for ${moduleId} not found`);
        return checkbox;
      }
    }
    throw new Error(`row for ${moduleId} not found`);
  }

  function getRowByModuleId(moduleId: string): HTMLElement {
    const panel = document.getElementById('svp-settings-panel');
    if (!panel) throw new Error('svp-settings-panel not rendered');
    const rows = panel.querySelectorAll<HTMLElement>('.svp-module-row');
    for (const row of rows) {
      const id = row.querySelector('.svp-module-id')?.textContent;
      if (id === moduleId) return row;
    }
    throw new Error(`row for ${moduleId} not found`);
  }

  test('в SBG Scout keepScreenOn рендерится без чекбокса', () => {
    setUserAgent(SCOUT_UA);
    const keepScreenOn = createMockModule({ id: 'keepScreenOn', defaultEnabled: true });

    initSettingsUI([keepScreenOn], new Map());

    const row = getRowByModuleId('keepScreenOn');
    expect(row.querySelector('.svp-module-checkbox')).toBeNull();
  });

  test('в SBG Scout строка keepScreenOn содержит подпись о Scout', () => {
    setUserAgent(SCOUT_UA);
    const keepScreenOn = createMockModule({ id: 'keepScreenOn', defaultEnabled: true });

    initSettingsUI([keepScreenOn], new Map());

    const row = getRowByModuleId('keepScreenOn');
    const label = row.querySelector('.svp-module-row-host-provided-label');
    expect(label).not.toBeNull();
    expect(label?.textContent.toLowerCase()).toContain('scout');
  });

  test('в SBG Scout строка keepScreenOn имеет CSS-класс host-provided (для серого цвета)', () => {
    setUserAgent(SCOUT_UA);
    const keepScreenOn = createMockModule({ id: 'keepScreenOn', defaultEnabled: true });

    initSettingsUI([keepScreenOn], new Map());

    const row = getRowByModuleId('keepScreenOn');
    expect(row.classList.contains('svp-module-row-host-provided')).toBe(true);
  });

  test('в обычном браузере keepScreenOn рендерится как обычный чекбокс', () => {
    setUserAgent(BROWSER_UA);
    const keepScreenOn = createMockModule({ id: 'keepScreenOn', defaultEnabled: true });
    localStorage.setItem(
      'svp_settings',
      JSON.stringify({ version: 4, modules: { keepScreenOn: true }, errors: {} }),
    );

    initSettingsUI([keepScreenOn], new Map());

    const checkbox = getCheckboxByModuleId('keepScreenOn');
    expect(checkbox.disabled).toBe(false);
    expect(checkbox.checked).toBe(true);
  });

  test('в SBG Scout toggle-all не вызывает enable для keepScreenOn (строка без чекбокса)', async () => {
    setUserAgent(SCOUT_UA);
    const keepScreenOn = createMockModule({
      id: 'keepScreenOn',
      defaultEnabled: true,
      enable: jest.fn(),
    });
    const other = createMockModule({ id: 'other', defaultEnabled: true, enable: jest.fn() });

    initSettingsUI([keepScreenOn, other], new Map());

    const toggleAll = document.querySelector<HTMLInputElement>('.svp-toggle-all-checkbox');
    if (!toggleAll) throw new Error('toggle-all checkbox not rendered');
    toggleAll.checked = true;
    toggleAll.dispatchEvent(new Event('change'));
    await Promise.resolve();
    await Promise.resolve();

    // В строке keepScreenOn чекбокса нет вовсе, и toggle-all не должен его
    // активировать — host-provided модуль не управляется пользователем.
    const row = getRowByModuleId('keepScreenOn');
    expect(row.querySelector('.svp-module-checkbox')).toBeNull();
    expect(keepScreenOn.enable).not.toHaveBeenCalled();
  });

  test('в SBG Scout master-состояние toggle-all игнорирует host-provided строку', () => {
    setUserAgent(SCOUT_UA);
    const keepScreenOn = createMockModule({ id: 'keepScreenOn', defaultEnabled: true });
    const other = createMockModule({ id: 'other', defaultEnabled: true });
    localStorage.setItem(
      'svp_settings',
      JSON.stringify({ version: 4, modules: { other: true }, errors: {} }),
    );

    initSettingsUI([keepScreenOn, other], new Map());

    // other включён, keepScreenOn disabled и не считается — master должен быть
    // полностью checked, без indeterminate.
    const toggleAll = document.querySelector<HTMLInputElement>('.svp-toggle-all-checkbox');
    if (!toggleAll) throw new Error('toggle-all checkbox not rendered');
    expect(toggleAll.checked).toBe(true);
    expect(toggleAll.indeterminate).toBe(false);
  });
});

describe('initSettingsUI — модули, нативные в SBG 0.6.1', () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '';
    document.head.querySelectorAll('style[id^="svp-"]').forEach((node) => {
      node.remove();
    });
  });

  afterEach(() => {
    resetDetectedVersionForTest();
  });

  function getRowByModuleId(moduleId: string): HTMLElement {
    const panel = document.getElementById('svp-settings-panel');
    if (!panel) throw new Error('svp-settings-panel not rendered');
    const rows = panel.querySelectorAll<HTMLElement>('.svp-module-row');
    for (const row of rows) {
      const id = row.querySelector('.svp-module-id')?.textContent;
      if (id === moduleId) return row;
    }
    throw new Error(`row for ${moduleId} not found`);
  }

  test('в 0.6.1 строка favoritedPoints рендерится без чекбокса', () => {
    setDetectedVersionForTest('0.6.1');
    const favoritedPoints = createMockModule({ id: 'favoritedPoints', defaultEnabled: true });

    initSettingsUI([favoritedPoints], new Map());

    const row = getRowByModuleId('favoritedPoints');
    expect(row.querySelector('.svp-module-checkbox')).toBeNull();
  });

  test('в 0.6.1 строка favoritedPoints содержит подпись о нативной реализации', () => {
    setDetectedVersionForTest('0.6.1');
    // Локаль берётся из localStorage['settings'].lang игры (см. l10n.getGameLocale).
    // Заряжаем RU чтобы проверить именно русскую подпись.
    localStorage.setItem('settings', JSON.stringify({ lang: 'ru' }));
    const favoritedPoints = createMockModule({ id: 'favoritedPoints', defaultEnabled: true });

    initSettingsUI([favoritedPoints], new Map());

    const row = getRowByModuleId('favoritedPoints');
    const label = row.querySelector('.svp-module-row-native-in-game-label');
    expect(label).not.toBeNull();
    expect(label?.textContent).toContain('игре');
  });

  test('в 0.6.1 строка favoritedPoints имеет CSS-класс native-in-game (для серого цвета)', () => {
    setDetectedVersionForTest('0.6.1');
    const favoritedPoints = createMockModule({ id: 'favoritedPoints', defaultEnabled: true });

    initSettingsUI([favoritedPoints], new Map());

    const row = getRowByModuleId('favoritedPoints');
    expect(row.classList.contains('svp-module-row-native-in-game')).toBe(true);
  });

  test('в 0.6.0 favoritedPoints рендерится как обычный чекбокс', () => {
    setDetectedVersionForTest('0.6.0');
    localStorage.setItem(
      'svp_settings',
      JSON.stringify({ version: 4, modules: { favoritedPoints: true }, errors: {} }),
    );
    const favoritedPoints = createMockModule({ id: 'favoritedPoints', defaultEnabled: true });

    initSettingsUI([favoritedPoints], new Map());

    const row = getRowByModuleId('favoritedPoints');
    const checkbox = row.querySelector<HTMLInputElement>('.svp-module-checkbox');
    expect(checkbox).not.toBeNull();
    expect(checkbox?.checked).toBe(true);
  });

  test('в 0.6.1 toggle-all не вызывает enable для favoritedPoints (строка без чекбокса)', async () => {
    setDetectedVersionForTest('0.6.1');
    const favoritedPoints = createMockModule({
      id: 'favoritedPoints',
      defaultEnabled: true,
      enable: jest.fn(),
    });
    const other = createMockModule({ id: 'other', defaultEnabled: true, enable: jest.fn() });

    initSettingsUI([favoritedPoints, other], new Map());

    const toggleAll = document.querySelector<HTMLInputElement>('.svp-toggle-all-checkbox');
    if (!toggleAll) throw new Error('toggle-all checkbox not rendered');
    toggleAll.checked = true;
    toggleAll.dispatchEvent(new Event('change'));
    await Promise.resolve();
    await Promise.resolve();

    const row = getRowByModuleId('favoritedPoints');
    expect(row.querySelector('.svp-module-checkbox')).toBeNull();
    expect(favoritedPoints.enable).not.toHaveBeenCalled();
  });
});

describe('initSettingsUI — модули, конфликтующие с SBG 0.6.1', () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '';
    document.head.querySelectorAll('style[id^="svp-"]').forEach((node) => {
      node.remove();
    });
  });

  afterEach(() => {
    resetDetectedVersionForTest();
  });

  function getRowByModuleId(moduleId: string): HTMLElement {
    const panel = document.getElementById('svp-settings-panel');
    if (!panel) throw new Error('svp-settings-panel not rendered');
    const rows = panel.querySelectorAll<HTMLElement>('.svp-module-row');
    for (const row of rows) {
      const id = row.querySelector('.svp-module-id')?.textContent;
      if (id === moduleId) return row;
    }
    throw new Error(`row for ${moduleId} not found`);
  }

  test('в 0.6.1 строка swipeToClosePopup рендерится без чекбокса', () => {
    setDetectedVersionForTest('0.6.1');
    const swipeToClosePopup = createMockModule({
      id: 'swipeToClosePopup',
      defaultEnabled: true,
    });

    initSettingsUI([swipeToClosePopup], new Map());

    const row = getRowByModuleId('swipeToClosePopup');
    expect(row.querySelector('.svp-module-checkbox')).toBeNull();
  });

  test('в 0.6.1 строка swipeToClosePopup содержит подпись о конфликте', () => {
    setDetectedVersionForTest('0.6.1');
    // Локаль берётся из localStorage['settings'].lang игры — заряжаем RU
    // чтобы проверить русскую подпись.
    localStorage.setItem('settings', JSON.stringify({ lang: 'ru' }));
    const swipeToClosePopup = createMockModule({
      id: 'swipeToClosePopup',
      defaultEnabled: true,
    });

    initSettingsUI([swipeToClosePopup], new Map());

    const row = getRowByModuleId('swipeToClosePopup');
    const label = row.querySelector('.svp-module-row-conflicting-with-game-label');
    expect(label).not.toBeNull();
    expect(label?.textContent).toContain('Конфликтует');
  });

  test('в 0.6.1 строка swipeToClosePopup имеет CSS-класс conflicting-with-game', () => {
    setDetectedVersionForTest('0.6.1');
    const swipeToClosePopup = createMockModule({
      id: 'swipeToClosePopup',
      defaultEnabled: true,
    });

    initSettingsUI([swipeToClosePopup], new Map());

    const row = getRowByModuleId('swipeToClosePopup');
    expect(row.classList.contains('svp-module-row-conflicting-with-game')).toBe(true);
    expect(row.classList.contains('svp-module-row-native-in-game')).toBe(false);
  });

  test('в 0.6.0 swipeToClosePopup рендерится как обычный чекбокс', () => {
    setDetectedVersionForTest('0.6.0');
    localStorage.setItem(
      'svp_settings',
      JSON.stringify({ version: 4, modules: { swipeToClosePopup: true }, errors: {} }),
    );
    const swipeToClosePopup = createMockModule({
      id: 'swipeToClosePopup',
      defaultEnabled: true,
    });

    initSettingsUI([swipeToClosePopup], new Map());

    const row = getRowByModuleId('swipeToClosePopup');
    const checkbox = row.querySelector<HTMLInputElement>('.svp-module-checkbox');
    expect(checkbox).not.toBeNull();
    expect(checkbox?.checked).toBe(true);
  });

  test('в 0.6.1 toggle-all не вызывает enable для swipeToClosePopup', async () => {
    setDetectedVersionForTest('0.6.1');
    const swipeToClosePopup = createMockModule({
      id: 'swipeToClosePopup',
      defaultEnabled: true,
      enable: jest.fn(),
    });
    const other = createMockModule({ id: 'other', defaultEnabled: true, enable: jest.fn() });

    initSettingsUI([swipeToClosePopup, other], new Map());

    const toggleAll = document.querySelector<HTMLInputElement>('.svp-toggle-all-checkbox');
    if (!toggleAll) throw new Error('toggle-all checkbox not rendered');
    toggleAll.checked = true;
    toggleAll.dispatchEvent(new Event('change'));
    await Promise.resolve();
    await Promise.resolve();

    const row = getRowByModuleId('swipeToClosePopup');
    expect(row.querySelector('.svp-module-checkbox')).toBeNull();
    expect(swipeToClosePopup.enable).not.toHaveBeenCalled();
  });
});

describe('initSettingsUI — уведомление при отказе saveSettings', () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '';
    document.head.querySelectorAll('style[id^="svp-"]').forEach((node) => {
      node.remove();
    });
    localStorage.setItem('svp_settings', JSON.stringify({ version: 4, modules: {}, errors: {} }));
  });

  test('при QuotaExceededError в saveSettings пользователю показывается toast', async () => {
    jest.spyOn(console, 'error').mockImplementation();
    const alpha = createMockModule({ id: 'alpha', defaultEnabled: true });
    initSettingsUI([alpha], new Map());

    // Симулируем переполненный storage: setItem начинает бросать на
    // любые записи ПОСЛЕ того как панель построена.
    const setItemSpy = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });

    const checkbox = document.querySelector<HTMLInputElement>(
      '.svp-module-row .svp-module-checkbox',
    );
    if (!checkbox) throw new Error('module checkbox not found');
    checkbox.checked = false;
    checkbox.dispatchEvent(new Event('change'));

    await Promise.resolve();
    await Promise.resolve();

    const toast = document.querySelector('.svp-toast');
    expect(toast).not.toBeNull();
    expect(toast?.textContent.toLowerCase()).toMatch(/(настройк|settings)/);

    setItemSpy.mockRestore();
  });

  test('при отказе saveSettings чекбокс откатывается к исходному состоянию', async () => {
    jest.spyOn(console, 'error').mockImplementation();
    const alpha = createMockModule({ id: 'alpha', defaultEnabled: true });
    initSettingsUI([alpha], new Map());

    const setItemSpy = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });

    const checkbox = document.querySelector<HTMLInputElement>(
      '.svp-module-row .svp-module-checkbox',
    );
    if (!checkbox) throw new Error('module checkbox not found');
    expect(checkbox.checked).toBe(true);
    checkbox.checked = false;
    checkbox.dispatchEvent(new Event('change'));

    await Promise.resolve();
    await Promise.resolve();

    // enable/disable не вызывались — откатились до попытки переключить модуль.
    expect(alpha.enable).not.toHaveBeenCalled();
    expect(alpha.disable).not.toHaveBeenCalled();
    expect(checkbox.checked).toBe(true);

    setItemSpy.mockRestore();
  });
});
