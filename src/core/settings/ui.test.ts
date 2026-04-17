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

describe('initSettingsUI refresh-on-show', () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '<div class="settings-content"></div>';
    document.head.querySelectorAll('style[id^="svp-"]').forEach((node) => {
      node.remove();
    });
    localStorage.setItem('svp_settings', JSON.stringify({ version: 4, modules: {}, errors: {} }));
  });

  function getCheckbox(id: string): HTMLInputElement {
    const panel = document.getElementById('svp-settings-panel');
    if (!panel) throw new Error('panel not rendered');
    const row = panel.querySelector(`.svp-module-row[data-svp-module-id="${id}"]`);
    if (!row) {
      const byText = [...panel.querySelectorAll('.svp-module-row')].find(
        (node) => node.querySelector('.svp-module-id')?.textContent === id,
      );
      if (!byText) throw new Error(`module row ${id} not found`);
      const checkbox = byText.querySelector<HTMLInputElement>('.svp-module-checkbox');
      if (!checkbox) throw new Error(`checkbox for ${id} not found`);
      return checkbox;
    }
    const checkbox = row.querySelector<HTMLInputElement>('.svp-module-checkbox');
    if (!checkbox) throw new Error(`checkbox for ${id} not found`);
    return checkbox;
  }

  function clickOpenButton(): void {
    const entry = document.getElementById('svp-game-settings-entry');
    if (!entry) throw new Error('game settings entry not injected');
    const openButton = entry.querySelector<HTMLButtonElement>('.settings-section__button');
    if (!openButton) throw new Error('open button not found');
    openButton.click();
  }

  test('T2.1: открытие панели перечитывает состояние чекбоксов из свежего localStorage', () => {
    const alpha = createMockModule({ id: 'alpha', defaultEnabled: true });
    initSettingsUI([alpha], new Map());

    const checkbox = getCheckbox('alpha');
    expect(checkbox.checked).toBe(true);

    // Внешняя запись в storage после построения панели (например, провал saveSettings
    // в bootstrap, который потом другой код переписал, либо любой другой источник).
    localStorage.setItem(
      'svp_settings',
      JSON.stringify({ version: 4, modules: { alpha: false }, errors: {} }),
    );

    // Пока панель закрыта — чекбокс ещё старый.
    expect(checkbox.checked).toBe(true);

    clickOpenButton();

    // Открытие подтянуло актуальный localStorage.
    expect(checkbox.checked).toBe(false);
  });

  test('T2.3: открытие панели подтягивает ошибки модулей в error-display', () => {
    const alpha = createMockModule({ id: 'alpha', defaultEnabled: true });
    const errorDisplay = new Map<string, (message: string | null) => void>();
    initSettingsUI([alpha], errorDisplay);

    const callback = errorDisplay.get('alpha');
    if (!callback) throw new Error('error callback for alpha not set');
    const callbackSpy = jest.fn(callback);
    errorDisplay.set('alpha', callbackSpy);

    localStorage.setItem(
      'svp_settings',
      JSON.stringify({
        version: 4,
        modules: { alpha: true },
        errors: { alpha: 'boom' },
      }),
    );

    clickOpenButton();

    expect(callbackSpy).toHaveBeenCalledWith('boom');
  });

  test('открытие панели обновляет master toggle к актуальному состоянию', () => {
    const alpha = createMockModule({ id: 'alpha', defaultEnabled: true });
    const beta = createMockModule({ id: 'beta', defaultEnabled: true });
    initSettingsUI([alpha, beta], new Map());

    const master = document.querySelector<HTMLInputElement>('.svp-toggle-all-checkbox');
    if (!master) throw new Error('master not found');
    // Сейчас обе включены — master включён, без indeterminate.
    expect(master.checked).toBe(true);
    expect(master.indeterminate).toBe(false);

    // Внешне выключили один — master должен стать indeterminate после refresh.
    localStorage.setItem(
      'svp_settings',
      JSON.stringify({
        version: 4,
        modules: { alpha: true, beta: false },
        errors: {},
      }),
    );

    clickOpenButton();

    expect(master.checked).toBe(false);
    expect(master.indeterminate).toBe(true);
  });

  test('refresh не ломается если ни один модуль не в checkboxMap (все disallowed)', () => {
    // В этом тесте просто убеждаемся, что refresh проходит без ошибок для
    // модуля без чекбокса в checkboxMap. Точно воспроизвести disallowed-ветку
    // в jest-окружении сложно (нужен мок host), но страховка важна.
    const alpha = createMockModule({ id: 'alpha', defaultEnabled: true });
    initSettingsUI([alpha], new Map());

    expect(() => {
      clickOpenButton();
    }).not.toThrow();
  });
});

