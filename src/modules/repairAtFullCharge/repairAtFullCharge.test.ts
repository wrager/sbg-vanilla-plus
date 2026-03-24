import { repairAtFullCharge } from './repairAtFullCharge';

function setupDom(
  options: { playerTeam?: number; pointTeam?: number; pointGuid?: string } = {},
): void {
  const { playerTeam = 1, pointTeam = 1, pointGuid = 'point-123' } = options;

  const playerName = document.createElement('span');
  playerName.id = 'self-info__name';
  playerName.setAttribute('style', `color: var(--team-${playerTeam})`);
  document.body.appendChild(playerName);

  const popup = document.createElement('div');
  popup.className = 'info';
  popup.setAttribute('data-guid', pointGuid);
  document.body.appendChild(popup);

  const owner = document.createElement('span');
  owner.id = 'i-stat__owner';
  owner.setAttribute('style', `color: var(--team-${pointTeam})`);
  document.body.appendChild(owner);
}

function createRepairButton(disabled = true): HTMLButtonElement {
  const button = document.createElement('button');
  button.id = 'repair';
  if (disabled) button.setAttribute('disabled', '');
  document.body.appendChild(button);
  return button;
}

function setInventory(items: { t: number; l: string }[]): void {
  localStorage.setItem('inventory-cache', JSON.stringify(items));
}

describe('repairAtFullCharge', () => {
  afterEach(async () => {
    await repairAtFullCharge.disable();
    document.body.innerHTML = '';
    localStorage.clear();
  });

  test('removes disabled when same team and has keys', async () => {
    setupDom({ playerTeam: 1, pointTeam: 1, pointGuid: 'point-123' });
    setInventory([{ t: 3, l: 'point-123' }]);

    await repairAtFullCharge.enable();
    const button = createRepairButton(false);
    button.setAttribute('disabled', '');
    await Promise.resolve();
    expect(button.hasAttribute('disabled')).toBe(false);
  });

  test('keeps disabled when different team', async () => {
    setupDom({ playerTeam: 1, pointTeam: 2, pointGuid: 'point-123' });
    setInventory([{ t: 3, l: 'point-123' }]);

    await repairAtFullCharge.enable();
    const button = createRepairButton(false);
    button.setAttribute('disabled', '');
    await Promise.resolve();
    expect(button.hasAttribute('disabled')).toBe(true);
  });

  test('keeps disabled when no keys for this point', async () => {
    setupDom({ playerTeam: 1, pointTeam: 1, pointGuid: 'point-123' });
    setInventory([{ t: 3, l: 'other-point' }]);

    await repairAtFullCharge.enable();
    const button = createRepairButton(false);
    button.setAttribute('disabled', '');
    await Promise.resolve();
    expect(button.hasAttribute('disabled')).toBe(true);
  });

  test('keeps disabled when inventory is empty', async () => {
    setupDom({ playerTeam: 1, pointTeam: 1, pointGuid: 'point-123' });
    setInventory([]);

    await repairAtFullCharge.enable();
    const button = createRepairButton(false);
    button.setAttribute('disabled', '');
    await Promise.resolve();
    expect(button.hasAttribute('disabled')).toBe(true);
  });

  test('does not affect other buttons', async () => {
    setupDom();
    setInventory([{ t: 3, l: 'point-123' }]);

    await repairAtFullCharge.enable();
    const other = document.createElement('button');
    other.id = 'other';
    other.setAttribute('disabled', '');
    document.body.appendChild(other);
    await Promise.resolve();
    expect(other.hasAttribute('disabled')).toBe(true);
  });

  test('disable stops removing the attribute', async () => {
    setupDom();
    setInventory([{ t: 3, l: 'point-123' }]);

    await repairAtFullCharge.enable();
    await repairAtFullCharge.disable();
    const button = createRepairButton(false);
    button.setAttribute('disabled', '');
    await Promise.resolve();
    expect(button.hasAttribute('disabled')).toBe(true);
  });
});
