import { shiftMapCenterDown } from './shiftMapCenterDown';

describe('shiftMapCenterDown', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="map"></div>';
  });

  afterEach(() => {
    document.getElementById('svp-shiftMapCenterDown')?.remove();
    document.body.innerHTML = '';
  });

  test('has correct module metadata', () => {
    expect(shiftMapCenterDown.id).toBe('shiftMapCenterDown');
    expect(shiftMapCenterDown.script).toBe('style');
    expect(shiftMapCenterDown.defaultEnabled).toBe(true);
    expect(shiftMapCenterDown.requiresReload).toBe(true);
  });

  test('injects style on enable', () => {
    shiftMapCenterDown.enable();

    const style = document.getElementById('svp-shiftMapCenterDown');
    expect(style).not.toBeNull();
    expect(style?.textContent).toContain('#map');
    expect(style?.textContent).toContain('calc(100% + 40vh)');
  });

  test('disable is no-op (requires reload)', () => {
    shiftMapCenterDown.enable();
    shiftMapCenterDown.disable();

    const style = document.getElementById('svp-shiftMapCenterDown');
    expect(style).not.toBeNull();
  });
});
