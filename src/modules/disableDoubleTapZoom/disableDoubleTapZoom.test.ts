import type { IOlInteraction, IOlMap } from '../../core/olMap';

jest.mock('../../core/olMap', () => ({
  getOlMap: jest.fn(),
}));

import { disableDoubleTapZoom } from './disableDoubleTapZoom';
import { getOlMap } from '../../core/olMap';

const mockGetOlMap = getOlMap as jest.MockedFunction<typeof getOlMap>;

class MockDoubleClickZoom implements IOlInteraction {
  private active = true;
  setActive(value: boolean): void {
    this.active = value;
  }
  getActive(): boolean {
    return this.active;
  }
}

class MockOtherInteraction implements IOlInteraction {
  private active = true;
  setActive(value: boolean): void {
    this.active = value;
  }
  getActive(): boolean {
    return this.active;
  }
}

let doubleClickZoom: MockDoubleClickZoom;
let otherInteraction: MockOtherInteraction;
let mockMap: IOlMap;

beforeEach(() => {
  doubleClickZoom = new MockDoubleClickZoom();
  otherInteraction = new MockOtherInteraction();
  mockMap = {
    getView: jest.fn() as unknown as IOlMap['getView'],
    getSize: () => [800, 600],
    getLayers: jest.fn() as unknown as IOlMap['getLayers'],
    getInteractions: () => ({
      getArray: () => [doubleClickZoom, otherInteraction],
    }),
    addLayer: jest.fn(),
    removeLayer: jest.fn(),
    updateSize: jest.fn(),
  };
  mockGetOlMap.mockResolvedValue(mockMap);

  window.ol = {
    Map: { prototype: { getView: jest.fn() } },
    interaction: { DoubleClickZoom: MockDoubleClickZoom },
  } as unknown as typeof window.ol;
});

afterEach(async () => {
  await disableDoubleTapZoom.disable();
  delete window.ol;
  jest.restoreAllMocks();
});

describe('disableDoubleTapZoom', () => {
  test('has correct module metadata', () => {
    expect(disableDoubleTapZoom.id).toBe('disableDoubleTapZoom');
    expect(disableDoubleTapZoom.category).toBe('map');
    expect(disableDoubleTapZoom.defaultEnabled).toBe(true);
  });

  test('enable deactivates DoubleClickZoom interaction', async () => {
    await disableDoubleTapZoom.enable();
    expect(doubleClickZoom.getActive()).toBe(false);
  });

  test('enable does not affect other interactions', async () => {
    await disableDoubleTapZoom.enable();
    expect(otherInteraction.getActive()).toBe(true);
  });

  test('disable reactivates DoubleClickZoom interaction', async () => {
    await disableDoubleTapZoom.enable();
    await disableDoubleTapZoom.disable();
    expect(doubleClickZoom.getActive()).toBe(true);
  });

  test('disable before map ready does not deactivate interaction', async () => {
    let resolveMap!: (map: IOlMap) => void;
    mockGetOlMap.mockReturnValue(
      new Promise((resolve) => {
        resolveMap = resolve;
      }),
    );

    const enablePromise = disableDoubleTapZoom.enable();
    await disableDoubleTapZoom.disable();
    resolveMap(mockMap);
    await enablePromise;

    expect(doubleClickZoom.getActive()).toBe(true);
  });

  test('multiple enable/disable cycles work correctly', async () => {
    await disableDoubleTapZoom.enable();
    expect(doubleClickZoom.getActive()).toBe(false);

    await disableDoubleTapZoom.disable();
    expect(doubleClickZoom.getActive()).toBe(true);

    await disableDoubleTapZoom.enable();
    expect(doubleClickZoom.getActive()).toBe(false);
  });

  test('enable without DoubleClickZoom constructor completes without error', async () => {
    window.ol = {
      Map: { prototype: { getView: jest.fn() } },
    } as unknown as typeof window.ol;

    await disableDoubleTapZoom.enable();
    expect(doubleClickZoom.getActive()).toBe(true);
  });
});
