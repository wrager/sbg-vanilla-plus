import { removeAttackCloseButton } from './removeAttackCloseButton';

describe('removeAttackCloseButton', () => {
  afterEach(() => {
    document.head.innerHTML = '';
  });

  test('enable injects style element', async () => {
    await removeAttackCloseButton.enable();
    expect(document.getElementById('svp-removeAttackCloseButton')).not.toBeNull();
  });

  test('disable removes style element', async () => {
    await removeAttackCloseButton.enable();
    await removeAttackCloseButton.disable();
    expect(document.getElementById('svp-removeAttackCloseButton')).toBeNull();
  });

  test('enable is idempotent — only one style element exists', async () => {
    await removeAttackCloseButton.enable();
    await removeAttackCloseButton.enable();
    expect(document.querySelectorAll('#svp-removeAttackCloseButton').length).toBe(1);
  });
});
