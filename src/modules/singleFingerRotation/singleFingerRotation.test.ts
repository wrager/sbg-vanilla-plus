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

jest.mock('../../core/olMap', () => {
  const actual = jest.requireActual('../../core/olMap') as Record<string, unknown>;
  return {
    ...actual,
    getOlMap: jest.fn(),
  };
});

jest.mock('../../core/dom', () => ({
  waitForElement: jest.fn(),
}));

import { singleFingerRotation } from './singleFingerRotation';
import { getOlMap } from '../../core/olMap';
import { waitForElement } from '../../core/dom';

const mockGetOlMap = getOlMap as jest.MockedFunction<typeof getOlMap>;
const mockWaitForElement = waitForElement as jest.MockedFunction<typeof waitForElement>;

class MockDragPan implements IOlInteraction {
  private active = true;
  setActive(value: boolean): void {
    this.active = value;
  }
  getActive(): boolean {
    return this.active;
  }
}

let realSetRotation: jest.Mock;
let mockView: IOlView;
let mockMap: IOlMap;
let dragPan: MockDragPan;
let viewport: HTMLDivElement;
let canvas: HTMLCanvasElement;

function dispatchTouch(
  type: 'touchstart' | 'touchmove' | 'touchend',
  options: { clientX?: number; clientY?: number; targetTouches?: number } = {},
): void {
  const touchCount = options.targetTouches ?? 1;
  const touch = new TouchPolyfill({ clientX: options.clientX, clientY: options.clientY });
  const touches = Array.from({ length: touchCount }, () => touch);

  const event = new TouchEventPolyfill(type, {
    cancelable: true,
    targetTouches: touches,
  });

  canvas.dispatchEvent(event);
}

beforeEach(async () => {
  realSetRotation = jest.fn();
  let currentRotation = 0;
  mockView = {
    padding: [0, 0, 0, 0],
    getCenter: () => [0, 0],
    setCenter: jest.fn(),
    calculateExtent: (size?: number[]) => {
      if (size) return [-size[0] / 2, -size[1] / 2, size[0] / 2, size[1] / 2];
      return [0, 0, 0, 0];
    },
    changed: jest.fn(),
    getRotation: () => currentRotation,
    setRotation(rotation: number) {
      currentRotation = rotation;
      realSetRotation(rotation);
    },
    getZoom: () => 17,
  };
  dragPan = new MockDragPan();
  mockMap = {
    getView: () => mockView,
    getSize: () => [800, 600],
    getLayers: jest.fn() as unknown as IOlMap['getLayers'],
    getInteractions: () => ({ getArray: () => [dragPan] }),
    addLayer: jest.fn(),
    removeLayer: jest.fn(),
    updateSize: jest.fn(),
  };

  viewport = document.createElement('div');
  viewport.classList.add('ol-viewport');
  canvas = document.createElement('canvas');
  viewport.appendChild(canvas);
  document.body.appendChild(viewport);

  window.ol = {
    Map: { prototype: { getView: jest.fn() } },
    interaction: { DragPan: MockDragPan },
  } as unknown as typeof window.ol;

  mockWaitForElement.mockResolvedValue(viewport);
  mockGetOlMap.mockResolvedValue(mockMap);

  Object.defineProperty(window, 'innerWidth', { value: 800, writable: true });
  Object.defineProperty(window, 'innerHeight', { value: 600, writable: true });

  localStorage.clear();

  await singleFingerRotation.init();
  await singleFingerRotation.enable();
});

afterEach(async () => {
  await singleFingerRotation.disable();
  viewport.remove();
  delete window.ol;
});

test('does not rotate when FW is off', () => {
  localStorage.setItem('follow', 'false');

  dispatchTouch('touchstart', { clientX: 400, clientY: 100 });
  dispatchTouch('touchmove', { clientX: 500, clientY: 300 });

  expect(realSetRotation).not.toHaveBeenCalled();
});

test('does not rotate for non-canvas targets', () => {
  localStorage.setItem('follow', 'true');

  // Dispatch touchstart from viewport div, not canvas
  const touch = new TouchPolyfill({ clientX: 400, clientY: 100 });
  const event = new TouchEventPolyfill('touchstart', {
    cancelable: true,
    targetTouches: [touch],
  });
  viewport.dispatchEvent(event);

  dispatchTouch('touchmove', { clientX: 700, clientY: 300 });

  expect(realSetRotation).not.toHaveBeenCalled();
});

test('rotates map with circular gesture when FW is active', () => {
  localStorage.setItem('follow', 'true');

  dispatchTouch('touchstart', { clientX: 400, clientY: 100 });
  dispatchTouch('touchmove', { clientX: 700, clientY: 300 });

  expect(realSetRotation).toHaveBeenCalled();
});

