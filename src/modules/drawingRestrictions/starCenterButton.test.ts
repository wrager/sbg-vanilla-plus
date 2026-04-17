import { installStarCenterButton, uninstallStarCenterButton } from './starCenterButton';
import { clearStarCenter, getStarCenterGuid, setStarCenterGuid } from './starCenter';

const TOGGLE_CLASS = 'svp-star-center-btn';
const CLEAR_CLASS = 'svp-star-center-clear-btn';

function createPopupDom(guid: string | null, hidden = false): HTMLElement {
  const popup = document.createElement('div');
  popup.className = hidden ? 'info popup hidden' : 'info popup';
  if (guid !== null) popup.dataset.guid = guid;
  const imageBox = document.createElement('div');
  imageBox.className = 'i-image-box';
  popup.appendChild(imageBox);
  document.body.appendChild(popup);
  return popup;
}

function getToggle(popup: HTMLElement): HTMLButtonElement | null {
  return popup.querySelector<HTMLButtonElement>(`.${TOGGLE_CLASS}`);
}

function getClear(popup: HTMLElement): HTMLButtonElement | null {
  return popup.querySelector<HTMLButtonElement>(`.${CLEAR_CLASS}`);
}

async function flushMutations(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
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
  test('обе кнопки появляются в открытом попапе', () => {
    const popup = createPopupDom('p1');
    installStarCenterButton();
    expect(getToggle(popup)).not.toBeNull();
    expect(getClear(popup)).not.toBeNull();
  });

  test('не плодит дубли при повторной инъекции', () => {
    const popup = createPopupDom('p1');
    installStarCenterButton();
    installStarCenterButton();
    popup.dataset.guid = 'p2';
    expect(popup.querySelectorAll(`.${TOGGLE_CLASS}`)).toHaveLength(1);
    expect(popup.querySelectorAll(`.${CLEAR_CLASS}`)).toHaveLength(1);
  });
});

describe('starCenterButton — видимость и состояние', () => {
  test('центра нет: toggle обычный, clear скрыта', () => {
    const popup = createPopupDom('p1');
    installStarCenterButton();
    const toggle = getToggle(popup);
    const clear = getClear(popup);
    expect(toggle?.classList.contains('is-active')).toBe(false);
    expect(clear?.hidden).toBe(true);
  });

  test('текущая точка = центр: toggle активна, clear скрыта', () => {
    setStarCenterGuid('p1');
    const popup = createPopupDom('p1');
    installStarCenterButton();
    const toggle = getToggle(popup);
    const clear = getClear(popup);
    expect(toggle?.classList.contains('is-active')).toBe(true);
    expect(toggle?.getAttribute('aria-pressed')).toBe('true');
    expect(clear?.hidden).toBe(true);
  });

  test('центр есть на другой точке: toggle обычный, clear видима', () => {
    setStarCenterGuid('other');
    const popup = createPopupDom('p1');
    installStarCenterButton();
    const toggle = getToggle(popup);
    const clear = getClear(popup);
    expect(toggle?.classList.contains('is-active')).toBe(false);
    expect(clear?.hidden).toBe(false);
  });

  test('popup hidden: обе кнопки disabled, clear скрыта', () => {
    const popup = createPopupDom('p1', true);
    installStarCenterButton();
    const toggle = getToggle(popup);
    const clear = getClear(popup);
    expect(toggle?.disabled).toBe(true);
    expect(clear?.hidden).toBe(true);
  });
});

describe('starCenterButton — клики', () => {
  test('клик toggle (центра нет) назначает текущую точку центром', () => {
    const popup = createPopupDom('p1');
    installStarCenterButton();
    getToggle(popup)?.click();
    expect(getStarCenterGuid()).toBe('p1');
    expect(getToggle(popup)?.classList.contains('is-active')).toBe(true);
  });

  test('клик toggle (это центр) снимает центр', () => {
    setStarCenterGuid('p1');
    const popup = createPopupDom('p1');
    installStarCenterButton();
    getToggle(popup)?.click();
    expect(getStarCenterGuid()).toBeNull();
    expect(getToggle(popup)?.classList.contains('is-active')).toBe(false);
  });

  test('клик toggle (центр на другой точке) переназначает на текущую', () => {
    setStarCenterGuid('other');
    const popup = createPopupDom('p1');
    installStarCenterButton();
    getToggle(popup)?.click();
    expect(getStarCenterGuid()).toBe('p1');
    expect(getToggle(popup)?.classList.contains('is-active')).toBe(true);
  });

  test('клик clear сбрасывает центр и текущая не становится центром', () => {
    setStarCenterGuid('other');
    const popup = createPopupDom('p1');
    installStarCenterButton();
    getClear(popup)?.click();
    expect(getStarCenterGuid()).toBeNull();
    expect(getClear(popup)?.hidden).toBe(true);
    expect(getToggle(popup)?.classList.contains('is-active')).toBe(false);
  });
});

describe('starCenterButton — реактивность', () => {
  test('смена data-guid попапа пересчитывает состояние', async () => {
    setStarCenterGuid('p1');
    const popup = createPopupDom('p2');
    installStarCenterButton();
    expect(getToggle(popup)?.classList.contains('is-active')).toBe(false);

    popup.dataset.guid = 'p1';
    await flushMutations();
    expect(getToggle(popup)?.classList.contains('is-active')).toBe(true);
  });

  test('внешний svp:star-center-changed обновляет кнопки', () => {
    const popup = createPopupDom('p1');
    installStarCenterButton();
    expect(getClear(popup)?.hidden).toBe(true);

    // Назначаем центр на другую точку из "внешнего" кода.
    setStarCenterGuid('other');
    expect(getClear(popup)?.hidden).toBe(false);
  });

  test('uninstall удаляет обе кнопки и отключает observer', async () => {
    const popup = createPopupDom('p1');
    installStarCenterButton();
    uninstallStarCenterButton();
    expect(getToggle(popup)).toBeNull();
    expect(getClear(popup)).toBeNull();

    popup.dataset.guid = 'p2';
    await flushMutations();
    expect(getToggle(popup)).toBeNull();
  });
});
