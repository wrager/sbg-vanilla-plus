import { repairButtonAlwaysEnabled } from './repairButtonAlwaysEnabled';

function createRepairButton(disabled = true): HTMLButtonElement {
  const button = document.createElement('button');
  button.id = 'repair';
  if (disabled) button.setAttribute('disabled', '');
  document.body.appendChild(button);
  return button;
}

describe('repairButtonAlwaysEnabled', () => {
  afterEach(async () => {
    await repairButtonAlwaysEnabled.disable();
    document.body.innerHTML = '';
  });

  test('removes disabled from #repair when attribute is set', async () => {
    await repairButtonAlwaysEnabled.enable();
    const button = createRepairButton(false);
    button.setAttribute('disabled', '');
    await Promise.resolve();
    expect(button.hasAttribute('disabled')).toBe(false);
  });

  test('does not affect disabled on other buttons', async () => {
    await repairButtonAlwaysEnabled.enable();
    const other = document.createElement('button');
    other.id = 'other';
    other.setAttribute('disabled', '');
    document.body.appendChild(other);
    await Promise.resolve();
    expect(other.hasAttribute('disabled')).toBe(true);
  });

  test('disable stops removing the attribute', async () => {
    await repairButtonAlwaysEnabled.enable();
    await repairButtonAlwaysEnabled.disable();
    const button = createRepairButton(false);
    button.setAttribute('disabled', '');
    await Promise.resolve();
    expect(button.hasAttribute('disabled')).toBe(true);
  });
});