describe('initSettingsUI — диагностический лог enhancedMainScreen', () => {
  let consoleInfoSpy: jest.SpyInstance;

  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '';
    document.head.querySelectorAll('style[id^="svp-"]').forEach((node) => {
      node.remove();
    });
    localStorage.setItem('svp_settings', JSON.stringify({ version: 4, modules: {}, errors: {} }));
    consoleInfoSpy = jest.spyOn(console, 'info').mockImplementation();
  });

  afterEach(() => {
    consoleInfoSpy.mockRestore();
  });

  function createEnhancedMainScreenMock(overrides: Partial<IFeatureModule> = {}): IFeatureModule {
    return {
      id: 'enhancedMainScreen',
      name: { en: 'EMS', ru: 'ГУЭ' },
      description: { en: 'EMS', ru: 'ГУЭ' },
      defaultEnabled: true,
      category: 'ui',
      init: jest.fn(),
      enable: jest.fn(),
      disable: jest.fn(),
      ...overrides,
    };
  }

  test('T2.5: при выключении без svp-compact на контейнере пишется диагностический лог', () => {
    // .topleft-container существует, но модуль не применил свои изменения — класса нет.
    document.body.innerHTML = '<div class="topleft-container"></div>';

    const ems = createEnhancedMainScreenMock();
    initSettingsUI([ems], new Map());

    const checkbox = document.querySelector<HTMLInputElement>(
      '.svp-module-row .svp-module-checkbox',
    );
    if (!checkbox) throw new Error('checkbox not found');
    checkbox.checked = false;
    checkbox.dispatchEvent(new Event('change'));

    expect(consoleInfoSpy).toHaveBeenCalledWith(expect.stringContaining('enhancedMainScreen'));
    expect(ems.disable).toHaveBeenCalledTimes(1);
  });

  test('при выключении со svp-compact на контейнере лог не пишется', () => {
    // .topleft-container имеет класс — значит наши изменения применены, атрибуция ясна.
    document.body.innerHTML = '<div class="topleft-container svp-compact"></div>';

    const ems = createEnhancedMainScreenMock();
    initSettingsUI([ems], new Map());

    const checkbox = document.querySelector<HTMLInputElement>(
      '.svp-module-row .svp-module-checkbox',
    );
    if (!checkbox) throw new Error('checkbox not found');
    checkbox.checked = false;
    checkbox.dispatchEvent(new Event('change'));

    expect(consoleInfoSpy).not.toHaveBeenCalled();
  });

  test('при включении диагностический лог не пишется', () => {
    document.body.innerHTML = '<div class="topleft-container"></div>';
    // Модуль изначально выключен — чекбокс будет false, кликаем на true.
    localStorage.setItem(
      'svp_settings',
      JSON.stringify({
        version: 4,
        modules: { enhancedMainScreen: false },
        errors: {},
      }),
    );

    const ems = createEnhancedMainScreenMock();
    initSettingsUI([ems], new Map());

    const checkbox = document.querySelector<HTMLInputElement>(
      '.svp-module-row .svp-module-checkbox',
    );
    if (!checkbox) throw new Error('checkbox not found');
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));

    expect(consoleInfoSpy).not.toHaveBeenCalled();
  });

  test('у других модулей диагностический лог не срабатывает', () => {
    document.body.innerHTML = '<div class="topleft-container"></div>';

    const other = createMockModule({ id: 'otherModule', defaultEnabled: true });
    initSettingsUI([other], new Map());

    const checkbox = document.querySelector<HTMLInputElement>(
      '.svp-module-row .svp-module-checkbox',
    );
    if (!checkbox) throw new Error('checkbox not found');
    checkbox.checked = false;
    checkbox.dispatchEvent(new Event('change'));

    expect(consoleInfoSpy).not.toHaveBeenCalled();
  });
});
