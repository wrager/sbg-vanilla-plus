import type { IOlMap, IOlView } from '../../core/olMap';

jest.mock('../../core/olMap', () => ({
  getOlMap: jest.fn(),
}));

import { shiftMapCenterDown } from './shiftMapCenterDown';
import { getOlMap } from '../../core/olMap';

const mockGetOlMap = getOlMap as jest.MockedFunction<typeof getOlMap>;
const setCenterMock = jest.fn();

let mockView: IOlView;
let mockMap: IOlMap;

beforeEach(async () => {
  setCenterMock.mockReset();
  mockView = {
    padding: [0, 0, 0, 0],
    getCenter: () => [0, 0],
    setCenter: setCenterMock,
    calculateExtent: (size?: number[]) => {
      if (size) return [-size[0] / 2, -size[1] / 2, size[0] / 2, size[1] / 2];
      return [0, 0, 0, 0];
    },
    changed: jest.fn(),
    getRotation: () => 0,
    setRotation: jest.fn(),
  };
  mockMap = {
    getView: () => mockView,
    getSize: () => [800, 600],
    getLayers: jest.fn() as unknown as IOlMap['getLayers'],
    getInteractions: jest.fn() as unknown as IOlMap['getInteractions'],
    addLayer: jest.fn(),
    removeLayer: jest.fn(),
    updateSize: jest.fn(),
  };
  mockGetOlMap.mockResolvedValue(mockMap);

  Object.defineProperty(window, 'innerHeight', { value: 600, writable: true });

  await shiftMapCenterDown.init();
});

describe('shiftMapCenterDown', () => {
  test('has correct module metadata', () => {
    expect(shiftMapCenterDown.id).toBe('shiftMapCenterDown');
    expect(shiftMapCenterDown.category).toBe('map');
    expect(shiftMapCenterDown.defaultEnabled).toBe(true);
    expect(shiftMapCenterDown.requiresReload).toBeUndefined();
  });

  test('sets top padding on enable', async () => {
    await shiftMapCenterDown.enable();

    const expectedPadding = Math.round(600 * 0.35);
    expect(mockView.padding).toEqual([expectedPadding, 0, 0, 0]);
  });

  test('calls setCenter to apply padding', async () => {
    await shiftMapCenterDown.enable();

    expect(setCenterMock).toHaveBeenCalledTimes(1);
    expect(setCenterMock).toHaveBeenCalledWith([0, 0]);
  });

  test('inflates calculateExtent height by padding when enabled', async () => {
    await shiftMapCenterDown.enable();

    const topPadding = Math.round(600 * 0.35);
    const extent = mockView.calculateExtent([400, 300]);

    // height inflated: 300 + topPadding
    expect(extent[2] - extent[0]).toBe(400);
    expect(extent[3] - extent[1]).toBe(300 + topPadding);
  });

  test('does not inflate calculateExtent when disabled', async () => {
    await shiftMapCenterDown.enable();
    await shiftMapCenterDown.disable();

    const extent = mockView.calculateExtent([400, 300]);

    expect(extent[2] - extent[0]).toBe(400);
    expect(extent[3] - extent[1]).toBe(300);
  });

  test('passes through calculateExtent without size argument', async () => {
    await shiftMapCenterDown.enable();

    const extent = mockView.calculateExtent();
    expect(extent).toEqual([0, 0, 0, 0]);
  });

  test('resets padding to zero on disable', async () => {
    await shiftMapCenterDown.enable();
    await shiftMapCenterDown.disable();

    expect(mockView.padding).toEqual([0, 0, 0, 0]);
  });

  test('calls setCenter on disable to re-center view', async () => {
    await shiftMapCenterDown.enable();
    setCenterMock.mockClear();

    await shiftMapCenterDown.disable();

    expect(setCenterMock).toHaveBeenCalledTimes(1);
    expect(setCenterMock).toHaveBeenCalledWith([0, 0]);
  });
});
