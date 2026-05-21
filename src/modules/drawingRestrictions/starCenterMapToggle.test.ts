import {
  installStarCenterMapToggle,
  uninstallStarCenterMapToggle,
} from './starCenterMapToggle';
import {
  clearStarCenter,
  getStarCenter,
  setStarCenter,
  setStarCenterActive,
} from './starCenter';
import { resetOlControlStackForTest } from '../../core/olControlStack';

const showToastMock = jest.fn();
jest.mock('../../core/toast', () => ({
  showToast: (...args: unknown[]) => {
    showToastMock(...args);
  },
}));

const getPointTitleByGuidMock = jest.fn<string | null, [string]>();
jest.mock('./pointTitle', () => ({
  getPointTitleByGuid: (guid: string): string | null => getPointTitleByGuidMock(guid),
}));

function toastMessages(): string[] {
  return showToastMock.mock.calls.map((call: unknown[]) => {
    const [first] = call;
    return typeof first === 'string' ? first : '';
  });
}

const CONTROL_CLASS = 'svp-star-center-map-toggle';
const STACK_ITEM_CLASS = 'svp-ol-stack-item';

function createMapWithRegionPicker(): HTMLDivElement {
  const container = document.createElement('div');
  container.className = 'ol-viewport';
  const picker = document.createElement('div');
  picker.className = 'region-picker ol-unselectable ol-control';
  const pickerButton = document.createElement('button');
  pickerButton.type = 'button';
  pickerButton.textContent = 'Δ';
  picker.appendChild(pickerButton);
  document.body.appendChild(picker);
  container.appendChild(document.createElement('div'));
  document.body.appendChild(container);
  return container;
}

function getControl(): HTMLElement | null {
  return document.querySelector<HTMLElement>(`.${CONTROL_CLASS}`);
}

function getButton(): HTMLButtonElement | null {
  return getControl()?.querySelector<HTMLButtonElement>('button') ?? null;
}

async function flushRaf(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
  }
  await new Promise<void>((resolve) => setTimeout(resolve, 16));
}

beforeEach(() => {
  localStorage.clear();
  clearStarCenter();
  localStorage.clear();
  showToastMock.mockClear();
  getPointTitleByGuidMock.mockReset();
  getPointTitleByGuidMock.mockReturnValue(null);
});

afterEach(() => {
  uninstallStarCenterMapToggle();
  resetOlControlStackForTest();
  document.body.innerHTML = '';
  localStorage.clear();
});

describe('starCenterMapToggle — установка в OL-stack', () => {
  test('вставляется сразу после .region-picker через olControlStack', async () => {
    createMapWithRegionPicker();
    installStarCenterMapToggle();
    await flushRaf();
    const control = getControl();
    expect(control).not.toBeNull();
    const picker = document.querySelector('.region-picker');
    expect(picker?.nextElementSibling).toBe(control);
    expect(control?.classList.contains(STACK_ITEM_CLASS)).toBe(true);
  });

  test('не добавляет класс .region-picker (чтобы игра не словила click-handler)', () => {
    createMapWithRegionPicker();
    installStarCenterMapToggle();
    const control = getControl();
    expect(control?.classList.contains('region-picker')).toBe(false);
    expect(control?.classList.contains('ol-control')).toBe(true);
    expect(control?.classList.contains('ol-unselectable')).toBe(true);
  });

  test('install до появления .region-picker - встаёт когда picker появляется', async () => {
    installStarCenterMapToggle();
    expect(getControl()).toBeNull();

    createMapWithRegionPicker();
    await flushRaf();

    const picker = document.querySelector('.region-picker');
    expect(picker?.nextElementSibling).toBe(getControl());
  });

  test('повторный install без uninstall - no-op', () => {
    createMapWithRegionPicker();
    installStarCenterMapToggle();
    const first = getControl();
    installStarCenterMapToggle();
    expect(getControl()).toBe(first);
    expect(document.querySelectorAll(`.${CONTROL_CLASS}`).length).toBe(1);
  });
});

