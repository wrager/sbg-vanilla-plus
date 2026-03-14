import { shiftMapCenterDown } from '../../src/modules/shiftMapCenterDown/shiftMapCenterDown';

describe('shiftMapCenterDown', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="map"></div>';
  });

  afterEach(() => {
    shiftMapCenterDown.disable();
    document.body.innerHTML = '';
  });

  test('has correct module metadata', () => {
    expect(shiftMapCenterDown.id).toBe('shiftMapCenterDown');
    expect(shiftMapCenterDown.script).toBe('style');
    expect(shiftMapCenterDown.defaultEnabled).toBe(true);
  });

  test('injects style on enable', () => {
    shiftMapCenterDown.enable();

    const style = document.getElementById('svp-shiftMapCenterDown');
    expect(style).not.toBeNull();
    expect(style?.textContent).toContain('#map');
    expect(style?.textContent).toContain('calc(100% + 40vh)');
  });

  test('removes style on disable', () => {
    shiftMapCenterDown.enable();
    shiftMapCenterDown.disable();

    const style = document.getElementById('svp-shiftMapCenterDown');
    expect(style).toBeNull();
  });

  test('dispatches resize event on enable', () => {
    const handler = jest.fn();
    window.addEventListener('resize', handler);

    shiftMapCenterDown.enable();
    expect(handler).toHaveBeenCalledTimes(1);

    window.removeEventListener('resize', handler);
  });

  test('dispatches resize event on disable', () => {
    shiftMapCenterDown.enable();

    const handler = jest.fn();
    window.addEventListener('resize', handler);

    shiftMapCenterDown.disable();
    expect(handler).toHaveBeenCalledTimes(1);

    window.removeEventListener('resize', handler);
  });
});
