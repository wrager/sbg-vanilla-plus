import { registerOlControl, resetOlControlStackForTest } from './olControlStack';

const STACK_ITEM_CLASS = 'svp-ol-stack-item';
const STACK_INDEX_PROPERTY = '--svp-ol-stack-index';

function createPicker(): HTMLElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const picker = document.createElement('div');
  picker.className = 'region-picker ol-unselectable ol-control';
  document.body.appendChild(picker);
  return picker;
}

function createControl(): HTMLDivElement {
  const div = document.createElement('div');
  return div;
}

async function flushRaf(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
  }
  await new Promise<void>((resolve) => setTimeout(resolve, 16));
}

beforeEach(() => {
  document.body.innerHTML = '';
});

afterEach(() => {
  resetOlControlStackForTest();
  document.body.innerHTML = '';
});

describe('olControlStack', () => {
  test('register помещает элемент после picker и выставляет index=1', async () => {
    const picker = createPicker();
    const control = createControl();
    registerOlControl(0, control);
    await flushRaf();

    expect(picker.nextElementSibling).toBe(control);
    expect(control.classList.contains(STACK_ITEM_CLASS)).toBe(true);
    expect(control.style.getPropertyValue(STACK_INDEX_PROPERTY)).toBe('1');
  });

  test('два элемента сортируются по возрастанию priority', async () => {
    const picker = createPicker();
    const a = createControl();
    const b = createControl();
    // Регистрируем в обратном порядке - проверяем что сортировка по priority, не по времени регистрации.
    registerOlControl(1, b);
    registerOlControl(0, a);
    await flushRaf();

    expect(picker.nextElementSibling).toBe(a);
    expect(a.nextElementSibling).toBe(b);
    expect(a.style.getPropertyValue(STACK_INDEX_PROPERTY)).toBe('1');
    expect(b.style.getPropertyValue(STACK_INDEX_PROPERTY)).toBe('2');
  });

  test('register до появления picker - элемент вставится при появлении', async () => {
    const control = createControl();
    registerOlControl(0, control);
    await flushRaf();

    expect(document.body.contains(control)).toBe(false);

    const picker = createPicker();
    await flushRaf();

    expect(picker.nextElementSibling).toBe(control);
  });

  test('пересоздание picker - элементы переезжают к новому picker', async () => {
    const firstPicker = createPicker();
    const a = createControl();
    const b = createControl();
    registerOlControl(0, a);
    registerOlControl(1, b);
    await flushRaf();
    expect(firstPicker.nextElementSibling).toBe(a);

    firstPicker.remove();
    const newPicker = document.createElement('div');
    newPicker.className = 'region-picker ol-unselectable ol-control';
    document.body.appendChild(newPicker);
    await flushRaf();

    expect(newPicker.nextElementSibling).toBe(a);
    expect(a.nextElementSibling).toBe(b);
  });

  test('unregister убирает элемент из DOM и снимает класс/property', async () => {
    createPicker();
    const control = createControl();
    const unregister = registerOlControl(0, control);
    await flushRaf();
    expect(control.isConnected).toBe(true);

    unregister();
    await flushRaf();

    expect(control.isConnected).toBe(false);
    expect(control.classList.contains(STACK_ITEM_CLASS)).toBe(false);
    expect(control.style.getPropertyValue(STACK_INDEX_PROPERTY)).toBe('');
  });

  test('unregister одного из двух элементов перенумеровывает оставшийся', async () => {
    const picker = createPicker();
    const a = createControl();
    const b = createControl();
    const unregisterA = registerOlControl(0, a);
    registerOlControl(1, b);
    await flushRaf();
    expect(b.style.getPropertyValue(STACK_INDEX_PROPERTY)).toBe('2');

    unregisterA();
    await flushRaf();

    expect(picker.nextElementSibling).toBe(b);
    expect(b.style.getPropertyValue(STACK_INDEX_PROPERTY)).toBe('1');
  });

  test('arrange после установки не делает повторных DOM-перемещений (нет infinite loop через MutationObserver)', async () => {
    const picker = createPicker();
    const control = createControl();
    registerOlControl(0, control);
    await flushRaf();

    // Спай на insertBefore body. Первичная вставка уже произошла - её не
    // считаем. Будем смотреть, появятся ли новые вызовы после посторонней
    // мутации body.
    const insertBeforeSpy = jest.spyOn(document.body, 'insertBefore');

    // Чужая мутация body - дёргает наш MutationObserver, schedule rAF, arrange.
    document.body.appendChild(document.createElement('div'));
    await flushRaf();
    await flushRaf();

    // arrange не должен переставлять control - его позиция уже корректна
    // (sibling после picker). Любой повторный insertBefore с нашим control'ом
    // в роли node означает loop.
    const controlMoves = insertBeforeSpy.mock.calls.filter((call) => call[0] === control).length;
    expect(controlMoves).toBe(0);
    // Picker не двигался - sanity check.
    expect(picker.nextElementSibling).toBe(control);
    insertBeforeSpy.mockRestore();
  });

  test('CSS-инжект появляется в head при первой регистрации и убирается после последнего unregister', async () => {
    createPicker();
    const control = createControl();
    const unregister = registerOlControl(0, control);
    await flushRaf();
    expect(document.getElementById('svp-olControlStack')).not.toBeNull();

    unregister();
    expect(document.getElementById('svp-olControlStack')).toBeNull();
  });
});
