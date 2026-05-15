import { installSettingsUi, uninstallSettingsUi } from './settingsUi';
import { loadDrawingRestrictionsSettings, saveDrawingRestrictionsSettings } from './settings';

const CONFIGURE_BUTTON_CLASS = 'svp-dr-configure-button';
const PANEL_CLASS = 'svp-dr-settings-panel';

function createModuleRow(moduleId: string, withNameLine = true): HTMLElement {
  const row = document.createElement('div');
  row.className = 'svp-module-row';
  if (withNameLine) {
    const nameLine = document.createElement('div');
    nameLine.className = 'svp-module-name-line';
    row.appendChild(nameLine);
  }
  const idElement = document.createElement('span');
  idElement.className = 'svp-module-id';
  idElement.textContent = moduleId;
  row.appendChild(idElement);
  document.body.appendChild(row);
  return row;
}

function getConfigureButton(): HTMLElement | null {
  return document.querySelector<HTMLElement>(`.${CONFIGURE_BUTTON_CLASS}`);
}

function getPanel(): HTMLElement | null {
  return document.querySelector<HTMLElement>(`.${PANEL_CLASS}`);
}

async function flushRaf(): Promise<void> {
  // jsdom requestAnimationFrame — через setTimeout(0).
  await new Promise<void>((resolve) => setTimeout(resolve, 16));
}

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
});

afterEach(() => {
  uninstallSettingsUi();
  document.body.innerHTML = '';
  localStorage.clear();
});

describe('injectConfigureButton', () => {
  test('вставляет кнопку в .svp-module-name-line при совпадении module-id', () => {
    createModuleRow('drawingRestrictions');
    installSettingsUi();
    const button = getConfigureButton();
    expect(button).not.toBeNull();
    expect(button?.parentElement?.className).toBe('svp-module-name-line');
  });

  // 6.C: textContent !== MODULE_ID — skip.
  test('не вставляет кнопку в module-row другого модуля', () => {
    createModuleRow('favoritedPoints');
    installSettingsUi();
    expect(getConfigureButton()).toBeNull();
  });

  // 6.D: !row — skip (module-id без обёртки svp-module-row).
  test('без .svp-module-row вокруг module-id — не вставляет кнопку', () => {
    const idElement = document.createElement('span');
    idElement.className = 'svp-module-id';
    idElement.textContent = 'drawingRestrictions';
    document.body.appendChild(idElement);
    installSettingsUi();
    expect(getConfigureButton()).toBeNull();
  });

  // 6.E: row уже содержит configure-button — ничего не делаем.
  test('повторный install не создаёт вторую кнопку', () => {
    createModuleRow('drawingRestrictions');
    installSettingsUi();
    uninstallSettingsUi();
    // Кнопка удалена uninstall'ом. Но если бы оставалась — guard должен сработать.
    // Поэтому проверим иначе: installSettingsUi два раза без uninstall.
    installSettingsUi();
    installSettingsUi();
    const buttons = document.querySelectorAll(`.${CONFIGURE_BUTTON_CLASS}`);
    expect(buttons.length).toBe(1);
  });

  // 6.F: !nameLine — skip.
  test('без .svp-module-name-line — кнопка не вставлена', () => {
    createModuleRow('drawingRestrictions', false);
    installSettingsUi();
    expect(getConfigureButton()).toBeNull();
  });
});

describe('openPanel (клик по Configure)', () => {
  test('клик открывает панель настроек', () => {
    createModuleRow('drawingRestrictions');
    installSettingsUi();
    expect(getPanel()).toBeNull();
    getConfigureButton()?.click();
    expect(getPanel()).not.toBeNull();
  });

  test('повторный клик по Configure заменяет старую панель новой', () => {
    createModuleRow('drawingRestrictions');
    installSettingsUi();
    getConfigureButton()?.click();
    const first = getPanel();
    getConfigureButton()?.click();
    const second = getPanel();
    expect(second).not.toBeNull();
    expect(second).not.toBe(first);
  });

  test('Close button удаляет панель', () => {
    createModuleRow('drawingRestrictions');
    installSettingsUi();
    getConfigureButton()?.click();
    const closeButton = getPanel()?.querySelector<HTMLButtonElement>('button');
    expect(closeButton).not.toBeNull();
    closeButton?.click();
    expect(getPanel()).toBeNull();
  });

  test('клик по кнопке «Configure» не всплывает (stopPropagation)', () => {
    createModuleRow('drawingRestrictions');
    installSettingsUi();
    const rowClick = jest.fn();
    document.querySelector('.svp-module-row')?.addEventListener('click', rowClick);
    getConfigureButton()?.click();
    expect(rowClick).not.toHaveBeenCalled();
  });
});

