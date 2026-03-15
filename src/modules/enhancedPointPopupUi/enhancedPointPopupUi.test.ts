import { enhancedPointPopupUi } from './enhancedPointPopupUi';

describe('enhancedPointPopupUi', () => {
  afterEach(() => {
    document.head.innerHTML = '';
  });

  test('enable injects style element', () => {
    enhancedPointPopupUi.enable();
    expect(document.getElementById('svp-enhancedPointPopupUi')).not.toBeNull();
  });

  test('disable removes style element', () => {
    enhancedPointPopupUi.enable();
    enhancedPointPopupUi.disable();
    expect(document.getElementById('svp-enhancedPointPopupUi')).toBeNull();
  });

  test('enable is idempotent — only one style element exists', () => {
    enhancedPointPopupUi.enable();
    enhancedPointPopupUi.enable();
    expect(document.querySelectorAll('#svp-enhancedPointPopupUi').length).toBe(1);
  });
});