test('resets gesture when second finger touches', () => {
  localStorage.setItem('follow', 'true');

  dispatchTouch('touchstart', { clientX: 400, clientY: 100 });
  dispatchTouch('touchmove', { clientX: 500, clientY: 200 });

  realSetRotation.mockClear();

  // Second finger
  dispatchTouch('touchstart', { clientX: 200, clientY: 200, targetTouches: 2 });
  dispatchTouch('touchmove', { clientX: 600, clientY: 400 });

  expect(realSetRotation).not.toHaveBeenCalled();
});

test('resets state on touchend', () => {
  localStorage.setItem('follow', 'true');

  dispatchTouch('touchstart', { clientX: 400, clientY: 100 });
  dispatchTouch('touchmove', { clientX: 700, clientY: 300 });
  dispatchTouch('touchend');

  realSetRotation.mockClear();

  dispatchTouch('touchmove', { clientX: 100, clientY: 300 });

  expect(realSetRotation).not.toHaveBeenCalled();
});

test('disable removes listeners and stops rotating', async () => {
  localStorage.setItem('follow', 'true');

  await singleFingerRotation.disable();

  dispatchTouch('touchstart', { clientX: 400, clientY: 100 });
  dispatchTouch('touchmove', { clientX: 700, clientY: 300 });

  expect(realSetRotation).not.toHaveBeenCalled();
});

test('inflates calculateExtent to viewport diagonal when enabled', () => {
  const size = [800, 600];
  const extent = mockView.calculateExtent(size);

  // diagonal = ceil(sqrt(800² + 600²)) = 1000
  expect(extent[2] - extent[0]).toBe(1000);
  expect(extent[3] - extent[1]).toBe(1000);
});

test('does not inflate calculateExtent when disabled', async () => {
  await singleFingerRotation.disable();

  const size = [800, 600];
  const extent = mockView.calculateExtent(size);

  expect(extent[2] - extent[0]).toBe(800);
  expect(extent[3] - extent[1]).toBe(600);
});

test('passes through calculateExtent without size argument', () => {
  const extent = mockView.calculateExtent();
  expect(extent).toEqual([0, 0, 0, 0]);
});

test('accounts for view padding when calculating rotation center', () => {
  localStorage.setItem('follow', 'true');

  mockView.padding = [210, 0, 0, 0];

  dispatchTouch('touchstart', { clientX: 400, clientY: 205 });
  dispatchTouch('touchmove', { clientX: 600, clientY: 405 });

  expect(realSetRotation).toHaveBeenCalled();
  const firstCall = realSetRotation.mock.calls[0] as [number];
  const rotation = firstCall[0];

  // With padding-aware center (400, 405):
  // Start: atan2(205-405, 400-400) = -PI/2
  // End: atan2(405-405, 600-400) = 0
  // Delta = PI/2
  expect(rotation).toBeCloseTo(Math.PI / 2, 1);
});

test('disables DragPan during rotation gesture in follow mode', () => {
  localStorage.setItem('follow', 'true');

  dispatchTouch('touchstart', { clientX: 400, clientY: 100 });

  expect(dragPan.getActive()).toBe(false);
});

test('restores DragPan on touchend', () => {
  localStorage.setItem('follow', 'true');

  dispatchTouch('touchstart', { clientX: 400, clientY: 100 });
  dispatchTouch('touchmove', { clientX: 700, clientY: 300 });
  dispatchTouch('touchend');

  expect(dragPan.getActive()).toBe(true);
});

test('restores DragPan on disable', async () => {
  localStorage.setItem('follow', 'true');

  dispatchTouch('touchstart', { clientX: 400, clientY: 100 });
  expect(dragPan.getActive()).toBe(false);

  await singleFingerRotation.disable();

  expect(dragPan.getActive()).toBe(true);
});

test('does not disable DragPan when follow mode is off', () => {
  localStorage.setItem('follow', 'false');

  dispatchTouch('touchstart', { clientX: 400, clientY: 100 });

  expect(dragPan.getActive()).toBe(true);
});

test('preventDefault is called on touchmove during gesture', () => {
  localStorage.setItem('follow', 'true');

  dispatchTouch('touchstart', { clientX: 400, clientY: 100 });

  const touch = new TouchPolyfill({ clientX: 700, clientY: 300 });
  const event = new TouchEventPolyfill('touchmove', {
    cancelable: true,
    targetTouches: [touch],
  });
  const spy = jest.spyOn(event, 'preventDefault');
  canvas.dispatchEvent(event);

  expect(spy).toHaveBeenCalled();
});
