import { largerPointTapArea } from './largerPointTapArea';
import type { IOlMap } from '../../core/olMap';

jest.mock('../../core/olMap', () => ({
  getOlMap: jest.fn(),
}));

import { getOlMap } from '../../core/olMap';

const mockGetOlMap = getOlMap as jest.MockedFunction<typeof getOlMap>;

interface IMockMap {
  getView: jest.Mock;
  getLayers: jest.Mock;
  addLayer: jest.Mock;
  removeLayer: jest.Mock;
  updateSize: jest.Mock;
  forEachFeatureAtPixel: jest.Mock;
}

let forEachOriginal: jest.Mock;
let mockMap: IMockMap;

beforeEach(() => {
  forEachOriginal = jest.fn();
  mockMap = {
    getView: jest.fn(),
    getLayers: jest.fn(),
    addLayer: jest.fn(),
    removeLayer: jest.fn(),
    updateSize: jest.fn(),
    forEachFeatureAtPixel: forEachOriginal,
  };
  // IOlMap doesn't declare forEachFeatureAtPixel; the type guard checks it at runtime
  mockGetOlMap.mockResolvedValue(mockMap as unknown as IOlMap);
});

afterEach(() => {
  largerPointTapArea.disable();
});

describe('largerPointTapArea metadata', () => {
  test('has correct id', () => {
    expect(largerPointTapArea.id).toBe('largerPointTapArea');
  });

  test('has style category', () => {
    expect(largerPointTapArea.category).toBe('style');
  });

  test('is enabled by default', () => {
    expect(largerPointTapArea.defaultEnabled).toBe(true);
  });

  test('has localized name and description', () => {
    expect(largerPointTapArea.name.ru).toBeTruthy();
    expect(largerPointTapArea.name.en).toBeTruthy();
    expect(largerPointTapArea.description.ru).toBeTruthy();
    expect(largerPointTapArea.description.en).toBeTruthy();
  });
});

describe('largerPointTapArea enable/disable', () => {
  test('does nothing if map has no forEachFeatureAtPixel', async () => {
    const plainMap = {
      getView: jest.fn(),
      getLayers: jest.fn(),
      addLayer: jest.fn(),
      removeLayer: jest.fn(),
      updateSize: jest.fn(),
    };
    mockGetOlMap.mockResolvedValue(plainMap as unknown as IOlMap);

    largerPointTapArea.enable();
    await Promise.resolve();

    expect(plainMap).not.toHaveProperty('forEachFeatureAtPixel');
  });

  test('injects hitTolerance into every call', async () => {
    largerPointTapArea.enable();
    await Promise.resolve();

    const callback = jest.fn();
    mockMap.forEachFeatureAtPixel([100, 200], callback);

    expect(forEachOriginal).toHaveBeenCalledWith([100, 200], callback, {
      hitTolerance: 15,
    });
  });

  test('preserves existing options while adding hitTolerance', async () => {
    largerPointTapArea.enable();
    await Promise.resolve();

    const callback = jest.fn();
    const layerFilter = jest.fn();
    mockMap.forEachFeatureAtPixel([10, 20], callback, { layerFilter });

    expect(forEachOriginal).toHaveBeenCalledWith([10, 20], callback, {
      layerFilter,
      hitTolerance: 15,
    });
  });

  test('overrides caller hitTolerance with module value', async () => {
    largerPointTapArea.enable();
    await Promise.resolve();

    const callback = jest.fn();
    mockMap.forEachFeatureAtPixel([10, 20], callback, { hitTolerance: 0 });

    expect(forEachOriginal).toHaveBeenCalledWith([10, 20], callback, {
      hitTolerance: 15,
    });
  });

  test('restores original method on disable', async () => {
    largerPointTapArea.enable();
    await Promise.resolve();

    largerPointTapArea.disable();

    expect(mockMap.forEachFeatureAtPixel).toBe(forEachOriginal);
  });

  test('enable is idempotent — does not double-patch', async () => {
    largerPointTapArea.enable();
    await Promise.resolve();

    const patchedMethod = mockMap.forEachFeatureAtPixel;

    largerPointTapArea.enable();
    await Promise.resolve();

    expect(mockMap.forEachFeatureAtPixel).toBe(patchedMethod);
  });

  test('disable is safe when not enabled', () => {
    expect(() => {
      largerPointTapArea.disable();
    }).not.toThrow();
  });
});
