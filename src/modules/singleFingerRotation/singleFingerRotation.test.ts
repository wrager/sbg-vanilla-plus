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
  const actual: Record<string, unknown> = jest.requireActual('../../core/olMap');
  return {
    ...actual,
    getOlMap: jest.fn(),
  };
});

import { singleFingerRotation } from './singleFingerRotation';
import { getOlMap } from '../../core/olMap';

const mockGetOlMap = getOlMap as jest.MockedFunction<typeof getOlMap>;

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

  mockGetOlMap.mockResolvedValue(mockMap);

  Object.defineProperty(window, 'innerWidth', { value: 800, writable: true });
  Object.defineProperty(window, 'innerHeight', { value: 600, writable: true });

  localStorage.clear();

  jest.useFakeTimers();
  jest.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    return setTimeout(callback, 0) as unknown as number;
  });
  jest.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
    clearTimeout(id);
  });

  await singleFingerRotation.init();
  await singleFingerRotation.enable();
});

function flushAnimationFrame(): void {
  jest.advanceTimersByTime(0);
}

afterEach(async () => {
  await singleFingerRotation.disable();
  viewport.remove();
  delete window.ol;
  jest.restoreAllMocks();
  jest.useRealTimers();
});

test('enable() оборачивает calculateExtent, disable() восстанавливает by-reference', async () => {
  // beforeEach уже сделал init+enable и afterEach сделает disable.
  // Сейчас calculateExtent уже обёрнут; проверим что wrapper расширяет до диагонали.
  const size: [number, number] = [400, 300];
  const diagonal = Math.ceil(Math.sqrt(size[0] ** 2 + size[1] ** 2));
  const extent = mockView.calculateExtent(size);
  expect(extent[2] - extent[0]).toBe(diagonal);
  expect(extent[3] - extent[1]).toBe(diagonal);

  // disable — и calculateExtent проходит без модификации.
  await singleFingerRotation.disable();
  const passthrough = mockView.calculateExtent(size);
  expect(passthrough[2] - passthrough[0]).toBe(size[0]);
  expect(passthrough[3] - passthrough[1]).toBe(size[1]);
});

test('rotates when follow is not explicitly set (default state)', () => {
  // При первой загрузке игры localStorage.follow === null.
  // Игра считает follow активным по умолчанию (null != 'false').
  dispatchTouch('touchstart', { clientX: 400, clientY: 100 });
  dispatchTouch('touchmove', { clientX: 700, clientY: 300 });
  flushAnimationFrame();

  expect(realSetRotation).toHaveBeenCalled();
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
  flushAnimationFrame();

  expect(realSetRotation).toHaveBeenCalled();
});

