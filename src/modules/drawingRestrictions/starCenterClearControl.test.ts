import {
  installStarCenterClearControl,
  uninstallStarCenterClearControl,
} from './starCenterClearControl';
import { clearStarCenter, getStarCenter, setStarCenter } from './starCenter';

jest.mock('../../core/toast', () => ({
  showToast: jest.fn(),
}));

const CONTROL_CLASS = 'svp-star-center-clear-control';

function createMapWithRegionPicker(): HTMLDivElement {
  const container = document.createElement('div');
  container.className = 'ol-viewport';
  const picker = document.createElement('div');
  picker.className = 'region-picker ol-unselectable ol-control';
  const pickerButton = document.createElement('button');
  pickerButton.type = 'button';
  pickerButton.textContent = 'Δ';
  picker.appendChild(pickerButton);
  container.appendChild(picker);
  document.body.appendChild(container);
  return container;
}

function getControl(): HTMLElement | null {
  return document.querySelector<HTMLElement>(`.${CONTROL_CLASS}`);
}

async function flushMutations(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
  }
}

beforeEach(() => {
  localStorage.clear();
  clearStarCenter();
  localStorage.clear();
});

afterEach(() => {
  uninstallStarCenterClearControl();
  document.body.innerHTML = '';
  localStorage.clear();
});

