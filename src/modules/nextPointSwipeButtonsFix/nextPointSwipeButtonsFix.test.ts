import { nextPointSwipeButtonsFix } from './nextPointSwipeButtonsFix';

describe('nextPointSwipeButtonsFix metadata', () => {
  test('has correct id', () => {
    expect(nextPointSwipeButtonsFix.id).toBe('nextPointSwipeButtonsFix');
  });

  test('is in fix category', () => {
    expect(nextPointSwipeButtonsFix.category).toBe('fix');
  });

  test('is enabled by default', () => {
    expect(nextPointSwipeButtonsFix.defaultEnabled).toBe(true);
  });

  test('has localized name and description', () => {
    expect(nextPointSwipeButtonsFix.name.ru).toBeTruthy();
    expect(nextPointSwipeButtonsFix.name.en).toBeTruthy();
    expect(nextPointSwipeButtonsFix.description.ru).toBeTruthy();
    expect(nextPointSwipeButtonsFix.description.en).toBeTruthy();
  });
});

describe('nextPointSwipeButtonsFix enable/disable', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    // Структура попапа по refs/game/dom/body.html (SBG 0.7.0): #i-navigate живёт
    // в ряду иконок .i-stat__tools, в меню инструментов на его месте стоит
    // #i-report, кнопки discover и deploy лежат внутри .i-buttons в обёртках
    // .i-multi-button, а кнопки действий игра отдаёт disabled и снимает флаг,
    // когда действие становится доступным.
    document.body.innerHTML = `
      <div class="info popup">
        <ul class="info-tools popover hidden">
          <li class="info-tools__item"><button id="i-share">Поделиться</button></li>
          <li class="info-tools__item"><button id="i-copy-pos">Копир. коорд.</button></li>
          <li class="info-tools__item"><button id="i-report">Пожаловаться</button></li>
        </ul>
        <div class="i-stat">
          <div class="i-stat__tools">
            <button class="icon-button i-flag-btn" data-flag="favorite"></button>
            <button class="icon-button i-flag-btn" data-flag="locked"></button>
            <button class="icon-button" id="i-navigate"></button>
            <button class="icon-button" id="i-tools"></button>
          </div>
          <div class="i-stat__entry"><span>Владелец</span>: <span id="i-stat__owner">n/a</span></div>
          <div class="deploy-slider-wrp">
            <div class="splide" id="deploy-slider">
              <div class="splide__arrows splide__arrows--ltr">
                <button class="splide__arrow splide__arrow--prev" disabled>&lt;</button>
                <button class="splide__arrow splide__arrow--next">&gt;</button>
              </div>
            </div>
          </div>
          <div class="i-buttons">
            <div class="discover i-multi-button">
              <button class="discover-mod" data-wish="2" disabled></button>
              <button id="discover" disabled><span>Изучить</span></button>
              <button class="discover-mod" data-wish="3" disabled></button>
            </div>
            <div class="deploy i-multi-button" data-magic="NaN">
              <button id="deploy" data-state="deploy" disabled>Проставить</button>
            </div>
            <button id="repair" disabled>Починить</button>
            <button id="draw" disabled><span id="draw-count">[0]</span></button>
          </div>
        </div>
        <button class="popup-close">[x]</button>
      </div>
    `;
  });

  afterEach(async () => {
    await nextPointSwipeButtonsFix.disable();
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
    expectClickPolyfillOn(button);
  }

  function expectClickPolyfillOn(button: HTMLElement): void {
    const click = jest.fn();
    button.addEventListener('click', click);
    dispatchPointer(button, 'pointerdown', { x: 100, y: 100, t: 1000 });
    dispatchPointer(button, 'pointerup', { x: 100, y: 100, t: 1100 });
    expect(click).not.toHaveBeenCalled();
    jest.advanceTimersByTime(80);
    expect(click).toHaveBeenCalledTimes(1);
  }

  // Контракт модуля: fallback стоит на каждой button попапа. Ветвления по id у
  // модуля нет, поэтому перечисление конкретных кнопок не добавляло бы путей
  // исполнения и устаревало бы с каждой новой кнопкой игры.
  test('enable ставит fallback на каждую button попапа', async () => {
    await nextPointSwipeButtonsFix.enable();

    const buttons = document.querySelectorAll<HTMLButtonElement>('.info.popup button');
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) {
      // Игра снимает disabled, когда действие становится доступным; на кнопке,
      // залоченной в момент enable, fallback обязан отработать после этого.
      button.disabled = false;
      expectClickPolyfillOn(button);
    }
  });

  test('на залоченной игрой кнопке polyfill click не диспатчит', async () => {
    await nextPointSwipeButtonsFix.enable();

    const discover = document.querySelector<HTMLButtonElement>('#discover');
    if (!discover) throw new Error('#discover not found');
    expect(discover.disabled).toBe(true);

    const click = jest.fn();
    discover.addEventListener('click', click);
    dispatchPointer(discover, 'pointerdown', { x: 100, y: 100, t: 1000 });
    dispatchPointer(discover, 'pointerup', { x: 100, y: 100, t: 1100 });
    jest.advanceTimersByTime(80);

    expect(click).not.toHaveBeenCalled();
  });

  test('observer ставит fallback на динамически добавленные кнопки', async () => {
    await nextPointSwipeButtonsFix.enable();

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
    await nextPointSwipeButtonsFix.enable();

    const popup = document.querySelector('.info.popup');
    if (!popup) throw new Error('popup not found');
    const wrapper = document.createElement('div');
    wrapper.innerHTML = '<button id="nested-button">Nested</button>';
    popup.appendChild(wrapper);

    await Promise.resolve();
    expectClickPolyfill('#nested-button');
  });

  test('disable снимает fallback - polyfill больше не диспатчит', async () => {
    await nextPointSwipeButtonsFix.enable();
    await nextPointSwipeButtonsFix.disable();

    const draw = document.querySelector<HTMLButtonElement>('#draw');
    if (!draw) throw new Error('#draw not found');
    // Игра включает кнопку, когда действие доступно.
    draw.disabled = false;
    const click = jest.fn();
    draw.addEventListener('click', click);
    dispatchPointer(draw, 'pointerdown', { x: 100, y: 100, t: 1000 });
    dispatchPointer(draw, 'pointerup', { x: 100, y: 100, t: 1100 });
    jest.advanceTimersByTime(80);
    expect(click).not.toHaveBeenCalled();
  });

  test('observer снимает fallback и освобождает Map при удалении кнопки', async () => {
    await nextPointSwipeButtonsFix.enable();

    const popup = document.querySelector('.info.popup');
    if (!popup) throw new Error('popup not found');
    const newButton = document.createElement('button');
    newButton.id = 'temp-button';
    popup.appendChild(newButton);
    await Promise.resolve();

    // Кнопка зарегистрирована - polyfill активен.
    const click = jest.fn();
    newButton.addEventListener('click', click);
    dispatchPointer(newButton, 'pointerdown', { x: 10, y: 10, t: 1000 });
    dispatchPointer(newButton, 'pointerup', { x: 10, y: 10, t: 1050 });
    jest.advanceTimersByTime(80);
    expect(click).toHaveBeenCalledTimes(1);
    click.mockClear();

    // Удаляем кнопку - observer должен снять fallback.
    popup.removeChild(newButton);
    await Promise.resolve();

    // После снятия polyfill не должен диспатчить click.
    dispatchPointer(newButton, 'pointerdown', { x: 10, y: 10, t: 2000 });
    dispatchPointer(newButton, 'pointerup', { x: 10, y: 10, t: 2050 });
    jest.advanceTimersByTime(80);
    expect(click).not.toHaveBeenCalled();
  });

  test('observer снимает fallback на кнопки внутри удалённого контейнера', async () => {
    await nextPointSwipeButtonsFix.enable();

    const popup = document.querySelector('.info.popup');
    if (!popup) throw new Error('popup not found');
    const wrapper = document.createElement('div');
    const innerButton = document.createElement('button');
    innerButton.id = 'inner-removed';
    wrapper.appendChild(innerButton);
    popup.appendChild(wrapper);
    await Promise.resolve();

    // Удаляем контейнер - кнопка внутри должна потерять fallback.
    popup.removeChild(wrapper);
    await Promise.resolve();

    const click = jest.fn();
    innerButton.addEventListener('click', click);
    dispatchPointer(innerButton, 'pointerdown', { x: 10, y: 10, t: 1000 });
    dispatchPointer(innerButton, 'pointerup', { x: 10, y: 10, t: 1050 });
    jest.advanceTimersByTime(80);
    expect(click).not.toHaveBeenCalled();
  });

  test('disable отключает observer - новые кнопки не получают fallback', async () => {
    await nextPointSwipeButtonsFix.enable();
    await nextPointSwipeButtonsFix.disable();

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
    await nextPointSwipeButtonsFix.enable();
    await nextPointSwipeButtonsFix.enable();

    const draw = document.querySelector<HTMLButtonElement>('#draw');
    if (!draw) throw new Error('#draw not found');
    // Игра включает кнопку, когда действие доступно.
    draw.disabled = false;
    const click = jest.fn();
    draw.addEventListener('click', click);
    dispatchPointer(draw, 'pointerdown', { x: 100, y: 100, t: 1000 });
    dispatchPointer(draw, 'pointerup', { x: 100, y: 100, t: 1100 });
    jest.advanceTimersByTime(80);
    // Click диспатчится один раз, не дважды.
    expect(click).toHaveBeenCalledTimes(1);
  });

  test('после нативного click polyfill не дублирует', async () => {
    await nextPointSwipeButtonsFix.enable();

    const draw = document.querySelector<HTMLButtonElement>('#draw');
    if (!draw) throw new Error('#draw not found');
    // Игра включает кнопку, когда действие доступно.
    draw.disabled = false;
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
