import { shiftMapCenterDown } from './shiftMapCenterDown';
import type { IOlMap, IOlView } from '../../core/olMap';

jest.mock('../../core/olMap', () => ({
  getOlMap: jest.fn(),
}));

import { getOlMap } from '../../core/olMap';

const mockGetOlMap = getOlMap as jest.MockedFunction<typeof getOlMap>;
const setCenterMock = jest.fn();

let mockView: IOlView;

beforeEach(() => {
  setCenterMock.mockReset();
  mockView = {
    padding: [0, 0, 0, 0],
    getCenter: () => [0, 0],
    setCenter: setCenterMock,
    changed: jest.fn(),
  };
  mockGetOlMap.mockResolvedValue({
    getView: () => mockView,
    getLayers: jest.fn(),
    addLayer: jest.fn(),
    removeLayer: jest.fn(),
    updateSize: jest.fn(),
  } as unknown as IOlMap);
});

describe('shiftMapCenterDown', () => {
  test('has correct module metadata', () => {
    expect(shiftMapCenterDown.id).toBe('shiftMapCenterDown');
    expect(shiftMapCenterDown.category).toBe('map');
    expect(shiftMapCenterDown.defaultEnabled).toBe(true);
    expect(shiftMapCenterDown.requiresReload).toBe(true);
  });

  test('sets top padding on enable', async () => {
    shiftMapCenterDown.enable();
    await Promise.resolve();

    const expectedPadding = Math.round(window.innerHeight * 0.35);
    expect(mockView.padding).toEqual([expectedPadding, 0, 0, 0]);
  });

  test('calls setCenter to apply padding', async () => {
    shiftMapCenterDown.enable();
    await Promise.resolve();

    expect(setCenterMock).toHaveBeenCalledTimes(1);
    expect(setCenterMock).toHaveBeenCalledWith([0, 0]);
  });
});
