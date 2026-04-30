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
  let drawClickListener: jest.Mock;
  let discoverClickListener: jest.Mock;

  beforeEach(() => {
    jest.useFakeTimers();
    document.body.innerHTML = `
      <div class="info popup">
        <div class="i-buttons">
          <button id="draw"><span id="draw-count">[0]</span></button>
          <button id="discover">Изучить</button>
        </div>
      </div>
    `;
    drawClickListener = jest.fn();
    discoverClickListener = jest.fn();
    document.querySelector('#draw')?.addEventListener('click', drawClickListener);
    document.querySelector('#discover')?.addEventListener('click', discoverClickListener);
  });

  afterEach(() => {
    void nextPointSwipeFix.disable();
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

  test('enable устанавливает fallback на #draw и #discover', () => {
    void nextPointSwipeFix.enable();

    const draw = document.querySelector<HTMLElement>('#draw');
    if (!draw) throw new Error('#draw not found');
    dispatchPointer(draw, 'pointerdown', { x: 100, y: 100, t: 1000 });
    dispatchPointer(draw, 'pointerup', { x: 100, y: 100, t: 1100 });
    expect(drawClickListener).not.toHaveBeenCalled();
    jest.advanceTimersByTime(80);
    expect(drawClickListener).toHaveBeenCalledTimes(1);

    const discover = document.querySelector<HTMLElement>('#discover');
    if (!discover) throw new Error('#discover not found');
    dispatchPointer(discover, 'pointerdown', { x: 200, y: 200, t: 2000 });
    dispatchPointer(discover, 'pointerup', { x: 200, y: 200, t: 2100 });
    jest.advanceTimersByTime(80);
    expect(discoverClickListener).toHaveBeenCalledTimes(1);
  });

  test('enable пропускает отсутствующие элементы без ошибок', () => {
    document.querySelector('#discover')?.remove();
    expect(() => nextPointSwipeFix.enable()).not.toThrow();

    const draw = document.querySelector<HTMLElement>('#draw');
    if (!draw) throw new Error('#draw not found');
    dispatchPointer(draw, 'pointerdown', { x: 100, y: 100, t: 1000 });
    dispatchPointer(draw, 'pointerup', { x: 100, y: 100, t: 1100 });
    jest.advanceTimersByTime(80);
    expect(drawClickListener).toHaveBeenCalledTimes(1);
  });

  test('disable снимает fallback - polyfill больше не диспатчит', () => {
    void nextPointSwipeFix.enable();
    void nextPointSwipeFix.disable();

    const draw = document.querySelector<HTMLElement>('#draw');
    if (!draw) throw new Error('#draw not found');
    dispatchPointer(draw, 'pointerdown', { x: 100, y: 100, t: 1000 });
    dispatchPointer(draw, 'pointerup', { x: 100, y: 100, t: 1100 });
    jest.advanceTimersByTime(80);
    expect(drawClickListener).not.toHaveBeenCalled();
  });

  test('повторный enable идемпотентен (не дублирует fallback)', () => {
    void nextPointSwipeFix.enable();
    void nextPointSwipeFix.enable();

    const draw = document.querySelector<HTMLElement>('#draw');
    if (!draw) throw new Error('#draw not found');
    dispatchPointer(draw, 'pointerdown', { x: 100, y: 100, t: 1000 });
    dispatchPointer(draw, 'pointerup', { x: 100, y: 100, t: 1100 });
    jest.advanceTimersByTime(80);
    // Click диспатчится один раз, не дважды.
    expect(drawClickListener).toHaveBeenCalledTimes(1);
  });

  test('после нативного click polyfill не дублирует', () => {
    void nextPointSwipeFix.enable();

    const draw = document.querySelector<HTMLElement>('#draw');
    if (!draw) throw new Error('#draw not found');
    dispatchPointer(draw, 'pointerdown', { x: 100, y: 100, t: 1000 });
    dispatchPointer(draw, 'pointerup', { x: 100, y: 100, t: 1100 });
    draw.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(drawClickListener).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(80);
    expect(drawClickListener).toHaveBeenCalledTimes(1);
  });
});