describe('starCenterMapToggle — visibility (hidden iff guid отсутствует)', () => {
  test('скрыт (hidden=true) когда центр не назначен', () => {
    createMapWithRegionPicker();
    installStarCenterMapToggle();
    expect(getControl()?.hidden).toBe(true);
  });

  test('виден (hidden=false) когда центр назначен и активен', () => {
    createMapWithRegionPicker();
    setStarCenter('p1');
    installStarCenterMapToggle();
    expect(getControl()?.hidden).toBe(false);
  });

  test('виден когда guid сохранён, но режим выключен (toggle off)', () => {
    createMapWithRegionPicker();
    setStarCenter('p1');
    setStarCenterActive(false);
    installStarCenterMapToggle();
    expect(getControl()?.hidden).toBe(false);
  });

  test('после первого назначения остаётся виден между toggle off/on', () => {
    createMapWithRegionPicker();
    installStarCenterMapToggle();
    expect(getControl()?.hidden).toBe(true);

    setStarCenter('p1');
    expect(getControl()?.hidden).toBe(false);

    setStarCenterActive(false);
    expect(getControl()?.hidden).toBe(false); // guid сохраняется

    setStarCenterActive(true);
    expect(getControl()?.hidden).toBe(false);
  });

  test('после clearStarCenter (install-time legacy auto-clear) - снова скрыт', () => {
    createMapWithRegionPicker();
    setStarCenter('p1');
    installStarCenterMapToggle();
    expect(getControl()?.hidden).toBe(false);

    clearStarCenter();
    expect(getControl()?.hidden).toBe(true);
  });
});

describe('starCenterMapToggle — is-active отражает active flag', () => {
  test('активный центр: button.is-active, aria-pressed=true', () => {
    createMapWithRegionPicker();
    setStarCenter('p1');
    installStarCenterMapToggle();
    expect(getButton()?.classList.contains('is-active')).toBe(true);
    expect(getButton()?.getAttribute('aria-pressed')).toBe('true');
  });

  test('выключенный центр: button без is-active, aria-pressed=false', () => {
    createMapWithRegionPicker();
    setStarCenter('p1');
    setStarCenterActive(false);
    installStarCenterMapToggle();
    expect(getButton()?.classList.contains('is-active')).toBe(false);
    expect(getButton()?.getAttribute('aria-pressed')).toBe('false');
  });

  test('реакция на внешнее изменение active без переустановки', () => {
    createMapWithRegionPicker();
    setStarCenter('p1');
    installStarCenterMapToggle();
    expect(getButton()?.classList.contains('is-active')).toBe(true);

    setStarCenterActive(false);
    expect(getButton()?.classList.contains('is-active')).toBe(false);

    setStarCenterActive(true);
    expect(getButton()?.classList.contains('is-active')).toBe(true);
  });
});

describe('starCenterMapToggle — клик toggle', () => {
  test('клик при active=true → active=false, guid сохраняется', () => {
    createMapWithRegionPicker();
    setStarCenter('p1');
    installStarCenterMapToggle();
    getButton()?.click();
    expect(getStarCenter()).toEqual({ guid: 'p1', active: false });
    expect(getButton()?.classList.contains('is-active')).toBe(false);
  });

  test('клик при active=false → active=true, тот же guid', () => {
    createMapWithRegionPicker();
    setStarCenter('p1');
    setStarCenterActive(false);
    installStarCenterMapToggle();
    getButton()?.click();
    expect(getStarCenter()).toEqual({ guid: 'p1', active: true });
    expect(getButton()?.classList.contains('is-active')).toBe(true);
  });

  test('последовательность кликов чередует active', () => {
    createMapWithRegionPicker();
    setStarCenter('p1');
    installStarCenterMapToggle();
    getButton()?.click();
    expect(getStarCenter()?.active).toBe(false);
    getButton()?.click();
    expect(getStarCenter()?.active).toBe(true);
    getButton()?.click();
    expect(getStarCenter()?.active).toBe(false);
  });
});