describe('buildPanel — radio favProtectionMode', () => {
  test('текущее значение отмечено как checked', () => {
    saveDrawingRestrictionsSettings({
      version: 1,
      favProtectionMode: 'hideAllFavorites',
      maxDistanceMeters: 0,
    });
    createModuleRow('drawingRestrictions');
    installSettingsUi();
    getConfigureButton()?.click();
    const radios = getPanel()?.querySelectorAll<HTMLInputElement>('input[type="radio"]');
    expect(radios).toBeDefined();
    const checked = Array.from(radios ?? []).find((radio) => radio.checked);
    expect(checked?.value).toBe('hideAllFavorites');
  });

  test('смена radio сохраняет новый режим', () => {
    createModuleRow('drawingRestrictions');
    installSettingsUi();
    getConfigureButton()?.click();
    const radio = getPanel()?.querySelector<HTMLInputElement>('input[value="hideAllFavorites"]');
    expect(radio).not.toBeNull();
    if (radio) {
      radio.checked = true;
      radio.dispatchEvent(new Event('change'));
    }
    expect(loadDrawingRestrictionsSettings().favProtectionMode).toBe('hideAllFavorites');
  });

  // 6.A FALSE: `!radio.checked` → выход (только программный снят).
  test('событие change с checked=false не сохраняет', () => {
    saveDrawingRestrictionsSettings({
      version: 1,
      favProtectionMode: 'protectLastKey',
      maxDistanceMeters: 0,
    });
    createModuleRow('drawingRestrictions');
    installSettingsUi();
    getConfigureButton()?.click();
    const radio = getPanel()?.querySelector<HTMLInputElement>('input[value="off"]');
    if (radio) {
      radio.checked = false;
      radio.dispatchEvent(new Event('change'));
    }
    // Настройка не изменилась (остался protectLastKey).
    expect(loadDrawingRestrictionsSettings().favProtectionMode).toBe('protectLastKey');
  });
});

describe('buildPanel — distance input', () => {
  function changeDistance(value: string): void {
    const input = getPanel()?.querySelector<HTMLInputElement>('input[type="number"]');
    expect(input).not.toBeNull();
    if (input) {
      input.value = value;
      input.dispatchEvent(new Event('change'));
    }
  }

  function getDistanceValue(): string {
    return getPanel()?.querySelector<HTMLInputElement>('input[type="number"]')?.value ?? '';
  }

  beforeEach(() => {
    createModuleRow('drawingRestrictions');
    installSettingsUi();
    getConfigureButton()?.click();
  });

  // Базовое значение из настроек.
  test('текущее значение показывается в поле', () => {
    uninstallSettingsUi();
    saveDrawingRestrictionsSettings({
      version: 1,
      favProtectionMode: 'off',
      maxDistanceMeters: 750,
    });
    document.body.innerHTML = '';
    createModuleRow('drawingRestrictions');
    installSettingsUi();
    getConfigureButton()?.click();
    expect(getDistanceValue()).toBe('750');
  });

  // 6.B all-pass: целое положительное.
  test('целое положительное значение сохраняется', () => {
    changeDistance('500');
    expect(loadDrawingRestrictionsSettings().maxDistanceMeters).toBe(500);
    expect(getDistanceValue()).toBe('500');
  });

  // 6.B all-pass: дробное округляется Math.floor.
  test('дробное значение округляется Math.floor', () => {
    changeDistance('3.7');
    expect(loadDrawingRestrictionsSettings().maxDistanceMeters).toBe(3);
    expect(getDistanceValue()).toBe('3');
  });

  // 6.B.1 FALSE: Number.isFinite(raw) = false.
  test('пустое поле → 0 (raw=NaN, Number.isFinite=false)', () => {
    changeDistance('');
    expect(loadDrawingRestrictionsSettings().maxDistanceMeters).toBe(0);
    expect(getDistanceValue()).toBe('0');
  });

  // 6.B.2 FALSE: raw <= 0 (но finite).
  test('ввод 0 → 0', () => {
    changeDistance('0');
    expect(loadDrawingRestrictionsSettings().maxDistanceMeters).toBe(0);
    expect(getDistanceValue()).toBe('0');
  });

  test('отрицательное значение → 0', () => {
    changeDistance('-50');
    expect(loadDrawingRestrictionsSettings().maxDistanceMeters).toBe(0);
    expect(getDistanceValue()).toBe('0');
  });
});

