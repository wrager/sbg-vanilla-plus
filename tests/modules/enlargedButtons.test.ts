import { enlargedButtons } from '../../src/modules/enlargedButtons';

describe('enlargedButtons', () => {
  afterEach(() => {
    document.head.innerHTML = '';
  });

  test('enable injects style element', () => {
    enlargedButtons.enable();
    expect(document.getElementById('svp-enlargedButtons')).not.toBeNull();
  });

  test('disable removes style element', () => {
    enlargedButtons.enable();
    enlargedButtons.disable();
    expect(document.getElementById('svp-enlargedButtons')).toBeNull();
  });

  test('enable is idempotent — only one style element exists', () => {
    enlargedButtons.enable();
    enlargedButtons.enable();
    expect(document.querySelectorAll('#svp-enlargedButtons').length).toBe(1);
  });
});
