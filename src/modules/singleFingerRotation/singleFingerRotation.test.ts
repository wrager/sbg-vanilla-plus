import type { IOlMap, IOlView } from '../../core/olMap';

// jsdom does not implement PointerEvent — polyfill with the properties we need
class PointerEventPolyfill extends MouseEvent {
  readonly pointerId: number;
  readonly pointerType: string;
  constructor(
    type: string,
    init: PointerEventInit & { pointerId?: number; pointerType?: string } = {},
  ) {
    super(type, init);
    this.pointerId = init.pointerId ?? 0;
    this.pointerType = init.pointerType ?? '';
  }
}
if (typeof globalThis.PointerEvent === 'undefined') {
  (globalThis as Record<string, unknown>).PointerEvent = PointerEventPolyfill;
}

jest.mock('../../core/olMap', () => ({
  getOlMap: jest.fn(),
}));

jest.mock('../../core/dom', () => ({
  waitForElement: jest.fn(),
}));

import { singleFingerRotation } from './singleFingerRotation';
import { getOlMap } from '../../core/olMap';
import { waitForElement } from '../../core/dom';

const mockGetOlMap = getOlMap as jest.MockedFunction<typeof getOlMap>;
const mockWaitForElement = waitForElement as jest.MockedFunction<typeof waitForElement>;

let realSetRotation: jest.Mock;
let mockView: IOlView;
let mockMap: IOlMap;
let viewport: HTMLDivElement;

function dispatchTouch(
  type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel',
  options: { clientX: number; clientY: number; pointerId?: number },
): void {
  const event = new PointerEvent(type, {
    pointerType: 'touch',
    pointerId: options.pointerId ?? 1,
    clientX: options.clientX,
    clientY: options.clientY,
    bubbles: true,
  });
  viewport.dispatchEvent(event);
}

function dispatchMouse(
  type: 'pointerdown' | 'pointermove' | 'pointerup',
  options: { clientX: number; clientY: number },
): void {
  const event = new PointerEvent(type, {
    pointerType: 'mouse',
    pointerId: 1,
    clientX: options.clientX,
    clientY: options.clientY,
    bubbles: true,
  });
  viewport.dispatchEvent(event);
}

beforeEach(async () => {
  realSetRotation = jest.fn();
  let currentRotation = 0;
  mockView = {
    padding: [0, 0, 0, 0],
    getCenter: () => [0, 0],
    setCenter: jest.fn(),
    calculateExtent: () => [0, 0, 0, 0],
    changed: jest.fn(),
    getRotation: () => currentRotation,
    setRotation(rotation: number) {
      currentRotation = rotation;
      realSetRotation(rotation);
    },
  };
  mockMap = {
    getView: () => mockView,
    getSize: () => [800, 600],
    getLayers: jest.fn() as unknown as IOlMap['getLayers'],
    getInteractions: () => ({ getArray: () => [] }),
    addLayer: jest.fn(),
    removeLayer: jest.fn(),
    updateSize: jest.fn(),
  };

  viewport = document.createElement('div');
  viewport.classList.add('ol-viewport');
  document.body.appendChild(viewport);

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
});

test('does not rotate when FW is off', () => {
  localStorage.setItem('follow', 'false');

  dispatchTouch('pointerdown', { clientX: 400, clientY: 100 });
  dispatchTouch('pointermove', { clientX: 500, clientY: 300 });

  expect(realSetRotation).not.toHaveBeenCalled();
});

test('does not rotate for mouse events', () => {
  localStorage.setItem('follow', 'true');

  dispatchMouse('pointerdown', { clientX: 400, clientY: 100 });
  dispatchMouse('pointermove', { clientX: 500, clientY: 300 });

  expect(realSetRotation).not.toHaveBeenCalled();
});

test('rotates map with circular gesture when FW is active', () => {
  localStorage.setItem('follow', 'true');

  dispatchTouch('pointerdown', { clientX: 400, clientY: 100 });
  dispatchTouch('pointermove', { clientX: 700, clientY: 300 });

  expect(realSetRotation).toHaveBeenCalled();
});

