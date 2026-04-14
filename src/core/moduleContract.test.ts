/**
 * Контрактный тест: «init→enable→disable возвращает окружение к исходному
 * состоянию». Проверяет модули, у которых init/enable/disable работают с
 * глобальными объектами (OL map).
 */

import type { IDragPanControl, IOlMap, IOlView, IOlInteraction } from './olMap';

jest.mock('./olMap', () => {
  const actual: Record<string, unknown> = jest.requireActual('./olMap');
  return {
    ...actual,
    getOlMap: jest.fn(),
    createDragPanControl: jest.fn(
      (): IDragPanControl => ({
        disable: jest.fn(),
        restore: jest.fn(),
      }),
    ),
  };
});

import { createDragPanControl, getOlMap } from './olMap';
import { ngrsZoom } from '../modules/ngrsZoom/ngrsZoom';
import { shiftMapCenterDown } from '../modules/shiftMapCenterDown/shiftMapCenterDown';
import { singleFingerRotation } from '../modules/singleFingerRotation/singleFingerRotation';

const mockGetOlMap = getOlMap as jest.MockedFunction<typeof getOlMap>;
const mockCreateDragPanControl = createDragPanControl as jest.MockedFunction<
  typeof createDragPanControl
>;

class StubInteraction implements IOlInteraction {
  private active = true;
  setActive(value: boolean): void {
    this.active = value;
  }
  getActive(): boolean {
    return this.active;
  }
}

function baselineCalculateExtent(size?: number[]): number[] {
  if (!size) return [0, 0, 0, 0];
  return [-size[0] / 2, -size[1] / 2, size[0] / 2, size[1] / 2];
}

function createMockMap(): {
  map: IOlMap;
  view: IOlView;
  originalExtent: typeof baselineCalculateExtent;
} {
  const view: IOlView = {
    padding: [0, 0, 0, 0],
    getCenter: () => [0, 0],
    setCenter: jest.fn(),
    calculateExtent: baselineCalculateExtent,
    changed: jest.fn(),
    getRotation: () => 0,
    setRotation: jest.fn(),
    getResolution: () => 10,
    setResolution: jest.fn(),
    beginInteraction: jest.fn(),
    endInteraction: jest.fn(),
  };
  const map: IOlMap = {
    getView: () => view,
    getSize: () => [800, 600],
    getLayers: jest.fn() as unknown as IOlMap['getLayers'],
    getInteractions: () => ({
      getArray: () => [new StubInteraction(), new StubInteraction()],
    }),
    addLayer: jest.fn(),
    removeLayer: jest.fn(),
    updateSize: jest.fn(),
  };
  return { map, view, originalExtent: baselineCalculateExtent };
}

let viewport: HTMLDivElement;

beforeEach(() => {
  viewport = document.createElement('div');
  viewport.classList.add('ol-viewport');
  const canvas = document.createElement('canvas');
  viewport.appendChild(canvas);
  document.body.appendChild(viewport);

  window.ol = {
    Map: { prototype: { getView: jest.fn() } },
    interaction: { DoubleClickZoom: StubInteraction, DragPan: StubInteraction },
  } as unknown as typeof window.ol;
});

afterEach(() => {
  viewport.remove();
  delete window.ol;
  jest.restoreAllMocks();
});