describe('starCenterClearControl', () => {
  test('вставляется сразу после .region-picker', () => {
    const container = createMapWithRegionPicker();
    installStarCenterClearControl();
    const control = getControl();
    expect(control).not.toBeNull();
    const picker = container.querySelector('.region-picker');
    expect(picker?.nextElementSibling).toBe(control);
  });

  test('скрыт (hidden=true) когда центр не назначен', () => {
    createMapWithRegionPicker();
    installStarCenterClearControl();
    expect(getControl()?.hidden).toBe(true);
  });

  test('виден (hidden=false) когда центр назначен', () => {
    createMapWithRegionPicker();
    setStarCenter('p1', 'Альфа');
    installStarCenterClearControl();
    expect(getControl()?.hidden).toBe(false);
  });

  test('реагирует на изменение центра без переустановки', () => {
    createMapWithRegionPicker();
    installStarCenterClearControl();
    expect(getControl()?.hidden).toBe(true);

    setStarCenter('p1', 'Альфа');
    expect(getControl()?.hidden).toBe(false);

    clearStarCenter();
    expect(getControl()?.hidden).toBe(true);
  });

  test('клик сбрасывает центр', () => {
    createMapWithRegionPicker();
    setStarCenter('p1', 'Альфа');
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

  test('install до появления .region-picker — ждёт через observer', async () => {
    installStarCenterClearControl();
    expect(getControl()).toBeNull();

    createMapWithRegionPicker();
    await flushMutations();
    expect(getControl()).not.toBeNull();
  });

  test('uninstall удаляет control и отключает observer', async () => {
    createMapWithRegionPicker();
    installStarCenterClearControl();
    expect(getControl()).not.toBeNull();

    uninstallStarCenterClearControl();
    expect(getControl()).toBeNull();

    setStarCenter('p1', 'Альфа');
    await flushMutations();
    expect(getControl()).toBeNull();
  });
});

describe('starCenterClearControl — syncPosition и rect.width/height', () => {
  function mockRect(element: HTMLElement, rect: Partial<DOMRect>): void {
    element.getBoundingClientRect = (): DOMRect => {
      return {
        x: rect.x ?? 0,
        y: rect.y ?? 0,
        top: rect.top ?? 0,
        bottom: rect.bottom ?? 0,
        left: rect.left ?? 0,
        right: rect.right ?? 0,
        width: rect.width ?? 0,
        height: rect.height ?? 0,
        toJSON() {
          return this;
        },
      };
    };
  }

  // 8.B TRUE (обе width=0 и height=0): skip — style не обновляется.
  test('picker скрыт (width=0 && height=0) — style control не обновляется', () => {
    const container = createMapWithRegionPicker();
    const picker = container.querySelector<HTMLElement>('.region-picker');
    if (!picker) throw new Error('picker not found');
    mockRect(picker, { width: 0, height: 0 });

    setStarCenter('p1', '');
    installStarCenterClearControl();
    const control = getControl();
    expect(control).not.toBeNull();
    // Поскольку picker "скрыт", applyVisibility вызывает syncPosition, но он
    // выходит раньше, чем присвоит top/right.
    expect(control?.style.top).toBe('');
    expect(control?.style.right).toBe('');
  });

  // 8.B FALSE (width!=0 && height=0): обновляем.
  test('picker видим (height=0 но width!=0) — style обновляется', () => {
    const container = createMapWithRegionPicker();
    const picker = container.querySelector<HTMLElement>('.region-picker');
    if (!picker) throw new Error('picker not found');
    mockRect(picker, { width: 40, height: 0, bottom: 100, right: 200 });

    setStarCenter('p1', '');
    installStarCenterClearControl();
    expect(getControl()?.style.top).toBe('100px');
  });

  // 8.B all-pass: обычный рендер.
  test('полный rect — top и right обновляются относительно viewport', () => {
    const container = createMapWithRegionPicker();
    const picker = container.querySelector<HTMLElement>('.region-picker');
    if (!picker) throw new Error('picker not found');
    mockRect(picker, { width: 40, height: 40, bottom: 150, right: 300 });
    window.innerWidth = 1000;

    setStarCenter('p1', '');
    installStarCenterClearControl();
    expect(getControl()?.style.top).toBe('150px');
    // 1000 - 300 = 700.
    expect(getControl()?.style.right).toBe('700px');
  });
});

describe('starCenterClearControl — onClick без назначенного центра', () => {
  test('клик без центра — просто clearStarCenter (idempotent), toast не показывается', () => {
    createMapWithRegionPicker();
    installStarCenterClearControl();
    // Центра нет (hidden=true). Программный клик по скрытой кнопке работает.
    const button = getControl()?.querySelector<HTMLButtonElement>('button');
    expect(() => {
      button?.click();
    }).not.toThrow();
    expect(getStarCenter()).toBeNull();
  });
});

describe('starCenterClearControl — refresh попапа при сбросе центра', () => {
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
    setStarCenter('A', 'Alpha');
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
    setStarCenter('A', 'Alpha');
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
    setStarCenter('A', 'Alpha');

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

describe('starCenterClearControl — window resize', () => {
  test('window.resize переспозиционирует control', () => {
    const container = createMapWithRegionPicker();
    const picker = container.querySelector<HTMLElement>('.region-picker');
    if (!picker) throw new Error('picker not found');
    picker.getBoundingClientRect = (): DOMRect => {
      return {
        x: 0,
        y: 0,
        top: 10,
        bottom: 50,
        left: 0,
        right: 40,
        width: 40,
        height: 40,
        toJSON() {
          return this;
        },
      };
    };
    window.innerWidth = 500;
    setStarCenter('p1', '');
    installStarCenterClearControl();
    const control = getControl();
    expect(control?.style.top).toBe('50px');
    expect(control?.style.right).toBe('460px');

    // Меняем bounding rect и триггерим resize.
    picker.getBoundingClientRect = (): DOMRect => {
      return {
        x: 0,
        y: 0,
        top: 20,
        bottom: 80,
        left: 0,
        right: 40,
        width: 40,
        height: 60,
        toJSON() {
          return this;
        },
      };
    };
    window.innerWidth = 600;
    window.dispatchEvent(new Event('resize'));

    expect(control?.style.top).toBe('80px');
    expect(control?.style.right).toBe('560px');
  });
});

describe('starCenterClearControl — ResizeObserver', () => {
  interface IMockResizeObserver {
    observe: jest.Mock;
    disconnect: jest.Mock;
    trigger: () => void;
  }

  let lastObserver: IMockResizeObserver | null = null;

  beforeEach(() => {
    lastObserver = null;
    const ResizeObserverMock = jest.fn((callback: () => void) => {
      const observer: IMockResizeObserver = {
        observe: jest.fn(),
        disconnect: jest.fn(),
        trigger: () => {
          callback();
        },
      };
      lastObserver = observer;
      return observer;
    });
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverMock;
  });

  afterEach(() => {
    delete (globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver;
  });

  // 8.H all-pass: ResizeObserver доступен → создаётся, observ'ит picker.
  test('когда ResizeObserver доступен — создаётся и .observe(picker) вызывается', () => {
    const container = createMapWithRegionPicker();
    installStarCenterClearControl();
    expect(lastObserver).not.toBeNull();
    const picker = container.querySelector('.region-picker');
    expect(lastObserver?.observe).toHaveBeenCalledWith(picker);
  });

  // 8.M: trigger → syncPosition.
  test('ResizeObserver callback вызывает syncPosition', () => {
    const container = createMapWithRegionPicker();
    const picker = container.querySelector<HTMLElement>('.region-picker');
    if (!picker) throw new Error('picker not found');
    picker.getBoundingClientRect = (): DOMRect => {
      return {
        x: 0,
        y: 0,
        top: 0,
        bottom: 30,
        left: 0,
        right: 30,
        width: 30,
        height: 30,
        toJSON() {
          return this;
        },
      };
    };
    window.innerWidth = 1000;
    setStarCenter('p1', '');
    installStarCenterClearControl();
    const control = getControl();
    expect(control?.style.top).toBe('30px');

    // Сменили размер picker'а.
    picker.getBoundingClientRect = (): DOMRect => {
      return {
        x: 0,
        y: 0,
        top: 0,
        bottom: 60,
        left: 0,
        right: 30,
        width: 30,
        height: 60,
        toJSON() {
          return this;
        },
      };
    };
    lastObserver?.trigger();
    expect(control?.style.top).toBe('60px');
  });

  // 8.N.2: disconnect при uninstall.
  test('uninstall вызывает disconnect у ResizeObserver', () => {
    createMapWithRegionPicker();
    installStarCenterClearControl();
    const disconnectSpy = lastObserver?.disconnect;
    uninstallStarCenterClearControl();
    expect(disconnectSpy).toHaveBeenCalled();
  });
});

describe('starCenterClearControl — ResizeObserver недоступен', () => {
  // 8.H.1 FALSE: typeof ResizeObserver === 'undefined' → не создаётся.
  test('ResizeObserver undefined — control всё равно работает, observer не создаётся', () => {
    // В дефолте jsdom ResizeObserver отсутствует.
    expect(typeof ResizeObserver).toBe('undefined');
    createMapWithRegionPicker();
    installStarCenterClearControl();
    expect(getControl()).not.toBeNull();
    // uninstall не падает (resizeObserver?.disconnect() = no-op).
    expect(() => {
      uninstallStarCenterClearControl();
    }).not.toThrow();
  });
});

describe('starCenterClearControl — реакция MutationObserver', () => {
  // 8.J.2 TRUE: control удалён из DOM → reattach.
  test('при удалении control из DOM MutationObserver reattach', async () => {
    createMapWithRegionPicker();
    installStarCenterClearControl();
    const firstControl = getControl();
    expect(firstControl).not.toBeNull();

    firstControl?.remove();
    expect(getControl()).toBeNull();

    // Триггерим мутацию.
    document.body.appendChild(document.createElement('div'));
    await flushMutations();

    expect(getControl()).not.toBeNull();
  });

  // 8.J обе FALSE: control на месте → syncPosition (не reattach).
  test('мутация без удаления control — не пересоздаёт', async () => {
    createMapWithRegionPicker();
    installStarCenterClearControl();
    const firstControl = getControl();

    document.body.appendChild(document.createElement('div'));
    await flushMutations();

    expect(getControl()).toBe(firstControl);
  });

  // 8.E TRUE: повторный tryAttach при уже подключённом control — return true без изменений.
  test('повторный install без uninstall — no-op', () => {
    createMapWithRegionPicker();
    installStarCenterClearControl();
    const firstControl = getControl();

    installStarCenterClearControl();
    expect(getControl()).toBe(firstControl);
  });
});

describe('starCenterClearControl — устойчивость uninstall', () => {
  // 8.N optional-chains: uninstall без install не падает.
  test('uninstall без install не бросает', () => {
    expect(() => {
      uninstallStarCenterClearControl();
    }).not.toThrow();
  });

  // uninstall после install без .region-picker в DOM — все ?. = noop.
  test('uninstall после install без picker — не бросает', () => {
    installStarCenterClearControl();
    expect(() => {
      uninstallStarCenterClearControl();
    }).not.toThrow();
  });

  test('double uninstall — не бросает', () => {
    createMapWithRegionPicker();
    installStarCenterClearControl();
    uninstallStarCenterClearControl();
    expect(() => {
      uninstallStarCenterClearControl();
    }).not.toThrow();
  });
});