test('rotates even with small movement', () => {
  localStorage.setItem('follow', 'true');

  dispatchTouch('pointerdown', { clientX: 700, clientY: 300 });
  dispatchTouch('pointermove', { clientX: 701, clientY: 300 });

  expect(realSetRotation).toHaveBeenCalled();
});

test('ignores second finger', () => {
  localStorage.setItem('follow', 'true');

  dispatchTouch('pointerdown', { clientX: 400, clientY: 100, pointerId: 1 });

  dispatchTouch('pointerdown', { clientX: 200, clientY: 200, pointerId: 2 });
  dispatchTouch('pointermove', { clientX: 300, clientY: 400, pointerId: 2 });

  expect(realSetRotation).not.toHaveBeenCalled();
});

test('resets state on pointerup', () => {
  localStorage.setItem('follow', 'true');

  dispatchTouch('pointerdown', { clientX: 400, clientY: 100 });
  dispatchTouch('pointermove', { clientX: 700, clientY: 300 });
  dispatchTouch('pointerup', { clientX: 700, clientY: 300 });

  realSetRotation.mockClear();

  dispatchTouch('pointermove', { clientX: 100, clientY: 300 });

  expect(realSetRotation).not.toHaveBeenCalled();
});

test('resets state on pointercancel', () => {
  localStorage.setItem('follow', 'true');

  dispatchTouch('pointerdown', { clientX: 400, clientY: 100 });
  dispatchTouch('pointercancel', { clientX: 400, clientY: 100 });

  realSetRotation.mockClear();

  dispatchTouch('pointermove', { clientX: 700, clientY: 300 });

  expect(realSetRotation).not.toHaveBeenCalled();
});

test('disable removes listeners and stops rotating', async () => {
  localStorage.setItem('follow', 'true');

  await singleFingerRotation.disable();

  dispatchTouch('pointerdown', { clientX: 400, clientY: 100 });
  dispatchTouch('pointermove', { clientX: 700, clientY: 300 });

  expect(realSetRotation).not.toHaveBeenCalled();
});

test('blocks external setRotation calls during gesture', () => {
  localStorage.setItem('follow', 'true');

  dispatchTouch('pointerdown', { clientX: 400, clientY: 100 });
  dispatchTouch('pointermove', { clientX: 700, clientY: 300 });

  realSetRotation.mockClear();

  // Simulate game's FW resetting rotation to 0
  mockView.setRotation(0);

  // The external call should be blocked (no-op)
  expect(realSetRotation).not.toHaveBeenCalled();
});

test('restores setRotation after gesture ends', () => {
  localStorage.setItem('follow', 'true');

  dispatchTouch('pointerdown', { clientX: 400, clientY: 100 });
  dispatchTouch('pointerup', { clientX: 400, clientY: 100 });

  realSetRotation.mockClear();

  // After gesture, external setRotation should work again
  mockView.setRotation(1.5);

  expect(realSetRotation).toHaveBeenCalledWith(1.5);
});

test('injects touch-action style when enabled', () => {
  const style = document.querySelector('style');
  expect(style).not.toBeNull();
  expect(style?.textContent).toContain('touch-action: none');
});

test('removes touch-action style on disable', async () => {
  await singleFingerRotation.disable();
  const styles = document.querySelectorAll('style');
  const hasTouchAction = Array.from(styles).some((s) =>
    s.textContent.includes('touch-action: none'),
  );
  expect(hasTouchAction).toBe(false);
});

test('accounts for view padding when calculating rotation center', () => {
  localStorage.setItem('follow', 'true');

  mockView.padding = [210, 0, 0, 0];

  dispatchTouch('pointerdown', { clientX: 400, clientY: 205 });
  dispatchTouch('pointermove', { clientX: 600, clientY: 405 });

  expect(realSetRotation).toHaveBeenCalled();
  const firstCall = realSetRotation.mock.calls[0] as [number];
  const rotation = firstCall[0];

  // With padding-aware center (400, 405):
  // Start: atan2(205-405, 400-400) = -PI/2
  // End: atan2(405-405, 600-400) = 0
  // Delta = PI/2
  expect(rotation).toBeCloseTo(Math.PI / 2, 1);
});
