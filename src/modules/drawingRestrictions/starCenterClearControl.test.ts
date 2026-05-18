import {
  installStarCenterClearControl,
  uninstallStarCenterClearControl,
} from './starCenterClearControl';
import { clearStarCenter, getStarCenter, setStarCenter } from './starCenter';
import { resetOlControlStackForTest } from '../../core/olControlStack';

jest.mock('../../core/toast', () => ({
  showToast: jest.fn(),
}));

const CONTROL_CLASS = 'svp-star-center-clear-control';
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
});

afterEach(() => {
  uninstallStarCenterClearControl();
  resetOlControlStackForTest();
  document.body.innerHTML = '';
  localStorage.clear();
});

describe('starCenterClearControl', () => {
  test('вставляется сразу после .region-picker через olControlStack', async () => {
    createMapWithRegionPicker();
    installStarCenterClearControl();
    await flushRaf();
    const control = getControl();
    expect(control).not.toBeNull();
    const picker = document.querySelector('.region-picker');
    expect(picker?.nextElementSibling).toBe(control);
    // Helper приклеил общий класс стека и custom property с index.
    expect(control?.classList.contains(STACK_ITEM_CLASS)).toBe(true);
  });

  test('скрыт (hidden=true) когда центр не назначен', () => {
    createMapWithRegionPicker();
    installStarCenterClearControl();
    expect(getControl()?.hidden).toBe(true);
  });

  test('виден (hidden=false) когда центр назначен', () => {
    createMapWithRegionPicker();
    setStarCenter('p1');
    installStarCenterClearControl();
    expect(getControl()?.hidden).toBe(false);
  });

  test('реагирует на изменение центра без переустановки', () => {
    createMapWithRegionPicker();
    installStarCenterClearControl();
    expect(getControl()?.hidden).toBe(true);

    setStarCenter('p1');
    expect(getControl()?.hidden).toBe(false);

    clearStarCenter();
    expect(getControl()?.hidden).toBe(true);
  });

  test('клик сбрасывает центр', () => {
    createMapWithRegionPicker();
    setStarCenter('p1');
    installStarCenterClearControl();
    const button = getControl()?.querySelector<HTMLButtonElement>('button');
    button?.click();
    expect(getStarCenter()).toBeNull();
  });

  test('не добавляет класс .region-picker (чтобы игра не словила click-handler)', () => {
    createMapWithRegionPicker();
    installStarCenterClearControl();
    const control = getControl();
    expect(control?.classList.contains('region-picker')).toBe(false);
    expect(control?.classList.contains('ol-control')).toBe(true);
    expect(control?.classList.contains('ol-unselectable')).toBe(true);
  });

  test('install до появления .region-picker - встаёт когда picker появляется', async () => {
    installStarCenterClearControl();
    // Picker нет - control не в DOM (registry helper'а удерживает ссылку).
    expect(getControl()).toBeNull();

    createMapWithRegionPicker();
    await flushRaf();

    const picker = document.querySelector('.region-picker');
    expect(picker?.nextElementSibling).toBe(getControl());
  });

  test('uninstall убирает control и отключает event listener', async () => {
    createMapWithRegionPicker();
    installStarCenterClearControl();
    await flushRaf();
    expect(getControl()).not.toBeNull();

    uninstallStarCenterClearControl();
    expect(getControl()).toBeNull();

    // Изменение центра больше не должно влиять (control удалён).
    setStarCenter('p1');
    await flushRaf();
    expect(getControl()).toBeNull();
  });

  test('повторный install без uninstall - no-op', () => {
    createMapWithRegionPicker();
    installStarCenterClearControl();
    const first = getControl();
    installStarCenterClearControl();
    expect(getControl()).toBe(first);
    expect(document.querySelectorAll(`.${CONTROL_CLASS}`).length).toBe(1);
  });
});

describe('starCenterClearControl - onClick без назначенного центра', () => {
  test('клик без центра - просто clearStarCenter, toast не показывается', () => {
    createMapWithRegionPicker();
    installStarCenterClearControl();
    const button = getControl()?.querySelector<HTMLButtonElement>('button');
    expect(() => {
      button?.click();
    }).not.toThrow();
    expect(getStarCenter()).toBeNull();
  });
});

describe('starCenterClearControl - refresh попапа при сбросе центра', () => {
  const showInfoMock = jest.fn();

  beforeEach(() => {
    showInfoMock.mockClear();
    (window as unknown as { showInfo: typeof showInfoMock }).showInfo = showInfoMock;
  });

  afterEach(() => {
    delete (window as unknown as { showInfo?: typeof showInfoMock }).showInfo;
  });

  function createPopupWithClose(guid: string): HTMLElement {
    const popup = document.createElement('div');
    popup.className = 'info popup';
    popup.dataset.guid = guid;
    const closeButton = document.createElement('button');
    closeButton.className = 'popup-close';
    popup.appendChild(closeButton);
    document.body.appendChild(popup);
    return popup;
  }

  test('попап точки B открыт + центр на A - клик map-control закрывает и переоткрывает B', () => {
    createMapWithRegionPicker();
    setStarCenter('A');
    const popup = createPopupWithClose('B');
    const closeSpy = jest.fn();
    popup.querySelector('.popup-close')?.addEventListener('click', closeSpy);

    installStarCenterClearControl();
    const button = getControl()?.querySelector<HTMLButtonElement>('button');
    button?.click();

    expect(getStarCenter()).toBeNull();
    expect(closeSpy).toHaveBeenCalledTimes(1);
    expect(showInfoMock).toHaveBeenCalledWith('B');
  });

  test('попап бывшего центра открыт - клик map-control НЕ переоткрывает попап', () => {
    createMapWithRegionPicker();
    setStarCenter('A');
    const popup = createPopupWithClose('A');
    const closeSpy = jest.fn();
    popup.querySelector('.popup-close')?.addEventListener('click', closeSpy);

    installStarCenterClearControl();
    const button = getControl()?.querySelector<HTMLButtonElement>('button');
    button?.click();

    expect(getStarCenter()).toBeNull();
    expect(closeSpy).not.toHaveBeenCalled();
    expect(showInfoMock).not.toHaveBeenCalled();
  });

  test('попап не открыт - клик map-control НЕ переоткрывает', () => {
    createMapWithRegionPicker();
    setStarCenter('A');

    installStarCenterClearControl();
    const button = getControl()?.querySelector<HTMLButtonElement>('button');
    button?.click();

    expect(getStarCenter()).toBeNull();
    expect(showInfoMock).not.toHaveBeenCalled();
  });

  test('центр не назначен - клик map-control НЕ переоткрывает (no-op refresh)', () => {
    createMapWithRegionPicker();
    createPopupWithClose('B');

    installStarCenterClearControl();
    const button = getControl()?.querySelector<HTMLButtonElement>('button');
    button?.click();

    expect(showInfoMock).not.toHaveBeenCalled();
  });
});

describe('starCenterClearControl - устойчивость uninstall', () => {
  test('uninstall без install не бросает', () => {
    expect(() => {
      uninstallStarCenterClearControl();
    }).not.toThrow();
  });

  test('uninstall после install без picker - не бросает', () => {
    installStarCenterClearControl();
    expect(() => {
      uninstallStarCenterClearControl();
    }).not.toThrow();
  });

  test('double uninstall - не бросает', () => {
    createMapWithRegionPicker();
    installStarCenterClearControl();
    uninstallStarCenterClearControl();
    expect(() => {
      uninstallStarCenterClearControl();
    }).not.toThrow();
  });
});
