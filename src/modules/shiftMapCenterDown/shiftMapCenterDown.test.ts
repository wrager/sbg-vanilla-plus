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

describe('action panel compensation', () => {
  const PANEL_HEIGHT = 200;

  function createActionPanel(selector: string): HTMLElement {
    const panel = document.createElement('div');
    panel.className = selector.replace('.', '') + ' hidden';
    jest.spyOn(panel, 'getBoundingClientRect').mockReturnValue({
      height: PANEL_HEIGHT,
      width: 0,
      top: 0,
      left: 0,
      bottom: 0,
      right: 0,
      x: 0,
      y: 0,
      toJSON: () => '',
    });
    document.body.appendChild(panel);
    return panel;
  }

  async function flushObserver(): Promise<void> {
    // MutationObserver callbacks в jsdom приходят в microtask очереди.
    await Promise.resolve();
    await Promise.resolve();
    // RAF-колбэк замокан через setTimeout(cb, 0).
    jest.advanceTimersByTime(0);
    await Promise.resolve();
  }

  let attackPanel: HTMLElement;
  let drawPanel: HTMLElement;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      return setTimeout(callback, 0) as unknown as number;
    });
    jest.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
      clearTimeout(id);
    });

    attackPanel = createActionPanel('.attack-slider-wrp');
    drawPanel = createActionPanel('.draw-slider-wrp');
  });

  afterEach(() => {
    attackPanel.remove();
    drawPanel.remove();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test('switches to bottom padding when attack panel opens', async () => {
    await shiftMapCenterDown.enable();
    setCenterMock.mockClear();

    attackPanel.classList.remove('hidden');
    await flushObserver();

    expect(mockView.padding).toEqual([0, 0, PANEL_HEIGHT, 0]);
    expect(setCenterMock).toHaveBeenCalledWith([0, 0]);
  });

  test('restores top padding when attack panel closes', async () => {
    await shiftMapCenterDown.enable();

    attackPanel.classList.remove('hidden');
    await flushObserver();
    setCenterMock.mockClear();

    attackPanel.classList.add('hidden');
    await flushObserver();

    const expectedPadding = Math.round(600 * 0.35);
    expect(mockView.padding).toEqual([expectedPadding, 0, 0, 0]);
    expect(setCenterMock).toHaveBeenCalledWith([0, 0]);
  });

  test('switches to bottom padding when draw panel opens', async () => {
    await shiftMapCenterDown.enable();
    setCenterMock.mockClear();

    drawPanel.classList.remove('hidden');
    await flushObserver();

    expect(mockView.padding).toEqual([0, 0, PANEL_HEIGHT, 0]);
  });

  test('restores top padding when draw panel closes', async () => {
    await shiftMapCenterDown.enable();

    drawPanel.classList.remove('hidden');
    await flushObserver();
    setCenterMock.mockClear();

    drawPanel.classList.add('hidden');
    await flushObserver();

    const expectedPadding = Math.round(600 * 0.35);
    expect(mockView.padding).toEqual([expectedPadding, 0, 0, 0]);
  });

  test('stops observing when module is disabled', async () => {
    await shiftMapCenterDown.enable();
    await shiftMapCenterDown.disable();

    attackPanel.classList.remove('hidden');
    await flushObserver();

    // Padding остаётся нулевым — observer отключён
    expect(mockView.padding).toEqual([0, 0, 0, 0]);
  });

  test('resets to zero padding if disabled during active action', async () => {
    await shiftMapCenterDown.enable();

    attackPanel.classList.remove('hidden');
    await flushObserver();

    await shiftMapCenterDown.disable();

    expect(mockView.padding).toEqual([0, 0, 0, 0]);
  });
});
