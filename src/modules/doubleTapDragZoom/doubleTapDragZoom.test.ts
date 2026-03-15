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
  constructor(type: string, init: { cancelable?: boolean; targetTouches?: TouchPolyfill[] } = {}) {
    super(type, { bubbles: true, cancelable: init.cancelable });
    this.targetTouches = init.targetTouches ?? [];
  }
}

if (typeof globalThis.TouchEvent === 'undefined') {
  (globalThis as Record<string, unknown>).TouchEvent = TouchEventPolyfill;
}

jest.mock('../../core/olMap', () => ({
  getOlMap: jest.fn(),
}));

jest.mock('../../core/dom', () => ({
  waitForElement: jest.fn(),
}));

import { doubleTapDragZoom } from './doubleTapDragZoom';
import { getOlMap } from '../../core/olMap';
import { waitForElement } from '../../core/dom';

const mockGetOlMap = getOlMap as jest.MockedFunction<typeof getOlMap>;
const mockWaitForElement = waitForElement as jest.MockedFunction<typeof waitForElement>;

class MockDoubleClickZoom implements IOlInteraction {
  private active = true;
  setActive(value: boolean): void {
    this.active = value;
  }
  getActive(): boolean {
    return this.active;
  }
}

let mockSetZoom: jest.Mock;
let currentZoom: number;
let mockView: IOlView;
let mockMap: IOlMap;
let doubleClickZoom: MockDoubleClickZoom;
let viewport: HTMLDivElement;
let canvas: HTMLCanvasElement;