describe('starCenterMapToggle — refresh попапа при изменении фильтрации', () => {
  const showInfoMock = jest.fn();

  beforeEach(() => {
    showInfoMock.mockClear();
    (window as unknown as { showInfo: typeof showInfoMock }).showInfo = showInfoMock;
  });

  afterEach(() => {
    delete (window as unknown as { showInfo?: typeof showInfoMock }).showInfo;
  });

  function createPopupWithClose(guid: string, hidden = false): HTMLElement {
    const popup = document.createElement('div');
    popup.className = hidden ? 'info popup hidden' : 'info popup';
    popup.dataset.guid = guid;
    const closeButton = document.createElement('button');
    closeButton.className = 'popup-close';
    popup.appendChild(closeButton);
    document.body.appendChild(popup);
    return popup;
  }

  test('toggle off при открытом попапе B и центре на A → переоткрытие через showInfo(B)', () => {
    createMapWithRegionPicker();
    setStarCenter('A');
    const popup = createPopupWithClose('B');
    const closeSpy = jest.fn();
    popup.querySelector('.popup-close')?.addEventListener('click', closeSpy);

    installStarCenterMapToggle();
    getButton()?.click();

    expect(getStarCenter()).toEqual({ guid: 'A', active: false });
    expect(closeSpy).toHaveBeenCalledTimes(1);
    expect(showInfoMock).toHaveBeenCalledWith('B');
  });

  test('toggle on при открытом попапе B и сохранённом неактивном центре A → переоткрытие', () => {
    createMapWithRegionPicker();
    setStarCenter('A');
    setStarCenterActive(false);
    const popup = createPopupWithClose('B');
    const closeSpy = jest.fn();
    popup.querySelector('.popup-close')?.addEventListener('click', closeSpy);

    installStarCenterMapToggle();
    getButton()?.click();

    expect(getStarCenter()).toEqual({ guid: 'A', active: true });
    expect(closeSpy).toHaveBeenCalledTimes(1);
    expect(showInfoMock).toHaveBeenCalledWith('B');
  });

  test('toggle при открытом попапе самого центра - НЕ переоткрывает (фильтр для центра не применяется)', () => {
    createMapWithRegionPicker();
    setStarCenter('A');
    const popup = createPopupWithClose('A');
    const closeSpy = jest.fn();
    popup.querySelector('.popup-close')?.addEventListener('click', closeSpy);

    installStarCenterMapToggle();
    getButton()?.click();

    expect(getStarCenter()).toEqual({ guid: 'A', active: false });
    expect(closeSpy).not.toHaveBeenCalled();
    expect(showInfoMock).not.toHaveBeenCalled();
  });

  test('попап не открыт - клик map-toggle НЕ переоткрывает', () => {
    createMapWithRegionPicker();
    setStarCenter('A');

    installStarCenterMapToggle();
    getButton()?.click();

    expect(showInfoMock).not.toHaveBeenCalled();
  });
});

describe('starCenterMapToggle — имя точки в тосте', () => {
  test('toggle off с известным именем: "Star mode disabled: <name>"', () => {
    getPointTitleByGuidMock.mockReturnValue('Alpha');
    createMapWithRegionPicker();
    setStarCenter('p1');
    installStarCenterMapToggle();
    getButton()?.click();
    expect(toastMessages().some((m) => m === 'Star mode disabled: Alpha')).toBe(true);
  });

  test('toggle on с известным именем: "Star mode enabled: <name>"', () => {
    getPointTitleByGuidMock.mockReturnValue('Alpha');
    createMapWithRegionPicker();
    setStarCenter('p1');
    setStarCenterActive(false);
    installStarCenterMapToggle();
    getButton()?.click();
    expect(toastMessages().some((m) => m === 'Star mode enabled: Alpha')).toBe(true);
  });

  test('toggle без известного имени - общий текст (fallback на pointTitle=null)', () => {
    getPointTitleByGuidMock.mockReturnValue(null);
    createMapWithRegionPicker();
    setStarCenter('p1');
    installStarCenterMapToggle();
    getButton()?.click();
    expect(toastMessages().some((m) => m === 'Star mode disabled')).toBe(true);
  });

  test('getPointTitleByGuid вызывается с актуальным guid центра', () => {
    createMapWithRegionPicker();
    setStarCenter('p1');
    installStarCenterMapToggle();
    getButton()?.click();
    expect(getPointTitleByGuidMock).toHaveBeenCalledWith('p1');
  });
});

describe('starCenterMapToggle — uninstall', () => {
  test('uninstall убирает control и отключает event listener', async () => {
    createMapWithRegionPicker();
    setStarCenter('p1');
    installStarCenterMapToggle();
    await flushRaf();
    expect(getControl()).not.toBeNull();

    uninstallStarCenterMapToggle();
    expect(getControl()).toBeNull();

    setStarCenter('p2');
    await flushRaf();
    expect(getControl()).toBeNull();
  });

  test('uninstall без install не бросает', () => {
    expect(() => {
      uninstallStarCenterMapToggle();
    }).not.toThrow();
  });

  test('uninstall после install без picker - не бросает', () => {
    installStarCenterMapToggle();
    expect(() => {
      uninstallStarCenterMapToggle();
    }).not.toThrow();
  });

  test('double uninstall - не бросает', () => {
    createMapWithRegionPicker();
    installStarCenterMapToggle();
    uninstallStarCenterMapToggle();
    expect(() => {
      uninstallStarCenterMapToggle();
    }).not.toThrow();
  });
});
