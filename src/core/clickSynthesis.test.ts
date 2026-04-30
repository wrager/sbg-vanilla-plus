import { installClickFallback } from './clickSynthesis';

describe('installClickFallback', () => {
  let element: HTMLButtonElement;
  let clickListener: jest.Mock;
  let uninstall: () => void;

  beforeEach(() => {
    jest.useFakeTimers();
    document.body.innerHTML = '<button id="test"></button>';
    element = document.getElementById('test') as HTMLButtonElement;
    clickListener = jest.fn();
    element.addEventListener('click', clickListener);
    uninstall = installClickFallback(element);
  });

  afterEach(() => {
    uninstall();
    jest.useRealTimers();
    document.body.innerHTML = '';
  });

  function dispatchPointer(
    type: string,
    options: { x?: number; y?: number; t?: number; id?: number; pointerType?: string } = {},
  ): void {
    // jsdom не имеет PointerEvent, симулируем через обычный Event с pointer-полями.
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.assign(event, {
      pointerType: options.pointerType ?? 'touch',
      pointerId: options.id ?? 1,
      isPrimary: true,
      clientX: options.x ?? 0,
      clientY: options.y ?? 0,
    });
    if (options.t !== undefined) {
      Object.defineProperty(event, 'timeStamp', { value: options.t });
    }
    element.dispatchEvent(event);
  }

  test('диспатчит click если браузер не синтезировал', () => {
    dispatchPointer('pointerdown', { x: 100, y: 100, t: 1000 });
    dispatchPointer('pointerup', { x: 100, y: 100, t: 1100 });
    expect(clickListener).not.toHaveBeenCalled();

    jest.advanceTimersByTime(80);
    expect(clickListener).toHaveBeenCalledTimes(1);
    const dispatched = (clickListener.mock.calls[0] as [MouseEvent])[0];
    expect(dispatched.type).toBe('click');
    expect(dispatched.clientX).toBe(100);
    expect(dispatched.clientY).toBe(100);
  });

  test('не диспатчит повторно когда браузер выстрелил click сам', () => {
    dispatchPointer('pointerdown', { x: 100, y: 100, t: 1000 });
    dispatchPointer('pointerup', { x: 100, y: 100, t: 1100 });
    // Симулируем нативный синтезированный click
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(clickListener).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(80);
    expect(clickListener).toHaveBeenCalledTimes(1);
  });

  test('пропускает длинный tap (>500мс)', () => {
    dispatchPointer('pointerdown', { x: 100, y: 100, t: 1000 });
    dispatchPointer('pointerup', { x: 100, y: 100, t: 1600 });

    jest.advanceTimersByTime(80);
    expect(clickListener).not.toHaveBeenCalled();
  });

  test('пропускает tap с движением (>10px)', () => {
    dispatchPointer('pointerdown', { x: 100, y: 100, t: 1000 });
    dispatchPointer('pointerup', { x: 120, y: 100, t: 1100 });

    jest.advanceTimersByTime(80);
    expect(clickListener).not.toHaveBeenCalled();
  });

  test('игнорирует не-touch указатели (mouse/pen)', () => {
    dispatchPointer('pointerdown', { x: 100, y: 100, t: 1000, pointerType: 'mouse' });
    dispatchPointer('pointerup', { x: 100, y: 100, t: 1100, pointerType: 'mouse' });

    jest.advanceTimersByTime(80);
    expect(clickListener).not.toHaveBeenCalled();
  });

  test('игнорирует pointerup с другим pointerId', () => {
    dispatchPointer('pointerdown', { x: 100, y: 100, t: 1000, id: 1 });
    dispatchPointer('pointerup', { x: 100, y: 100, t: 1100, id: 2 });

    jest.advanceTimersByTime(80);
    expect(clickListener).not.toHaveBeenCalled();
  });

  test('uninstall снимает listeners', () => {
    uninstall();
    dispatchPointer('pointerdown', { x: 100, y: 100, t: 1000 });
    dispatchPointer('pointerup', { x: 100, y: 100, t: 1100 });

    jest.advanceTimersByTime(80);
    expect(clickListener).not.toHaveBeenCalled();
  });

  test('два разнесённых тапа: первый синтезируется, второй нативный', () => {
    // Тап 1 без нативного click - polyfill должен синтезировать.
    dispatchPointer('pointerdown', { x: 100, y: 100, t: 1000, id: 1 });
    dispatchPointer('pointerup', { x: 100, y: 100, t: 1100, id: 1 });
    jest.advanceTimersByTime(80);
    expect(clickListener).toHaveBeenCalledTimes(1);

    // Тап 2 с нативным click - polyfill не должен дублировать.
    dispatchPointer('pointerdown', { x: 200, y: 200, t: 2000, id: 2 });
    dispatchPointer('pointerup', { x: 200, y: 200, t: 2100, id: 2 });
    element.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 200, clientY: 200 }),
    );
    expect(clickListener).toHaveBeenCalledTimes(2);

    jest.advanceTimersByTime(80);
    expect(clickListener).toHaveBeenCalledTimes(2);
  });

  test('диспатченный click имеет button=0 и bubbles=true', () => {
    dispatchPointer('pointerdown', { x: 50, y: 50, t: 1000 });
    dispatchPointer('pointerup', { x: 50, y: 50, t: 1050 });

    jest.advanceTimersByTime(80);
    expect(clickListener).toHaveBeenCalledTimes(1);
    const event = (clickListener.mock.calls[0] as [MouseEvent])[0];
    expect(event.button).toBe(0);
    expect(event.bubbles).toBe(true);
    expect(event.cancelable).toBe(true);
  });

  test('не диспатчит click на disabled-кнопке', () => {
    // Native browser блокирует click на disabled-button. Polyfill через
    // dispatchEvent обходил этот блок и срабатывал на залоченной #deploy /
    // #discover - двойной запрос к серверу. Проверяем что polyfill повторяет
    // native-поведение.
    element.disabled = true;
    dispatchPointer('pointerdown', { x: 100, y: 100, t: 1000 });
    dispatchPointer('pointerup', { x: 100, y: 100, t: 1100 });

    jest.advanceTimersByTime(80);
    expect(clickListener).not.toHaveBeenCalled();
  });

  test('не диспатчит click если кнопка стала disabled между pointerup и таймером', () => {
    // Синхронный native click handler игры (#deploy onclick) ставит
    // prop('disabled', true) при первом срабатывании. Если native click уже
    // прошёл, но за 80мс к нашему диспатчу кнопка успела перейти в disabled -
    // повторно проверяем перед dispatch и не выпускаем дубль.
    dispatchPointer('pointerdown', { x: 100, y: 100, t: 1000 });
    dispatchPointer('pointerup', { x: 100, y: 100, t: 1100 });
    // Между pointerup и истечением таймера игра залочила кнопку.
    element.disabled = true;
    jest.advanceTimersByTime(80);
    expect(clickListener).not.toHaveBeenCalled();
  });
});
