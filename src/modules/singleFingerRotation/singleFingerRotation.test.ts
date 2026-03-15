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

let setRotationMock: jest.Mock;
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
  setRotationMock = jest.fn();
  mockView = {
    padding: [0, 0, 0, 0],
    getCenter: () => [0, 0],
    setCenter: jest.fn(),
    calculateExtent: () => [0, 0, 0, 0],
    changed: jest.fn(),
    getRotation: () => 0,
    setRotation: setRotationMock,
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

test('does not rotate when Follow Walker is off', () => {
  localStorage.setItem('follow', 'false');

  dispatchTouch('pointerdown', { clientX: 400, clientY: 100 });
  dispatchTouch('pointermove', { clientX: 500, clientY: 300 });

  expect(setRotationMock).not.toHaveBeenCalled();
});

test('does not rotate for mouse events', () => {
  localStorage.setItem('follow', 'true');

  dispatchMouse('pointerdown', { clientX: 400, clientY: 100 });
  dispatchMouse('pointermove', { clientX: 500, clientY: 300 });

  expect(setRotationMock).not.toHaveBeenCalled();
});

test('rotates map with circular gesture when FW is active', () => {
  localStorage.setItem('follow', 'true');

  // Touch at top-center (above screen center)
  dispatchTouch('pointerdown', { clientX: 400, clientY: 100 });

  // Move to the right side
  dispatchTouch('pointermove', { clientX: 700, clientY: 300 });

  expect(setRotationMock).toHaveBeenCalled();
});

test('rotates even with small movement', () => {
  localStorage.setItem('follow', 'true');

  dispatchTouch('pointerdown', { clientX: 700, clientY: 300 });
  dispatchTouch('pointermove', { clientX: 701, clientY: 300 });

  expect(setRotationMock).toHaveBeenCalled();
});

test('ignores second finger', () => {
  localStorage.setItem('follow', 'true');

  dispatchTouch('pointerdown', { clientX: 400, clientY: 100, pointerId: 1 });

  // Second finger down — should be ignored
  dispatchTouch('pointerdown', { clientX: 200, clientY: 200, pointerId: 2 });
  dispatchTouch('pointermove', { clientX: 300, clientY: 400, pointerId: 2 });

  expect(setRotationMock).not.toHaveBeenCalled();
});

test('resets state on pointerup', () => {
  localStorage.setItem('follow', 'true');

  dispatchTouch('pointerdown', { clientX: 400, clientY: 100 });
  dispatchTouch('pointermove', { clientX: 700, clientY: 300 });
  dispatchTouch('pointerup', { clientX: 700, clientY: 300 });

  setRotationMock.mockClear();

  // New gesture should start fresh — this move alone should not rotate
  // because there is no active pointerdown
  dispatchTouch('pointermove', { clientX: 100, clientY: 300 });

  expect(setRotationMock).not.toHaveBeenCalled();
});

test('resets state on pointercancel', () => {
  localStorage.setItem('follow', 'true');

  dispatchTouch('pointerdown', { clientX: 400, clientY: 100 });
  dispatchTouch('pointercancel', { clientX: 400, clientY: 100 });

  setRotationMock.mockClear();

  dispatchTouch('pointermove', { clientX: 700, clientY: 300 });

  expect(setRotationMock).not.toHaveBeenCalled();
});

test('disable removes listeners and stops rotating', async () => {
  localStorage.setItem('follow', 'true');

  await singleFingerRotation.disable();

  dispatchTouch('pointerdown', { clientX: 400, clientY: 100 });
  dispatchTouch('pointermove', { clientX: 700, clientY: 300 });

  expect(setRotationMock).not.toHaveBeenCalled();
});

test('does not block pointerdown propagation to preserve double-tap zoom', () => {
  localStorage.setItem('follow', 'true');

  const propagationSpy = jest.fn();
  viewport.addEventListener('pointerdown', propagationSpy);

  dispatchTouch('pointerdown', { clientX: 400, clientY: 100 });

  expect(propagationSpy).toHaveBeenCalled();

  viewport.removeEventListener('pointerdown', propagationSpy);
});

test('stops propagation of pointermove when rotation is active', () => {
  localStorage.setItem('follow', 'true');

  const propagationSpy = jest.fn();
  viewport.addEventListener('pointermove', propagationSpy);

  dispatchTouch('pointerdown', { clientX: 400, clientY: 100 });
  dispatchTouch('pointermove', { clientX: 700, clientY: 300 });

  // The bubble-phase listener should not receive the event
  expect(propagationSpy).not.toHaveBeenCalled();

  viewport.removeEventListener('pointermove', propagationSpy);
});