function dispatchTouch(
  type: 'touchstart' | 'touchmove' | 'touchend',
  options: { clientX?: number; clientY?: number; targetTouches?: number } = {},
): TouchEventPolyfill {
  const touchCount = options.targetTouches ?? (type === 'touchend' ? 0 : 1);
  const touch = new TouchPolyfill({ clientX: options.clientX, clientY: options.clientY });
  const touches = Array.from({ length: touchCount }, () => touch);

  const event = new TouchEventPolyfill(type, {
    cancelable: true,
    targetTouches: touches,
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

  currentZoom = 15;
  mockSetZoom = jest.fn((zoom: number) => {
    currentZoom = zoom;
  });
  mockView = {
    padding: [0, 0, 0, 0],
    getCenter: () => [0, 0],
    setCenter: jest.fn(),
    calculateExtent: () => [0, 0, 0, 0],
    changed: jest.fn(),
    getRotation: () => 0,
    setRotation: jest.fn(),
    getZoom: () => currentZoom,
    setZoom: mockSetZoom,
  };

  doubleClickZoom = new MockDoubleClickZoom();
  mockMap = {
    getView: () => mockView,
    getSize: () => [800, 600],
    getLayers: jest.fn() as unknown as IOlMap['getLayers'],
    getInteractions: () => ({
      getArray: () => [doubleClickZoom],
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

  mockWaitForElement.mockResolvedValue(viewport);
  mockGetOlMap.mockResolvedValue(mockMap);

  window.ol = {
    Map: { prototype: { getView: jest.fn() } },
    interaction: { DoubleClickZoom: MockDoubleClickZoom },
  } as unknown as typeof window.ol;

  await doubleTapDragZoom.init();
  await doubleTapDragZoom.enable();
});

afterEach(async () => {
  await doubleTapDragZoom.disable();
  viewport.remove();
  delete window.ol;
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe('doubleTapDragZoom', () => {
  test('has correct module metadata', () => {
    expect(doubleTapDragZoom.id).toBe('doubleTapDragZoom');
    expect(doubleTapDragZoom.category).toBe('map');
    expect(doubleTapDragZoom.defaultEnabled).toBe(true);
  });

  test('double-tap + drag up zooms in', () => {
    // Drag up: currentY < initialY → positive zoom delta
    doubleTapAndDrag(200, 200, 300);

    expect(mockSetZoom).toHaveBeenCalled();
    const lastCall = mockSetZoom.mock.calls[mockSetZoom.mock.calls.length - 1] as [number];
    expect(lastCall[0]).toBeGreaterThan(15);
  });

  test('double-tap + drag down zooms out', () => {
    // Drag down: currentY > initialY → negative zoom delta
    doubleTapAndDrag(400, 200, 300);

    expect(mockSetZoom).toHaveBeenCalled();
    const lastCall = mockSetZoom.mock.calls[mockSetZoom.mock.calls.length - 1] as [number];
    expect(lastCall[0]).toBeLessThan(15);
  });

  test('zoom is proportional to drag distance', () => {
    // Small drag
    doubleTapAndDrag(290, 200, 300);
    const smallDragCalls = Array.from(mockSetZoom.mock.calls) as [number][];

    // Reset
    dispatchTouch('touchend');
    mockSetZoom.mockClear();
    currentZoom = 15;

    // Large drag
    doubleTapAndDrag(200, 200, 300);
    const largeDragCalls = Array.from(mockSetZoom.mock.calls) as [number][];

    const smallZoom = smallDragCalls[smallDragCalls.length - 1][0];
    const largeZoom = largeDragCalls[largeDragCalls.length - 1][0];
    expect(largeZoom).toBeGreaterThan(smallZoom);
  });

  test('single tap does not trigger zoom', () => {
    dispatchTouch('touchstart', { clientX: 200, clientY: 300 });
    dispatchTouch('touchend');
    dispatchTouch('touchmove', { clientX: 200, clientY: 200 });

    expect(mockSetZoom).not.toHaveBeenCalled();
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

    expect(mockSetZoom).not.toHaveBeenCalled();
  });

  test('second tap too far from first resets to idle', () => {
    // First tap at (200, 300)
    dispatchTouch('touchstart', { clientX: 200, clientY: 300 });
    dispatchTouch('touchend');

    // Second tap far away — treated as new first tap
    dispatchTouch('touchstart', { clientX: 300, clientY: 400 });
    dispatchTouch('touchmove', { clientX: 300, clientY: 300 });

    expect(mockSetZoom).not.toHaveBeenCalled();
  });

  test('multi-finger touch resets gesture', () => {
    // Start double-tap
    dispatchTouch('touchstart', { clientX: 200, clientY: 300 });
    dispatchTouch('touchend');

    // Second tap with two fingers
    dispatchTouch('touchstart', { clientX: 200, clientY: 300, targetTouches: 2 });
    dispatchTouch('touchmove', { clientX: 200, clientY: 200 });

    expect(mockSetZoom).not.toHaveBeenCalled();
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

    expect(mockSetZoom).not.toHaveBeenCalled();
  });

  test('touchend during secondTapDown without drag does not zoom', () => {
    dispatchTouch('touchstart', { clientX: 200, clientY: 300 });
    dispatchTouch('touchend');
    dispatchTouch('touchstart', { clientX: 200, clientY: 300 });
    // Touchend without any touchmove
    dispatchTouch('touchend');

    expect(mockSetZoom).not.toHaveBeenCalled();
  });

  test('enable disables DoubleClickZoom interactions', () => {
    expect(doubleClickZoom.getActive()).toBe(false);
  });

  test('disable re-enables DoubleClickZoom interactions', async () => {
    await doubleTapDragZoom.disable();
    expect(doubleClickZoom.getActive()).toBe(true);
  });

  test('disable removes listeners and stops zooming', async () => {
    await doubleTapDragZoom.disable();

    doubleTapAndDrag(200, 200, 300);

    expect(mockSetZoom).not.toHaveBeenCalled();
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

    expect(mockSetZoom).not.toHaveBeenCalled();
  });

  test('long first tap does not transition to waitingSecondTap', () => {
    dispatchTouch('touchstart', { clientX: 200, clientY: 300 });

    // Simulate long press by advancing time beyond TAP_DURATION_THRESHOLD
    jest.advanceTimersByTime(250);

    dispatchTouch('touchend');

    // Second tap — should not work as double-tap
    dispatchTouch('touchstart', { clientX: 200, clientY: 300 });
    dispatchTouch('touchmove', { clientX: 200, clientY: 200 });

    expect(mockSetZoom).not.toHaveBeenCalled();
  });

  test('disable before map ready does not deactivate interaction', async () => {
    // Reset module state
    await doubleTapDragZoom.disable();

    let resolveMap!: (map: IOlMap) => void;
    mockGetOlMap.mockReturnValue(
      new Promise((resolve) => {
        resolveMap = resolve;
      }),
    );

    const enablePromise = doubleTapDragZoom.enable();
    await doubleTapDragZoom.disable();

    // Re-create fresh interaction since previous one was re-enabled
    const freshInteraction = new MockDoubleClickZoom();
    mockMap = {
      ...mockMap,
      getInteractions: () => ({
        getArray: () => [freshInteraction],
      }),
    };
    resolveMap(mockMap);
    await enablePromise;

    expect(freshInteraction.getActive()).toBe(true);
  });
});