describe('module contract: init() не должен навешивать side-effects', () => {
  // ── shiftMapCenterDown ────────────────────────────────────────────────────
  test('shiftMapCenterDown.init() не должен оборачивать view.calculateExtent', async () => {
    const { map, view, originalExtent } = createMockMap();
    mockGetOlMap.mockResolvedValue(map);

    await shiftMapCenterDown.init();

    expect(view.calculateExtent).toBe(originalExtent);
  });

  test('shiftMapCenterDown.enable() оборачивает view.calculateExtent', async () => {
    const { map, view, originalExtent } = createMockMap();
    mockGetOlMap.mockResolvedValue(map);

    await shiftMapCenterDown.init();
    await shiftMapCenterDown.enable();

    expect(view.calculateExtent).not.toBe(originalExtent);
    await shiftMapCenterDown.disable();
  });

  test('shiftMapCenterDown.disable() восстанавливает оригинальный calculateExtent', async () => {
    const { map, view, originalExtent } = createMockMap();
    mockGetOlMap.mockResolvedValue(map);

    await shiftMapCenterDown.init();
    await shiftMapCenterDown.enable();
    await shiftMapCenterDown.disable();

    expect(view.calculateExtent).toBe(originalExtent);
  });

  test('shiftMapCenterDown переживает несколько enable/disable циклов', async () => {
    const { map, view, originalExtent } = createMockMap();
    mockGetOlMap.mockResolvedValue(map);

    await shiftMapCenterDown.init();
    for (let i = 0; i < 3; i++) {
      await shiftMapCenterDown.enable();
      await shiftMapCenterDown.disable();
    }

    expect(view.calculateExtent).toBe(originalExtent);
  });

  // ── singleFingerRotation ──────────────────────────────────────────────────
  test('singleFingerRotation.init() не должен оборачивать view.calculateExtent', async () => {
    const { map, view, originalExtent } = createMockMap();
    mockGetOlMap.mockResolvedValue(map);

    await singleFingerRotation.init();

    expect(view.calculateExtent).toBe(originalExtent);
  });

  test('singleFingerRotation.enable() оборачивает view.calculateExtent', async () => {
    const { map, view, originalExtent } = createMockMap();
    mockGetOlMap.mockResolvedValue(map);

    await singleFingerRotation.init();
    await singleFingerRotation.enable();

    expect(view.calculateExtent).not.toBe(originalExtent);
    await singleFingerRotation.disable();
  });

  test('singleFingerRotation.disable() восстанавливает оригинальный calculateExtent', async () => {
    const { map, view, originalExtent } = createMockMap();
    mockGetOlMap.mockResolvedValue(map);

    await singleFingerRotation.init();
    await singleFingerRotation.enable();
    await singleFingerRotation.disable();

    expect(view.calculateExtent).toBe(originalExtent);
  });

  test('singleFingerRotation переживает несколько enable/disable циклов', async () => {
    const { map, view, originalExtent } = createMockMap();
    mockGetOlMap.mockResolvedValue(map);

    await singleFingerRotation.init();
    for (let i = 0; i < 3; i++) {
      await singleFingerRotation.enable();
      await singleFingerRotation.disable();
    }

    expect(view.calculateExtent).toBe(originalExtent);
  });

  // ── ngrsZoom ──────────────────────────────────────────────────────────────
  test('ngrsZoom.init() не вызывает createDragPanControl', async () => {
    const { map } = createMockMap();
    mockGetOlMap.mockResolvedValue(map);
    mockCreateDragPanControl.mockClear();

    await ngrsZoom.init();

    expect(mockCreateDragPanControl).not.toHaveBeenCalled();
  });

  test('ngrsZoom.init() не отключает DoubleClickZoom interaction', async () => {
    const doubleClickZoom = new StubInteraction();
    const { map } = createMockMap();
    map.getInteractions = () => ({ getArray: () => [doubleClickZoom] });
    mockGetOlMap.mockResolvedValue(map);

    await ngrsZoom.init();

    expect(doubleClickZoom.getActive()).toBe(true);
  });

  test('ngrsZoom.enable() создаёт DragPan control после init', async () => {
    const { map } = createMockMap();
    mockGetOlMap.mockResolvedValue(map);
    mockCreateDragPanControl.mockClear();

    await ngrsZoom.init();
    await ngrsZoom.enable();

    expect(mockCreateDragPanControl).toHaveBeenCalledTimes(1);
    await ngrsZoom.disable();
  });

  test('ngrsZoom.disable() вызывает restore и обнуляет ссылку на DragPan control', async () => {
    const restoreSpy = jest.fn();
    mockCreateDragPanControl.mockReturnValueOnce({
      disable: jest.fn(),
      restore: restoreSpy,
    });
    const { map } = createMockMap();
    mockGetOlMap.mockResolvedValue(map);

    await ngrsZoom.init();
    await ngrsZoom.enable();
    await ngrsZoom.disable();

    expect(restoreSpy).toHaveBeenCalledTimes(1);
  });

  test('ngrsZoom переживает несколько enable/disable циклов — каждый создаёт свой DragPan control', async () => {
    const { map } = createMockMap();
    mockGetOlMap.mockResolvedValue(map);
    mockCreateDragPanControl.mockClear();

    await ngrsZoom.init();
    for (let i = 0; i < 3; i++) {
      await ngrsZoom.enable();
      await ngrsZoom.disable();
    }

    expect(mockCreateDragPanControl).toHaveBeenCalledTimes(3);
  });
});
