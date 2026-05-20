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

  test('не вставляет кнопку в module-row другого модуля', () => {
    createModuleRow('favoritedPoints');
    installSettingsUi();
    expect(getConfigureButton()).toBeNull();
  });

  test('без .svp-module-row вокруг module-id — не вставляет кнопку', () => {
    const idElement = document.createElement('span');
    idElement.className = 'svp-module-id';
    idElement.textContent = 'drawingRestrictions';
    document.body.appendChild(idElement);
    installSettingsUi();
    expect(getConfigureButton()).toBeNull();
  });

  test('повторный install не создаёт вторую кнопку', () => {
    createModuleRow('drawingRestrictions');
    installSettingsUi();
    uninstallSettingsUi();
    installSettingsUi();
    installSettingsUi();
    const buttons = document.querySelectorAll(`.${CONFIGURE_BUTTON_CLASS}`);
    expect(buttons.length).toBe(1);
  });

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

  test('текущее значение показывается в поле', () => {
    uninstallSettingsUi();
    saveDrawingRestrictionsSettings({ version: 1, maxDistanceMeters: 750 });
    document.body.innerHTML = '';
    createModuleRow('drawingRestrictions');
    installSettingsUi();
    getConfigureButton()?.click();
    expect(getDistanceValue()).toBe('750');
  });

  test('целое положительное значение сохраняется', () => {
    changeDistance('500');
    expect(loadDrawingRestrictionsSettings().maxDistanceMeters).toBe(500);
    expect(getDistanceValue()).toBe('500');
  });

  test('дробное значение округляется Math.floor', () => {
    changeDistance('3.7');
    expect(loadDrawingRestrictionsSettings().maxDistanceMeters).toBe(3);
    expect(getDistanceValue()).toBe('3');
  });

  test('пустое поле → 0 (raw=NaN, Number.isFinite=false)', () => {
    changeDistance('');
    expect(loadDrawingRestrictionsSettings().maxDistanceMeters).toBe(0);
    expect(getDistanceValue()).toBe('0');
  });

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

    document.body.appendChild(document.createElement('div'));
    await flushRaf();

    expect(getConfigureButton()).not.toBeNull();
  });

  test('мутация без удаления кнопки — не пересоздаёт', async () => {
    createModuleRow('drawingRestrictions');
    installSettingsUi();
    const first = getConfigureButton();
    expect(first).not.toBeNull();

    document.body.appendChild(document.createElement('div'));
    await flushRaf();

    expect(getConfigureButton()).toBe(first);
  });

  test('массовые мутации за один тик — один rAF', async () => {
    createModuleRow('drawingRestrictions');
    installSettingsUi();
    getConfigureButton()?.remove();

    for (let i = 0; i < 10; i++) {
      document.body.appendChild(document.createElement('div'));
    }
    await flushRaf();

    const buttons = document.querySelectorAll(`.${CONFIGURE_BUTTON_CLASS}`);
    expect(buttons.length).toBe(1);
  });
});

describe('settingsUi — refresh открытого попапа при изменении правил', () => {
  function createPopup(guid: string): HTMLElement {
    const popup = document.createElement('div');
    popup.className = 'info popup';
    popup.dataset.guid = guid;
    const closeButton = document.createElement('button');
    closeButton.className = 'popup-close';
    popup.appendChild(closeButton);
    document.body.appendChild(popup);
    return popup;
  }

  const showInfoMock = jest.fn();

  beforeEach(() => {
    showInfoMock.mockClear();
    (window as unknown as { showInfo: typeof showInfoMock }).showInfo = showInfoMock;
  });

  afterEach(() => {
    delete (window as unknown as { showInfo?: typeof showInfoMock }).showInfo;
  });

  test('смена maxDistanceMeters при открытом попапе - попап переоткрывается', () => {
    const popup = createPopup('B');
    const closeSpy = jest.fn();
    popup.querySelector('.popup-close')?.addEventListener('click', closeSpy);

    createModuleRow('drawingRestrictions');
    installSettingsUi();
    getConfigureButton()?.click();

    const input = getPanel()?.querySelector<HTMLInputElement>('input[type="number"]');
    if (input) {
      input.value = '500';
      input.dispatchEvent(new Event('change'));
    }

    expect(closeSpy).toHaveBeenCalledTimes(1);
    expect(showInfoMock).toHaveBeenCalledWith('B');
  });

  test('смена правил без открытого попапа - showInfo не вызывается', () => {
    createModuleRow('drawingRestrictions');
    installSettingsUi();
    getConfigureButton()?.click();
    const input = getPanel()?.querySelector<HTMLInputElement>('input[type="number"]');
    if (input) {
      input.value = '500';
      input.dispatchEvent(new Event('change'));
    }
    expect(showInfoMock).not.toHaveBeenCalled();
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

    document.body.appendChild(document.createElement('div'));
    await flushRaf();
    expect(getConfigureButton()).toBeNull();
  });

  test('uninstall во время запланированного rAF отменяет переинжект', async () => {
    createModuleRow('drawingRestrictions');
    installSettingsUi();
    getConfigureButton()?.remove();

    document.body.appendChild(document.createElement('div'));
    uninstallSettingsUi();

    await flushRaf();
    expect(getConfigureButton()).toBeNull();
  });

  test('uninstall без панели и кнопки не бросает', () => {
    installSettingsUi();
    expect(() => {
      uninstallSettingsUi();
    }).not.toThrow();
  });
});
