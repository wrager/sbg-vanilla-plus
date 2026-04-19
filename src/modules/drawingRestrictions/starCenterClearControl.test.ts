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