describe('MutationObserver — переинжект кнопки', () => {
  test('при удалении кнопки из DOM observer переинжектирует', async () => {
    createModuleRow('drawingRestrictions');
    installSettingsUi();
    expect(getConfigureButton()).not.toBeNull();

    getConfigureButton()?.remove();
    expect(getConfigureButton()).toBeNull();

    // Триггерим мутацию — добавляем dummy element, чтобы observer проснулся.
    document.body.appendChild(document.createElement('div'));
    await flushRaf();

    expect(getConfigureButton()).not.toBeNull();
  });

  // 6.H FALSE: кнопка на месте — reinject не вызывается.
  test('мутация без удаления кнопки — не пересоздаёт', async () => {
    createModuleRow('drawingRestrictions');
    installSettingsUi();
    const first = getConfigureButton();
    expect(first).not.toBeNull();

    document.body.appendChild(document.createElement('div'));
    await flushRaf();

    expect(getConfigureButton()).toBe(first);
  });

  // 6.G TRUE: rafId уже задан → следующая мутация не планирует второй rAF.
  test('массовые мутации за один тик — один rAF', async () => {
    createModuleRow('drawingRestrictions');
    installSettingsUi();
    getConfigureButton()?.remove();

    // Несколько синхронных мутаций.
    for (let i = 0; i < 10; i++) {
      document.body.appendChild(document.createElement('div'));
    }
    await flushRaf();

    const buttons = document.querySelectorAll(`.${CONFIGURE_BUTTON_CLASS}`);
    expect(buttons.length).toBe(1);
  });
});

describe('uninstallSettingsUi', () => {
  test('полный uninstall удаляет кнопку, панель, отключает observer', async () => {
    createModuleRow('drawingRestrictions');
    installSettingsUi();
    getConfigureButton()?.click();
    expect(getPanel()).not.toBeNull();

    uninstallSettingsUi();

    expect(getConfigureButton()).toBeNull();
    expect(getPanel()).toBeNull();

    // После uninstall мутации не должны возрождать кнопку.
    document.body.appendChild(document.createElement('div'));
    await flushRaf();
    expect(getConfigureButton()).toBeNull();
  });

  // 6.I TRUE: rafId !== null → cancelAnimationFrame.
  test('uninstall во время запланированного rAF отменяет переинжект', async () => {
    createModuleRow('drawingRestrictions');
    installSettingsUi();
    getConfigureButton()?.remove();

    // Планируем rAF через мутацию.
    document.body.appendChild(document.createElement('div'));
    // Сразу uninstall, не дожидаясь rAF.
    uninstallSettingsUi();

    await flushRaf();
    expect(getConfigureButton()).toBeNull();
  });

  // 6.J optional chaining: uninstall без открытой панели не падает.
  test('uninstall без панели и кнопки не бросает', () => {
    // Модуль-row отсутствует → install не инжектит кнопку.
    installSettingsUi();
    expect(() => {
      uninstallSettingsUi();
    }).not.toThrow();
  });
});
