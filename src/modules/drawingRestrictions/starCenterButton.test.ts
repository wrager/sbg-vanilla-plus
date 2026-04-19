import { installStarCenterButton, uninstallStarCenterButton } from './starCenterButton';
import { clearStarCenter, getStarCenter, getStarCenterGuid, setStarCenter } from './starCenter';

const TOGGLE_CLASS = 'svp-star-center-btn';
const CLEAR_CLASS = 'svp-star-center-clear-btn';

jest.mock('../../core/olMap', () => ({
  getOlMap: jest.fn(() =>
    Promise.resolve({
      getLayers: () => ({ getArray: () => [] }),
    }),
  ),
  findLayerByName: jest.fn(() => null),
}));

jest.mock('../../core/toast', () => ({
  showToast: jest.fn(),
}));

function createPopupDom(guid: string | null, hidden = false): HTMLElement {
  const popup = document.createElement('div');
  popup.className = hidden ? 'info popup hidden' : 'info popup';
  if (guid !== null) popup.dataset.guid = guid;
  const buttons = document.createElement('div');
  buttons.className = 'i-buttons';
  popup.appendChild(buttons);
  document.body.appendChild(popup);
  return popup;
}

function getToggle(popup: HTMLElement): HTMLButtonElement | null {
  return popup.querySelector<HTMLButtonElement>(`.${TOGGLE_CLASS}`);
}

function getClear(popup: HTMLElement): HTMLButtonElement | null {
  return popup.querySelector<HTMLButtonElement>(`.${CLEAR_CLASS}`);
}

async function flushMicrotasks(): Promise<void> {
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
  uninstallStarCenterButton();
  document.body.innerHTML = '';
  localStorage.clear();
});

describe('starCenterButton — базовая инъекция', () => {
  test('toggle появляется в открытом попапе', () => {
    const popup = createPopupDom('p1');
    installStarCenterButton();
    expect(getToggle(popup)).not.toBeNull();
  });

  test('clear не появляется, пока центр не назначен', () => {
    const popup = createPopupDom('p1');
    installStarCenterButton();
    expect(getClear(popup)).toBeNull();
  });

  test('кнопки вставляются в .i-buttons', () => {
    const popup = createPopupDom('p1');
    setStarCenter('other', 'Other');
    installStarCenterButton();
    const buttons = popup.querySelector('.i-buttons');
    expect(buttons?.querySelector(`.${TOGGLE_CLASS}`)).not.toBeNull();
    expect(buttons?.querySelector(`.${CLEAR_CLASS}`)).not.toBeNull();
  });

  test('toggle вставляется слева от .svp-next-point-button', () => {
    const popup = createPopupDom('p1');
    const buttons = popup.querySelector('.i-buttons');
    if (!buttons) throw new Error('.i-buttons not found');
    const nextPoint = document.createElement('button');
    nextPoint.className = 'svp-next-point-button';
    buttons.appendChild(nextPoint);

    installStarCenterButton();
    const toggle = getToggle(popup);
    expect(toggle).not.toBeNull();
    if (!toggle) throw new Error('toggle not found');
    // toggle должен быть раньше next-point в DOM-порядке
    const children = Array.from(buttons.children);
    expect(children.indexOf(toggle)).toBeLessThan(children.indexOf(nextPoint));
  });
});

describe('starCenterButton — видимость и состояние', () => {
  test('центра нет: toggle без is-active, clear нет в DOM', () => {
    const popup = createPopupDom('p1');
    installStarCenterButton();
    expect(getToggle(popup)?.classList.contains('is-active')).toBe(false);
    expect(getClear(popup)).toBeNull();
  });

  test('текущая точка = центр: toggle is-active, clear нет в DOM', () => {
    setStarCenter('p1', 'Альфа');
    const popup = createPopupDom('p1');
    installStarCenterButton();
    expect(getToggle(popup)?.classList.contains('is-active')).toBe(true);
    expect(getToggle(popup)?.getAttribute('aria-pressed')).toBe('true');
    expect(getClear(popup)).toBeNull();
  });

  test('центр есть на другой точке: toggle без is-active, clear в DOM', () => {
    setStarCenter('other', 'Другая');
    const popup = createPopupDom('p1');
    installStarCenterButton();
    expect(getToggle(popup)?.classList.contains('is-active')).toBe(false);
    expect(getClear(popup)).not.toBeNull();
  });
});

describe('starCenterButton — клики toggle', () => {
  test('центра нет → назначает текущую точку центром', async () => {
    const popup = createPopupDom('p1');
    installStarCenterButton();
    getToggle(popup)?.click();
    await flushMicrotasks();
    expect(getStarCenterGuid()).toBe('p1');
    expect(getToggle(popup)?.classList.contains('is-active')).toBe(true);
  });

  test('это центр → снимает центр', async () => {
    setStarCenter('p1', 'Альфа');
    const popup = createPopupDom('p1');
    installStarCenterButton();
    getToggle(popup)?.click();
    await flushMicrotasks();
    expect(getStarCenter()).toBeNull();
    expect(getToggle(popup)?.classList.contains('is-active')).toBe(false);
  });

  test('центр на другой точке → переназначает на текущую', async () => {
    setStarCenter('other', 'Другая');
    const popup = createPopupDom('p1');
    installStarCenterButton();
    getToggle(popup)?.click();
    await flushMicrotasks();
    expect(getStarCenterGuid()).toBe('p1');
    expect(getToggle(popup)?.classList.contains('is-active')).toBe(true);
  });
});

describe('starCenterButton — клик clear', () => {
  test('сбрасывает центр, не назначая текущую, удаляет clear из DOM', () => {
    setStarCenter('other', 'Другая');
    const popup = createPopupDom('p1');
    installStarCenterButton();
    const clear = getClear(popup);
    expect(clear).not.toBeNull();
    clear?.click();
    expect(getStarCenter()).toBeNull();
    expect(getClear(popup)).toBeNull();
    expect(getToggle(popup)?.classList.contains('is-active')).toBe(false);
  });
});

describe('starCenterButton — реактивность', () => {
  test('смена data-guid пересчитывает состояние', async () => {
    setStarCenter('p1', 'Альфа');
    const popup = createPopupDom('p2');
    installStarCenterButton();
    expect(getToggle(popup)?.classList.contains('is-active')).toBe(false);
    expect(getClear(popup)).not.toBeNull();

    popup.dataset.guid = 'p1';
    await flushMicrotasks();
    expect(getToggle(popup)?.classList.contains('is-active')).toBe(true);
    expect(getClear(popup)).toBeNull();
  });

  test('внешний setStarCenter обновляет кнопки', async () => {
    const popup = createPopupDom('p1');
    installStarCenterButton();
    expect(getClear(popup)).toBeNull();

    setStarCenter('other', 'Другая');
    await flushMicrotasks();
    expect(getClear(popup)).not.toBeNull();
  });

  test('uninstall удаляет обе кнопки и отключает observer', async () => {
    setStarCenter('other', 'Другая');
    const popup = createPopupDom('p1');
    installStarCenterButton();
    uninstallStarCenterButton();
    expect(getToggle(popup)).toBeNull();
    expect(getClear(popup)).toBeNull();

    popup.dataset.guid = 'p2';
    await flushMicrotasks();
    expect(getToggle(popup)).toBeNull();
  });
});
