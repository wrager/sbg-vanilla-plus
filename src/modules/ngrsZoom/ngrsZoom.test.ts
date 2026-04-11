import type { IOlInteraction, IOlMap, IOlView } from '../../core/olMap';

// jsdom does not implement Touch/TouchEvent — polyfill with the properties we need
class TouchPolyfill {
  readonly clientX: number;
  readonly clientY: number;
  constructor(init: { clientX?: number; clientY?: number }) {
    this.clientX = init.clientX ?? 0;
    this.clientY = init.clientY ?? 0;
  }
}

class TouchEventPolyfill extends UIEvent {
  readonly targetTouches: readonly TouchPolyfill[];
  constructor(
    type: string,
    init: { cancelable?: boolean; targetTouches?: TouchPolyfill[]; timeStamp?: number } = {},
  ) {
    super(type, { bubbles: true, cancelable: init.cancelable });
    this.targetTouches = init.targetTouches ?? [];
    if (init.timeStamp !== undefined) {
      Object.defineProperty(this, 'timeStamp', { value: init.timeStamp });
    }
  }
}

if (typeof globalThis.TouchEvent === 'undefined') {
  (globalThis as Record<string, unknown>).TouchEvent = TouchEventPolyfill;
}

jest.mock('../../core/olMap', () => {
  const actual: Record<string, unknown> = jest.requireActual('../../core/olMap');
  return {
    ...actual,
    getOlMap: jest.fn(),
  };
});

import { ngrsZoom } from './ngrsZoom';
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

class MockDragPan implements IOlInteraction {
  private active = true;
  setActive(value: boolean): void {
    this.active = value;
  }
  getActive(): boolean {
    return this.active;
  }
}

let mockSetResolution: jest.MockedFunction<(resolution: number) => void>;
let mockBeginInteraction: jest.MockedFunction<() => void>;
let mockEndInteraction: jest.MockedFunction<(duration?: number) => void>;
let currentResolution: number;
let mockView: IOlView;
let mockMap: IOlMap;
let doubleClickZoom: MockDoubleClickZoom;
let dragPan: MockDragPan;
let viewport: HTMLDivElement;
let canvas: HTMLCanvasElement;

function dispatchTouch(
  type: 'touchstart' | 'touchmove' | 'touchend',
  options: { clientX?: number; clientY?: number; targetTouches?: number; timeStamp?: number } = {},
): TouchEventPolyfill {
  const touchCount = options.targetTouches ?? (type === 'touchend' ? 0 : 1);
  const touch = new TouchPolyfill({ clientX: options.clientX, clientY: options.clientY });
  const touches = Array.from({ length: touchCount }, () => touch);

  const event = new TouchEventPolyfill(type, {
    cancelable: true,
    targetTouches: touches,
    timeStamp: options.timeStamp,
  });

  canvas.dispatchEvent(event);
  return event;
}

/** Simulate a full double-tap-drag gesture */
function doubleTapAndDrag(dragToY: number, tapX = 200, tapY = 300): void {
  // First tap down
  dispatchTouch('touchstart', { clientX: tapX, clientY: tapY });
  // First tap up
  dispatchTouch('touchend');
  // Second tap down
  dispatchTouch('touchstart', { clientX: tapX, clientY: tapY });
  // Drag
  dispatchTouch('touchmove', { clientX: tapX, clientY: dragToY });
}

beforeEach(async () => {
  jest.useFakeTimers();

  // Initial resolution corresponds roughly to zoom level 15 (resolution = 156543.03 / 2^z);
  // exact mapping isn't important for tests — we assert on ratios, not absolute numbers.
  currentResolution = 10;
  mockSetResolution = jest.fn((resolution: number) => {
    currentResolution = resolution;
  });
  mockBeginInteraction = jest.fn();
  mockEndInteraction = jest.fn();
  mockView = {
    padding: [0, 0, 0, 0],
    getCenter: () => [0, 0],
    setCenter: jest.fn(),
    calculateExtent: () => [0, 0, 0, 0],
    changed: jest.fn(),
    getRotation: () => 0,
    setRotation: jest.fn(),
    getResolution: () => currentResolution,
    setResolution: mockSetResolution,
    beginInteraction: mockBeginInteraction,
    endInteraction: mockEndInteraction,
  };

  doubleClickZoom = new MockDoubleClickZoom();
  dragPan = new MockDragPan();
  mockMap = {
    getView: () => mockView,
    getSize: () => [800, 600],
    getLayers: jest.fn() as unknown as IOlMap['getLayers'],
    getInteractions: () => ({
      getArray: () => [doubleClickZoom, dragPan],
    }),
    addLayer: jest.fn(),
    removeLayer: jest.fn(),
    updateSize: jest.fn(),
  };

  viewport = document.createElement('div');
  viewport.classList.add('ol-viewport');
  canvas = document.createElement('canvas');
  viewport.appendChild(canvas);
  document.body.appendChild(viewport);

  mockGetOlMap.mockResolvedValue(mockMap);

  window.ol = {
    Map: { prototype: { getView: jest.fn() } },
    interaction: { DoubleClickZoom: MockDoubleClickZoom, DragPan: MockDragPan },
  } as unknown as typeof window.ol;

  await ngrsZoom.init();
  await ngrsZoom.enable();
});

