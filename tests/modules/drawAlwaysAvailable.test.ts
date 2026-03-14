import { drawAlwaysAvailable } from '../../src/modules/drawAlwaysAvailable';

function createDrawButton(disabled = true): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.id = 'draw';
  if (disabled) btn.setAttribute('disabled', '');
  document.body.appendChild(btn);
  return btn;
}

describe('drawAlwaysAvailable', () => {
  afterEach(() => {
    drawAlwaysAvailable.disable();
    document.body.innerHTML = '';
  });

  test('removes disabled from #draw when attribute is set', async () => {
    drawAlwaysAvailable.enable();
    const btn = createDrawButton(false);
    btn.setAttribute('disabled', '');
    await Promise.resolve();
    expect(btn.hasAttribute('disabled')).toBe(false);
  });

  test('does not affect disabled on other buttons', async () => {
    drawAlwaysAvailable.enable();
    const other = document.createElement('button');
    other.id = 'other';
    other.setAttribute('disabled', '');
    document.body.appendChild(other);
    await Promise.resolve();
    expect(other.hasAttribute('disabled')).toBe(true);
  });

  test('disable stops removing the attribute', async () => {
    drawAlwaysAvailable.enable();
    drawAlwaysAvailable.disable();
    const btn = createDrawButton(false);
    btn.setAttribute('disabled', '');
    await Promise.resolve();
    expect(btn.hasAttribute('disabled')).toBe(true);
  });
});
