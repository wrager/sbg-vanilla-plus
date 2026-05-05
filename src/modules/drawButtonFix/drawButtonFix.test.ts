import { drawButtonFix } from './drawButtonFix';

function createDrawButton(disabled = true): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.id = 'draw';
  if (disabled) btn.setAttribute('disabled', '');
  document.body.appendChild(btn);
  return btn;
}

describe('drawButtonFix', () => {
  afterEach(async () => {
    await drawButtonFix.disable();
    document.body.innerHTML = '';
  });

  test('removes disabled from #draw when attribute is set', async () => {
    const btn = createDrawButton(false);
    await drawButtonFix.enable();
    btn.setAttribute('disabled', '');
    await Promise.resolve();
    expect(btn.hasAttribute('disabled')).toBe(false);
  });

  test('does not affect disabled on other buttons', async () => {
    createDrawButton(false);
    await drawButtonFix.enable();
    const other = document.createElement('button');
    other.id = 'other';
    other.setAttribute('disabled', '');
    document.body.appendChild(other);
    await Promise.resolve();
    expect(other.hasAttribute('disabled')).toBe(true);
  });

  test('disable stops removing the attribute', async () => {
    const btn = createDrawButton(false);
    await drawButtonFix.enable();
    await drawButtonFix.disable();
    btn.setAttribute('disabled', '');
    await Promise.resolve();
    expect(btn.hasAttribute('disabled')).toBe(true);
  });
});
