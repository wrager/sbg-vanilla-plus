import { drawButtonFix } from './drawButtonFix';

function createDrawButton(disabled = true): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.id = 'draw';
  if (disabled) btn.setAttribute('disabled', '');
  document.body.appendChild(btn);
  return btn;
}

function createInfoPopup(guid: string, drawCountText: string): HTMLElement {
  const popup = document.createElement('div');
  popup.className = 'info popup';
  popup.dataset.guid = guid;
  const counter = document.createElement('span');
  counter.id = 'draw-count';
  counter.textContent = drawCountText;
  popup.appendChild(counter);
  document.body.appendChild(popup);
  return popup;
}

describe('drawButtonFix', () => {
  afterEach(async () => {
    await drawButtonFix.disable();
    document.body.innerHTML = '';
  });

  test('removes disabled from #draw when attribute is set', async () => {
    await drawButtonFix.enable();
    const btn = createDrawButton(false);
    btn.setAttribute('disabled', '');
    await Promise.resolve();
    expect(btn.hasAttribute('disabled')).toBe(false);
  });

  test('does not affect disabled on other buttons', async () => {
    await drawButtonFix.enable();
    const other = document.createElement('button');
    other.id = 'other';
    other.setAttribute('disabled', '');
    document.body.appendChild(other);
    await Promise.resolve();
    expect(other.hasAttribute('disabled')).toBe(true);
  });

  test('disable stops removing the attribute', async () => {
    await drawButtonFix.enable();
    await drawButtonFix.disable();
    const btn = createDrawButton(false);
    btn.setAttribute('disabled', '');
    await Promise.resolve();
    expect(btn.hasAttribute('disabled')).toBe(true);
  });

  test('сбрасывает #draw-count при смене data-guid на .info', async () => {
    await drawButtonFix.enable();
    const popup = createInfoPopup('guid-a', '[3]');
    popup.dataset.guid = 'guid-b';
    await Promise.resolve();
    const counter = document.querySelector('#draw-count');
    expect(counter?.textContent).toBe('[...]');
  });

  test('не сбрасывает #draw-count при смене data-guid на других элементах', async () => {
    await drawButtonFix.enable();
    createInfoPopup('guid-a', '[3]');
    // .draw-slider-wrp тоже хранит data-guid (refs/game/script.js:1011),
    // но это не должно триггерить инвалидацию #draw-count.
    const slider = document.createElement('div');
    slider.className = 'draw-slider-wrp';
    slider.dataset.guid = 'guid-x';
    document.body.appendChild(slider);
    slider.dataset.guid = 'guid-y';
    await Promise.resolve();
    const counter = document.querySelector('#draw-count');
    expect(counter?.textContent).toBe('[3]');
  });

  test('disable отключает инвалидацию #draw-count', async () => {
    await drawButtonFix.enable();
    const popup = createInfoPopup('guid-a', '[3]');
    await drawButtonFix.disable();
    popup.dataset.guid = 'guid-b';
    await Promise.resolve();
    const counter = document.querySelector('#draw-count');
    expect(counter?.textContent).toBe('[3]');
  });
});