test('resets gesture when second finger touches', () => {
  localStorage.setItem('follow', 'true');

  dispatchTouch('touchstart', { clientX: 400, clientY: 100 });
  dispatchTouch('touchmove', { clientX: 500, clientY: 200 });
  flushAnimationFrame();

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
  flushAnimationFrame();

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

test('does not apply rotation synchronously on touchmove', () => {
  dispatchTouch('touchstart', { clientX: 400, clientY: 100 });
  dispatchTouch('touchmove', { clientX: 700, clientY: 300 });

  expect(realSetRotation).not.toHaveBeenCalled();
});

test('applies rotation after animation frame fires', () => {
  dispatchTouch('touchstart', { clientX: 400, clientY: 100 });
  dispatchTouch('touchmove', { clientX: 700, clientY: 300 });

  expect(realSetRotation).not.toHaveBeenCalled();

  flushAnimationFrame();

  expect(realSetRotation).toHaveBeenCalledTimes(1);
});

test('batches multiple touchmove events into single rotation update', () => {
  dispatchTouch('touchstart', { clientX: 400, clientY: 100 });
  dispatchTouch('touchmove', { clientX: 500, clientY: 150 });
  dispatchTouch('touchmove', { clientX: 600, clientY: 200 });
  dispatchTouch('touchmove', { clientX: 700, clientY: 300 });

  expect(realSetRotation).not.toHaveBeenCalled();

  flushAnimationFrame();

  expect(realSetRotation).toHaveBeenCalledTimes(1);
});

test('flushes pending rotation on touchend without waiting for RAF', () => {
  dispatchTouch('touchstart', { clientX: 400, clientY: 100 });
  dispatchTouch('touchmove', { clientX: 700, clientY: 300 });

  expect(realSetRotation).not.toHaveBeenCalled();

  dispatchTouch('touchend');

  expect(realSetRotation).toHaveBeenCalledTimes(1);
});

test('flushes pending rotation on multi-touch interrupt', () => {
  dispatchTouch('touchstart', { clientX: 400, clientY: 100 });
  dispatchTouch('touchmove', { clientX: 700, clientY: 300 });

  expect(realSetRotation).not.toHaveBeenCalled();

  // Второй палец прерывает жест — pending дельта должна быть применена
  dispatchTouch('touchstart', { clientX: 200, clientY: 200, targetTouches: 2 });

  expect(realSetRotation).toHaveBeenCalledTimes(1);
});

test('flushes pending rotation on disable', async () => {
  dispatchTouch('touchstart', { clientX: 400, clientY: 100 });
  dispatchTouch('touchmove', { clientX: 700, clientY: 300 });

  expect(realSetRotation).not.toHaveBeenCalled();

  await singleFingerRotation.disable();

  expect(realSetRotation).toHaveBeenCalledTimes(1);
});

describe('singleFingerRotation: подавление во время нативного жеста ngrsZoom', () => {
  // SBG 0.6.1 встроил `ol.interaction.DblClickDragZoom` (refs/game/script.js:782) —
  // двойной тап с удержанием второго пальца + drag → зум. Чтобы не активировать
  // rotation параллельно с зумом, после второго тапа в окне double-tap (300мс/30px)
  // вся серия touch до touchend полностью игнорируется — независимо от направления
  // drag. Прошлая реализация (модуль ngrsZoom + singleFingerRotation) делала так
  // же: после двойного тапа карту нельзя было поворачивать.

  function simulateDoubleTapStart(secondTapX = 100, secondTapY = 100): void {
    // Первый тап: touchstart → touchend на одной точке (без drag).
    dispatchTouch('touchstart', { clientX: secondTapX, clientY: secondTapY });
    dispatchTouch('touchend', { clientX: secondTapX, clientY: secondTapY });
    // Второй тап в окне double-tap: новый touchstart почти на том же месте.
    dispatchTouch('touchstart', { clientX: secondTapX, clientY: secondTapY });
  }

  test('одиночный тап → drag активирует rotation (текущее поведение не сломано)', () => {
    realSetRotation.mockClear();
    dispatchTouch('touchstart', { clientX: 100, clientY: 100 });
    dispatchTouch('touchmove', { clientX: 200, clientY: 200 });
    flushAnimationFrame();
    expect(realSetRotation).toHaveBeenCalled();
  });

  test('double-tap + вертикальный drag: rotation НЕ активируется', () => {
    realSetRotation.mockClear();
    simulateDoubleTapStart(100, 100);
    dispatchTouch('touchmove', { clientX: 100, clientY: 200 });
    flushAnimationFrame();
    expect(realSetRotation).not.toHaveBeenCalled();
    expect(dragPan.getActive()).toBe(true); // dragPan не отключался
  });

  test('double-tap + горизонтальный drag: rotation тоже НЕ активируется', () => {
    // Раньше горизонтальный drag после double-tap пытался late-стартовать rotation,
    // что ошибочно срабатывало для зум-жестов с лёгким горизонтальным дрейфом.
    realSetRotation.mockClear();
    simulateDoubleTapStart(100, 100);
    dispatchTouch('touchmove', { clientX: 200, clientY: 100 });
    flushAnimationFrame();
    expect(realSetRotation).not.toHaveBeenCalled();
    expect(dragPan.getActive()).toBe(true);
  });

  test('double-tap + диагональный drag: rotation тоже НЕ активируется', () => {
    realSetRotation.mockClear();
    simulateDoubleTapStart(100, 100);
    dispatchTouch('touchmove', { clientX: 150, clientY: 150 });
    flushAnimationFrame();
    expect(realSetRotation).not.toHaveBeenCalled();
    expect(dragPan.getActive()).toBe(true);
  });

  test('tap → пауза > 300мс → tap → drag: окно double-tap истекло, rotation активируется', () => {
    realSetRotation.mockClear();
    dispatchTouch('touchstart', { clientX: 100, clientY: 100 });
    dispatchTouch('touchend', { clientX: 100, clientY: 100 });

    // Прошло 350мс — окно истекло.
    jest.setSystemTime(Date.now() + 350);

    dispatchTouch('touchstart', { clientX: 100, clientY: 100 });
    dispatchTouch('touchmove', { clientX: 200, clientY: 200 });
    flushAnimationFrame();
    expect(realSetRotation).toHaveBeenCalled();
  });

  test('tap → tap > 30px от первого: НЕ считается double-tap, rotation активируется сразу', () => {
    // Активацию rotation проверяем через `dragPan.getActive() === false` —
    // singleFingerRotation отключает DragPan ровно в момент start-rotation.
    dispatchTouch('touchstart', { clientX: 100, clientY: 100 });
    dispatchTouch('touchend', { clientX: 100, clientY: 100 });
    // Второй тап на 100px правее — слишком далеко для double-tap.
    dispatchTouch('touchstart', { clientX: 200, clientY: 100 });
    expect(dragPan.getActive()).toBe(false);
  });

  test('после double-tap touchend: следующий одиночный тап не считается «третьим тапом»', () => {
    realSetRotation.mockClear();
    // Полный двойной тап + drag (зум).
    simulateDoubleTapStart(100, 100);
    dispatchTouch('touchmove', { clientX: 100, clientY: 200 });
    dispatchTouch('touchend', { clientX: 100, clientY: 200 });

    // Сразу после — новый одиночный тап + drag должен активировать rotation.
    dispatchTouch('touchstart', { clientX: 100, clientY: 200 });
    dispatchTouch('touchmove', { clientX: 200, clientY: 100 });
    flushAnimationFrame();
    expect(realSetRotation).toHaveBeenCalled();
  });

  test('после disable+enable: первый touchstart активирует rotation сразу (state сброшен)', async () => {
    realSetRotation.mockClear();
    // Создаём «след» прошлого touchend, который мог бы вызвать double-tap.
    dispatchTouch('touchstart', { clientX: 100, clientY: 100 });
    dispatchTouch('touchend', { clientX: 100, clientY: 100 });

    await singleFingerRotation.disable();
    await singleFingerRotation.enable();

    dispatchTouch('touchstart', { clientX: 100, clientY: 100 });
    dispatchTouch('touchmove', { clientX: 200, clientY: 200 });
    flushAnimationFrame();
    expect(realSetRotation).toHaveBeenCalled();
  });
});
