import { installStarCenterButton, uninstallStarCenterButton } from './starCenterButton';
import { clearStarCenter, getStarCenter, getStarCenterGuid, setStarCenter } from './starCenter';

const TOGGLE_CLASS = 'svp-star-center-btn';

jest.mock('../../core/olMap', () => ({
  getOlMap: jest.fn(() =>
    Promise.resolve({
      getLayers: () => ({ getArray: () => [] }),
    }),
  ),
  findLayerByName: jest.fn(() => null),
}));

const showToastMock = jest.fn();
jest.mock('../../core/toast', () => ({
  showToast: (...args: unknown[]) => {
    showToastMock(...args);
  },
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

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
  }
}

beforeEach(() => {
  localStorage.clear();
  clearStarCenter();
  localStorage.clear();
  showToastMock.mockClear();
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

  test('кнопка вставляется в .i-buttons', () => {
    const popup = createPopupDom('p1');
    installStarCenterButton();
    const buttons = popup.querySelector('.i-buttons');
    expect(buttons?.querySelector(`.${TOGGLE_CLASS}`)).not.toBeNull();
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
    const children = Array.from(buttons.children);
    expect(children.indexOf(toggle)).toBeLessThan(children.indexOf(nextPoint));
  });
});

describe('starCenterButton — состояние', () => {
  test('центра нет: toggle без is-active', () => {
    const popup = createPopupDom('p1');
    installStarCenterButton();
    expect(getToggle(popup)?.classList.contains('is-active')).toBe(false);
  });

  test('текущая точка = центр: toggle is-active', () => {
    setStarCenter('p1', 'Альфа');
    const popup = createPopupDom('p1');
    installStarCenterButton();
    expect(getToggle(popup)?.classList.contains('is-active')).toBe(true);
    expect(getToggle(popup)?.getAttribute('aria-pressed')).toBe('true');
  });

  test('центр есть на другой точке: toggle без is-active', () => {
    setStarCenter('other', 'Другая');
    const popup = createPopupDom('p1');
    installStarCenterButton();
    expect(getToggle(popup)?.classList.contains('is-active')).toBe(false);
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

  test('назначение показывает toast с формулировкой CUI', async () => {
    const popup = createPopupDom('p1');
    installStarCenterButton();
    getToggle(popup)?.click();
    await flushMicrotasks();
    expect(showToastMock).toHaveBeenCalled();
    const messages = showToastMock.mock.calls.map((call: unknown[]) => {
      const [first] = call;
      return typeof first === 'string' ? first : '';
    });
    expect(
      messages.some((message) => message.includes('selected as star center for drawing')),
    ).toBe(true);
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

describe('starCenterButton — реактивность', () => {
  test('смена data-guid пересчитывает состояние', async () => {
    setStarCenter('p1', 'Альфа');
    const popup = createPopupDom('p2');
    installStarCenterButton();
    expect(getToggle(popup)?.classList.contains('is-active')).toBe(false);

    popup.dataset.guid = 'p1';
    await flushMicrotasks();
    expect(getToggle(popup)?.classList.contains('is-active')).toBe(true);
  });

  test('uninstall удаляет кнопку и отключает observer', async () => {
    const popup = createPopupDom('p1');
    installStarCenterButton();
    uninstallStarCenterButton();
    expect(getToggle(popup)).toBeNull();

    popup.dataset.guid = 'p2';
    await flushMicrotasks();
    expect(getToggle(popup)).toBeNull();
  });
});
