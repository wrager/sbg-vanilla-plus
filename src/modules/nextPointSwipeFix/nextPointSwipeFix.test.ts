import { nextPointSwipeFix } from './nextPointSwipeFix';

describe('nextPointSwipeFix metadata', () => {
  test('has correct id', () => {
    expect(nextPointSwipeFix.id).toBe('nextPointSwipeFix');
  });

  test('is in fix category', () => {
    expect(nextPointSwipeFix.category).toBe('fix');
  });

  test('is enabled by default', () => {
    expect(nextPointSwipeFix.defaultEnabled).toBe(true);
  });

  test('has localized name and description', () => {
    expect(nextPointSwipeFix.name.ru).toBeTruthy();
    expect(nextPointSwipeFix.name.en).toBeTruthy();
    expect(nextPointSwipeFix.description.ru).toBeTruthy();
    expect(nextPointSwipeFix.description.en).toBeTruthy();
  });
});

describe('nextPointSwipeFix enable/disable', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    document.body.innerHTML = `
      <div class="info popup">
        <div class="i-stat">
          <div class="i-buttons">
            <button id="draw"><span id="draw-count">[0]</span></button>
            <button id="discover">Изучить</button>
            <button id="repair">Починить</button>
            <button id="i-navigate">Навигация</button>
          </div>
          <button id="deploy">Проставить</button>
        </div>
      </div>
    `;
  });

  afterEach(async () => {
    await nextPointSwipeFix.disable();
    jest.useRealTimers();
    document.body.innerHTML = '';
  });

  function dispatchPointer(
    target: HTMLElement,
    type: string,
    options: { x?: number; y?: number; t?: number; id?: number } = {},
  ): void {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.assign(event, {
      pointerType: 'touch',
      pointerId: options.id ?? 1,
      isPrimary: true,
      clientX: options.x ?? 0,
      clientY: options.y ?? 0,
    });
    if (options.t !== undefined) {
      Object.defineProperty(event, 'timeStamp', { value: options.t });
    }
    target.dispatchEvent(event);
  }

  function expectClickPolyfill(buttonSelector: string): void {
    const button = document.querySelector<HTMLElement>(buttonSelector);
    if (!button) throw new Error(`${buttonSelector} not found`);
    const click = jest.fn();
    button.addEventListener('click', click);
    dispatchPointer(button, 'pointerdown', { x: 100, y: 100, t: 1000 });
    dispatchPointer(button, 'pointerup', { x: 100, y: 100, t: 1100 });
    expect(click).not.toHaveBeenCalled();
    jest.advanceTimersByTime(80);
    expect(click).toHaveBeenCalledTimes(1);
  }

  test('enable устанавливает fallback на все кнопки попапа', async () => {
    await nextPointSwipeFix.enable();
    expectClickPolyfill('#draw');
    expectClickPolyfill('#discover');
    expectClickPolyfill('#repair');
    expectClickPolyfill('#i-navigate');
    expectClickPolyfill('#deploy');
  });

  test('observer ставит fallback на динамически добавленные кнопки', async () => {
    await nextPointSwipeFix.enable();

    // showInfo пересоздаёт cores list - симулируем добавление новой кнопки.
    const popup = document.querySelector('.info.popup');
    if (!popup) throw new Error('popup not found');
    const newButton = document.createElement('button');
    newButton.id = 'dynamic-button';
    newButton.textContent = 'Dynamic';
    popup.appendChild(newButton);

    // MutationObserver runs синхронно после микрозадачи в jsdom.
    await Promise.resolve();
    expectClickPolyfill('#dynamic-button');
  });

  test('observer ставит fallback на кнопку внутри добавленного контейнера', async () => {
    await nextPointSwipeFix.enable();

    const popup = document.querySelector('.info.popup');
    if (!popup) throw new Error('popup not found');
    const wrapper = document.createElement('div');
    wrapper.innerHTML = '<button id="nested-button">Nested</button>';
    popup.appendChild(wrapper);

    await Promise.resolve();
    expectClickPolyfill('#nested-button');
  });

  test('disable снимает fallback - polyfill больше не диспатчит', async () => {
    await nextPointSwipeFix.enable();
    await nextPointSwipeFix.disable();

    const draw = document.querySelector<HTMLElement>('#draw');
    if (!draw) throw new Error('#draw not found');
    const click = jest.fn();
    draw.addEventListener('click', click);
    dispatchPointer(draw, 'pointerdown', { x: 100, y: 100, t: 1000 });
    dispatchPointer(draw, 'pointerup', { x: 100, y: 100, t: 1100 });
    jest.advanceTimersByTime(80);
    expect(click).not.toHaveBeenCalled();
  });

  test('disable отключает observer - новые кнопки не получают fallback', async () => {
    await nextPointSwipeFix.enable();
    await nextPointSwipeFix.disable();

    const popup = document.querySelector('.info.popup');
    if (!popup) throw new Error('popup not found');
    const newButton = document.createElement('button');
    newButton.id = 'after-disable';
    popup.appendChild(newButton);

    await Promise.resolve();
    const click = jest.fn();
    newButton.addEventListener('click', click);
    dispatchPointer(newButton, 'pointerdown', { x: 100, y: 100, t: 1000 });
    dispatchPointer(newButton, 'pointerup', { x: 100, y: 100, t: 1100 });
    jest.advanceTimersByTime(80);
    expect(click).not.toHaveBeenCalled();
  });

  test('повторный enable идемпотентен (не дублирует fallback)', async () => {
    await nextPointSwipeFix.enable();
    await nextPointSwipeFix.enable();

    const draw = document.querySelector<HTMLElement>('#draw');
    if (!draw) throw new Error('#draw not found');
    const click = jest.fn();
    draw.addEventListener('click', click);
    dispatchPointer(draw, 'pointerdown', { x: 100, y: 100, t: 1000 });
    dispatchPointer(draw, 'pointerup', { x: 100, y: 100, t: 1100 });
    jest.advanceTimersByTime(80);
    // Click диспатчится один раз, не дважды.
    expect(click).toHaveBeenCalledTimes(1);
  });

  test('после нативного click polyfill не дублирует', async () => {
    await nextPointSwipeFix.enable();

    const draw = document.querySelector<HTMLElement>('#draw');
    if (!draw) throw new Error('#draw not found');
    const click = jest.fn();
    draw.addEventListener('click', click);
    dispatchPointer(draw, 'pointerdown', { x: 100, y: 100, t: 1000 });
    dispatchPointer(draw, 'pointerup', { x: 100, y: 100, t: 1100 });
    draw.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(click).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(80);
    expect(click).toHaveBeenCalledTimes(1);
  });
});