afterEach(async () => {
  await ngrsZoom.disable();
  viewport.remove();
  delete window.ol;
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe('ngrsZoom', () => {
  test('has correct module metadata', () => {
    expect(ngrsZoom.id).toBe('ngrsZoom');
    expect(ngrsZoom.category).toBe('map');
    expect(ngrsZoom.defaultEnabled).toBe(true);
  });

  function lastResolution(): number {
    const calls = mockSetResolution.mock.calls;
    return calls[calls.length - 1][0];
  }

  // Formula: newResolution = initialResolution * 2^(-deltaY * ZOOM_SENSITIVITY)
  // where deltaY = initialY - currentY. Positive deltaY (drag up) → smaller
  // resolution → zoom in. Tests run against currentResolution = 10 (see beforeEach).
  test('double-tap + drag up zooms in (resolution decreases)', () => {
    doubleTapAndDrag(200, 200, 300);

    expect(mockSetResolution).toHaveBeenCalled();
    expect(lastResolution()).toBeLessThan(10);
  });

  test('double-tap + drag down zooms out (resolution increases)', () => {
    doubleTapAndDrag(400, 200, 300);

    expect(mockSetResolution).toHaveBeenCalled();
    expect(lastResolution()).toBeGreaterThan(10);
  });

  test('drag 100px up = 1.5 zoom-level change (resolution × 2^-1.5)', () => {
    // deltaY = 100 → zoomDelta = 1.5 → resolution × 2^-1.5 ≈ 0.3536
    doubleTapAndDrag(200, 200, 300);

    expect(lastResolution()).toBeCloseTo(10 * Math.pow(2, -1.5), 5);
  });

  test('drag 100px down = 1.5 zoom-level change (resolution × 2^1.5)', () => {
    // deltaY = -100 → zoomDelta = -1.5 → resolution × 2^1.5 ≈ 2.8284
    doubleTapAndDrag(400, 200, 300);

    expect(lastResolution()).toBeCloseTo(10 * Math.pow(2, 1.5), 5);
  });

  test('drag 100/1.5 px up matches the old 100px effect (1.5× more sensitive)', () => {
    // 100/1.5 ≈ 66.67 px of finger travel should now produce the effect previously
    // requiring a full 100px (~1 zoom level, resolution halved).
    doubleTapAndDrag(300 - 200 / 3, 200, 300);

    expect(lastResolution()).toBeCloseTo(10 * Math.pow(2, -1), 5); // 5.0
  });

  test('zoom is proportional to drag distance', () => {
    doubleTapAndDrag(290, 200, 300);
    const smallDragResolution = lastResolution();

    dispatchTouch('touchend');
    mockSetResolution.mockClear();
    currentResolution = 10;

    doubleTapAndDrag(200, 200, 300);
    const largeDragResolution = lastResolution();

    // Larger drag up → bigger zoom in → smaller resolution
    expect(largeDragResolution).toBeLessThan(smallDragResolution);
  });

  test('non-integer resolution values are emitted (constrainResolution bypassed)', () => {
    // This is the whole point of using setResolution instead of setZoom: OL snaps
    // setZoom to integer levels when constrainResolution:true, which makes the map
    // jump in discrete steps. setResolution accepts any continuous value — we
    // verify that the emitted numbers are actually non-integer multiples so nothing
    // accidentally re-introduces snapping in our pipeline.
    doubleTapAndDrag(270, 200, 300); // deltaY = 30 → zoomDelta = 0.45

    const resolution = lastResolution();
    expect(Number.isInteger(resolution)).toBe(false);
    // And the value is between initial and full 1-level step (initialRes/2 = 5)
    expect(resolution).toBeGreaterThan(5);
    expect(resolution).toBeLessThan(10);
  });

  test('single tap does not trigger zoom', () => {
    dispatchTouch('touchstart', { clientX: 200, clientY: 300 });
    dispatchTouch('touchend');
    dispatchTouch('touchmove', { clientX: 200, clientY: 200 });

    expect(mockSetResolution).not.toHaveBeenCalled();
  });

  test('second tap too late resets to idle', () => {
    // First tap
    dispatchTouch('touchstart', { clientX: 200, clientY: 300 });
    dispatchTouch('touchend');

    // Wait beyond MAX_TAP_GAP
    jest.advanceTimersByTime(400);

    // Second tap — should be treated as new first tap, not double-tap
    dispatchTouch('touchstart', { clientX: 200, clientY: 300 });
    dispatchTouch('touchmove', { clientX: 200, clientY: 200 });

    expect(mockSetResolution).not.toHaveBeenCalled();
  });

  test('second tap too far from first resets to idle', () => {
    // First tap at (200, 300)
    dispatchTouch('touchstart', { clientX: 200, clientY: 300 });
    dispatchTouch('touchend');

    // Second tap far away — treated as new first tap
    dispatchTouch('touchstart', { clientX: 300, clientY: 400 });
    dispatchTouch('touchmove', { clientX: 300, clientY: 300 });

    expect(mockSetResolution).not.toHaveBeenCalled();
  });

  test('multi-finger touch resets gesture', () => {
    // Start double-tap
    dispatchTouch('touchstart', { clientX: 200, clientY: 300 });
    dispatchTouch('touchend');

    // Second tap with two fingers
    dispatchTouch('touchstart', { clientX: 200, clientY: 300, targetTouches: 2 });
    dispatchTouch('touchmove', { clientX: 200, clientY: 200 });

    expect(mockSetResolution).not.toHaveBeenCalled();
  });

  test('non-canvas target ignored', () => {
    // Dispatch from viewport div, not canvas
    const touch = new TouchPolyfill({ clientX: 200, clientY: 300 });
    const event = new TouchEventPolyfill('touchstart', {
      cancelable: true,
      targetTouches: [touch],
    });
    viewport.dispatchEvent(event);

    dispatchTouch('touchend');
    dispatchTouch('touchstart', { clientX: 200, clientY: 300 });
    dispatchTouch('touchmove', { clientX: 200, clientY: 200 });

    expect(mockSetResolution).not.toHaveBeenCalled();
  });

  test('touchend during secondTapDown without drag does not zoom', () => {
    dispatchTouch('touchstart', { clientX: 200, clientY: 300 });
    dispatchTouch('touchend');
    dispatchTouch('touchstart', { clientX: 200, clientY: 300 });
    // Touchend without any touchmove
    dispatchTouch('touchend');

    expect(mockSetResolution).not.toHaveBeenCalled();
  });

  test('enable disables DoubleClickZoom interactions', () => {
    expect(doubleClickZoom.getActive()).toBe(false);
  });

  test('disables DragPan when entering secondTapDown state', () => {
    // First tap
    dispatchTouch('touchstart', { clientX: 200, clientY: 300 });
    dispatchTouch('touchend');

    // Second tap — enters secondTapDown
    dispatchTouch('touchstart', { clientX: 200, clientY: 300 });

    expect(dragPan.getActive()).toBe(false);
  });

  test('restores DragPan on gesture reset', () => {
    // Enter secondTapDown
    dispatchTouch('touchstart', { clientX: 200, clientY: 300 });
    dispatchTouch('touchend');
    dispatchTouch('touchstart', { clientX: 200, clientY: 300 });
    expect(dragPan.getActive()).toBe(false);

    // Touchend resets gesture
    dispatchTouch('touchend');

    expect(dragPan.getActive()).toBe(true);
  });

  test('restores DragPan on module disable', async () => {
    // Enter zooming state
    doubleTapAndDrag(200, 200, 300);
    expect(dragPan.getActive()).toBe(false);

    await ngrsZoom.disable();

    expect(dragPan.getActive()).toBe(true);
  });

  test('disable re-enables DoubleClickZoom interactions', async () => {
    await ngrsZoom.disable();
    expect(doubleClickZoom.getActive()).toBe(true);
  });

  test('disable removes listeners and stops zooming', async () => {
    await ngrsZoom.disable();

    doubleTapAndDrag(200, 200, 300);

    expect(mockSetResolution).not.toHaveBeenCalled();
  });

  test('preventDefault called during zooming touchmove', () => {
    // First tap
    dispatchTouch('touchstart', { clientX: 200, clientY: 300 });
    dispatchTouch('touchend');
    // Second tap
    dispatchTouch('touchstart', { clientX: 200, clientY: 300 });
    // Move beyond threshold to enter zooming
    dispatchTouch('touchmove', { clientX: 200, clientY: 200 });

    // Now in zooming state — create event with spy before dispatch
    const touch = new TouchPolyfill({ clientX: 200, clientY: 190 });
    const event = new TouchEventPolyfill('touchmove', {
      cancelable: true,
      targetTouches: [touch],
    });
    const spy = jest.spyOn(event, 'preventDefault');
    canvas.dispatchEvent(event);

    expect(spy).toHaveBeenCalled();
  });

  test('touchmove during firstTapDown resets gesture', () => {
    dispatchTouch('touchstart', { clientX: 200, clientY: 300 });
    // Move finger — not a tap
    dispatchTouch('touchmove', { clientX: 200, clientY: 310 });
    dispatchTouch('touchend');

    // Try second tap — should be treated as new first tap
    dispatchTouch('touchstart', { clientX: 200, clientY: 300 });
    dispatchTouch('touchmove', { clientX: 200, clientY: 200 });

    expect(mockSetResolution).not.toHaveBeenCalled();
  });

  test('long first tap does not transition to waitingSecondTap', () => {
    const startTime = performance.now();
    dispatchTouch('touchstart', { clientX: 200, clientY: 300, timeStamp: startTime });

    // Simulate long press: touchend timeStamp на 250ms позже touchstart
    dispatchTouch('touchend', { timeStamp: startTime + 250 });

    // Second tap — should not work as double-tap
    dispatchTouch('touchstart', { clientX: 200, clientY: 300 });
    dispatchTouch('touchmove', { clientX: 200, clientY: 200 });

    expect(mockSetResolution).not.toHaveBeenCalled();
  });

  test('stopPropagation blocks events from reaching viewport listeners during gesture', () => {
    const viewportListener = jest.fn();
    viewport.addEventListener('touchmove', viewportListener);

    // Enter zooming state
    doubleTapAndDrag(200, 200, 300);

    // Viewport listener should NOT have received the touchmove during zooming
    // (stopPropagation in capture phase blocks it)
    expect(viewportListener).not.toHaveBeenCalled();

    viewport.removeEventListener('touchmove', viewportListener);
  });

  test('events reach viewport listeners when gesture is not active', () => {
    const viewportListener = jest.fn();
    viewport.addEventListener('touchstart', viewportListener);

    // First tap — not in active state yet
    dispatchTouch('touchstart', { clientX: 200, clientY: 300 });

    expect(viewportListener).toHaveBeenCalled();

    viewport.removeEventListener('touchstart', viewportListener);
  });

  test('two sequential gestures start from the current resolution', () => {
    // First gesture zooms in — resolution decreases
    doubleTapAndDrag(260, 200, 300);
    const firstResolution = lastResolution();
    expect(firstResolution).toBeLessThan(10);

    dispatchTouch('touchend');
    mockSetResolution.mockClear();

    // Second gesture starts from the NEW currentResolution, set by the first gesture
    doubleTapAndDrag(260, 200, 300);
    const secondResolution = lastResolution();
    // Same drag distance from the smaller starting point → even smaller result
    expect(secondResolution).toBeLessThan(firstResolution);
  });

  test('view without setResolution method does not crash and skips zoom', () => {
    mockView = { ...mockView, setResolution: undefined };
    (mockMap as { getView: () => IOlView }).getView = () => mockView;

    expect(() => {
      doubleTapAndDrag(200, 200, 300);
    }).not.toThrow();
  });

  test('view.getResolution returning undefined resets gesture without throwing', () => {
    mockView = { ...mockView, getResolution: () => undefined };
    (mockMap as { getView: () => IOlView }).getView = () => mockView;

    expect(() => {
      dispatchTouch('touchstart', { clientX: 200, clientY: 300 });
      dispatchTouch('touchend');
      dispatchTouch('touchstart', { clientX: 200, clientY: 300 });
      dispatchTouch('touchmove', { clientX: 200, clientY: 200 });
    }).not.toThrow();

    expect(mockSetResolution).not.toHaveBeenCalled();
  });

  // constrainResolution: true в игре заставляет resolution constraint снепить
  // непрерывные значения к целым zoom-уровням — НО только когда view не в
  // состоянии interacting. beginInteraction ставит hint INTERACTING, и во время
  // жеста constraint пропускает дробный resolution. endInteraction(duration)
  // плавно докручивает к ближайшему целому после touchend. Без этой пары
  // даже setResolution даёт ступенчатый зум.
  test('beginInteraction is called when entering secondTapDown', () => {
    dispatchTouch('touchstart', { clientX: 200, clientY: 300 });
    dispatchTouch('touchend');
    dispatchTouch('touchstart', { clientX: 200, clientY: 300 });

    expect(mockBeginInteraction).toHaveBeenCalledTimes(1);
  });

  test('endInteraction is called with non-zero duration when gesture resets', () => {
    doubleTapAndDrag(200, 200, 300);
    dispatchTouch('touchend');

    expect(mockEndInteraction).toHaveBeenCalledTimes(1);
    const duration = mockEndInteraction.mock.calls[0][0];
    expect(duration).toBeGreaterThan(0);
  });

  test('endInteraction is NOT called when interaction was never started', () => {
    // Single tap — never enters secondTapDown, so beginInteraction is not called
    dispatchTouch('touchstart', { clientX: 200, clientY: 300 });
    dispatchTouch('touchend');

    expect(mockBeginInteraction).not.toHaveBeenCalled();
    expect(mockEndInteraction).not.toHaveBeenCalled();
  });

  test('endInteraction is called exactly once per completed gesture', () => {
    doubleTapAndDrag(200, 200, 300);
    dispatchTouch('touchend');
    expect(mockEndInteraction).toHaveBeenCalledTimes(1);

    // Second gesture
    doubleTapAndDrag(220, 200, 300);
    dispatchTouch('touchend');
    expect(mockEndInteraction).toHaveBeenCalledTimes(2);
  });

  test('disable during active zoom calls endInteraction to release the hint', async () => {
    // Enter zooming state
    doubleTapAndDrag(200, 200, 300);
    expect(mockBeginInteraction).toHaveBeenCalled();

    await ngrsZoom.disable();

    // disable() must release the interaction hint, otherwise view stays stuck in
    // interacting state even though our listeners are already gone
    expect(mockEndInteraction).toHaveBeenCalled();
  });

  test('multi-finger touch during zoom releases interaction hint', () => {
    dispatchTouch('touchstart', { clientX: 200, clientY: 300 });
    dispatchTouch('touchend');
    dispatchTouch('touchstart', { clientX: 200, clientY: 300 });
    expect(mockBeginInteraction).toHaveBeenCalled();
    expect(mockEndInteraction).not.toHaveBeenCalled();

    // Second finger appears — gesture must reset AND release the hint
    dispatchTouch('touchstart', { clientX: 200, clientY: 300, targetTouches: 2 });

    expect(mockEndInteraction).toHaveBeenCalled();
  });

  test('view without beginInteraction method does not crash', () => {
    mockView = { ...mockView, beginInteraction: undefined, endInteraction: undefined };
    (mockMap as { getView: () => IOlView }).getView = () => mockView;

    expect(() => {
      doubleTapAndDrag(200, 200, 300);
      dispatchTouch('touchend');
    }).not.toThrow();
  });

  test('module description and name match expected user-facing text', () => {
    expect(ngrsZoom.name.ru).toBe('Нгрс-зум');
    expect(ngrsZoom.description.ru).toBe(
      'Двойной тап и перетаскивание вверх/вниз для зума. Заодно отключает стандартный зум по двойному тапу.',
    );
  });

  test('disable before map ready does not deactivate interaction', async () => {
    // Reset module state
    await ngrsZoom.disable();

    let resolveMap!: (map: IOlMap) => void;
    mockGetOlMap.mockReturnValue(
      new Promise((resolve) => {
        resolveMap = resolve;
      }),
    );

    const enablePromise = ngrsZoom.enable();
    await ngrsZoom.disable();

    // Re-create fresh interactions since previous ones were re-enabled
    const freshInteraction = new MockDoubleClickZoom();
    const freshDragPan = new MockDragPan();
    mockMap = {
      ...mockMap,
      getInteractions: () => ({
        getArray: () => [freshInteraction, freshDragPan],
      }),
    };
    resolveMap(mockMap);
    await enablePromise;

    expect(freshInteraction.getActive()).toBe(true);
  });
});
