import type { IOlMap, IOlView } from '../../core/olMap';

jest.mock('../../core/olMap', () => ({
  getOlMap: jest.fn(),
}));

import { shiftMapCenterDown } from './shiftMapCenterDown';
import { getOlMap } from '../../core/olMap';

const mockGetOlMap = getOlMap as jest.MockedFunction<typeof getOlMap>;
const setCenterMock = jest.fn();
const calculateExtentMock = jest.fn(() => [0, 0, 1, 1]);

let mockView: IOlView;
let mockMap: IOlMap;

beforeEach(() => {
  setCenterMock.mockReset();
  calculateExtentMock.mockReset();
  calculateExtentMock.mockReturnValue([0, 0, 1, 1]);
  mockView = {
    padding: [0, 0, 0, 0],
    getCenter: () => [0, 0],
    setCenter: setCenterMock,
    calculateExtent: calculateExtentMock,
    changed: jest.fn(),
  };
  mockMap = {
    getView: () => mockView,
    getSize: () => [800, 600],
    getLayers: jest.fn() as unknown as IOlMap['getLayers'],
    addLayer: jest.fn(),
    removeLayer: jest.fn(),
    updateSize: jest.fn(),
  };
  mockGetOlMap.mockResolvedValue(mockMap);
});

describe('shiftMapCenterDown', () => {
  test('has correct module metadata', () => {
    expect(shiftMapCenterDown.id).toBe('shiftMapCenterDown');
    expect(shiftMapCenterDown.category).toBe('map');
    expect(shiftMapCenterDown.defaultEnabled).toBe(true);
    expect(shiftMapCenterDown.requiresReload).toBe(true);
  });

  test('sets top padding on enable', async () => {
    await shiftMapCenterDown.enable();

    const expectedPadding = Math.round(window.innerHeight * 0.35);
    expect(mockView.padding).toEqual([expectedPadding, 0, 0, 0]);
  });

  test('calls setCenter to apply padding', async () => {
    await shiftMapCenterDown.enable();

    expect(setCenterMock).toHaveBeenCalledTimes(1);
    expect(setCenterMock).toHaveBeenCalledWith([0, 0]);
  });

  test('wraps calculateExtent to use full map size when called without args', async () => {
    await shiftMapCenterDown.enable();

    mockView.calculateExtent();
    expect(calculateExtentMock).toHaveBeenCalledWith([800, 600]);
  });

  test('wraps calculateExtent to increase height by padding when called with size', async () => {
    await shiftMapCenterDown.enable();

    const topPadding = Math.round(window.innerHeight * 0.35);
    mockView.calculateExtent([400, 300]);
    expect(calculateExtentMock).toHaveBeenCalledWith([400, 300 + topPadding]);
  });
});
