import { shiftMapCenterDown } from './shiftMapCenterDown';
import type { IOlMap } from '../../core/olMap';

jest.mock('../../core/olMap', () => ({
  getOlMap: jest.fn(),
}));

import { getOlMap } from '../../core/olMap';

const mockGetOlMap = getOlMap as jest.MockedFunction<typeof getOlMap>;
const updateSizeMock = jest.fn();

beforeEach(() => {
  document.body.innerHTML = '<div id="map"></div>';
  updateSizeMock.mockReset();
  mockGetOlMap.mockResolvedValue({
    getView: jest.fn(),
    getLayers: jest.fn(),
    addLayer: jest.fn(),
    removeLayer: jest.fn(),
    updateSize: updateSizeMock,
  } as unknown as IOlMap);
});

afterEach(() => {
  shiftMapCenterDown.disable();
  document.body.innerHTML = '';
});

describe('shiftMapCenterDown', () => {
  test('has correct module metadata', () => {
    expect(shiftMapCenterDown.id).toBe('shiftMapCenterDown');
    expect(shiftMapCenterDown.category).toBe('map');
    expect(shiftMapCenterDown.defaultEnabled).toBe(true);
    expect(shiftMapCenterDown.requiresReload).toBeUndefined();
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

  test('calls updateSize on enable', async () => {
    shiftMapCenterDown.enable();
    await Promise.resolve();
    expect(updateSizeMock).toHaveBeenCalledTimes(1);
  });

  test('calls updateSize on disable', async () => {
    shiftMapCenterDown.enable();
    await Promise.resolve();
    updateSizeMock.mockClear();
    shiftMapCenterDown.disable();
    await Promise.resolve();
    expect(updateSizeMock).toHaveBeenCalledTimes(1);
  });
});
