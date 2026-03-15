import { enhancedPointPopupUi } from './enhancedPointPopupUi';

describe('enhancedPointPopupUi', () => {
  afterEach(() => {
    document.head.innerHTML = '';
  });

  test('enable injects style element', async () => {
    await enhancedPointPopupUi.enable();
    expect(document.getElementById('svp-enhancedPointPopupUi')).not.toBeNull();
  });

  test('disable removes style element', async () => {
    await enhancedPointPopupUi.enable();
    await enhancedPointPopupUi.disable();
    expect(document.getElementById('svp-enhancedPointPopupUi')).toBeNull();
  });

  test('enable is idempotent — only one style element exists', async () => {
    await enhancedPointPopupUi.enable();
    await enhancedPointPopupUi.enable();
    expect(document.querySelectorAll('#svp-enhancedPointPopupUi').length).toBe(1);
  });
});
