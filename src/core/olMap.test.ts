import type { IOlInteraction, IOlLayer, IOlMap, IOlView } from './olMap';
import { createDragPanControl, findLayerByName } from './olMap';

function createFakeView(): IOlView {
  return {
    padding: [0, 0, 0, 0],
    getCenter: () => undefined,
    setCenter: () => {},
    calculateExtent: () => [0, 0, 0, 0],
    changed: () => {},
    getRotation: () => 0,
    setRotation: () => {},
    getZoom: () => undefined,
  };
}

function getProto(): { getView: () => IOlView } {
  const ol = window.ol;
  if (!ol) throw new Error('ol not set');
  return ol.Map.prototype;
}

let originalOlDescriptor: PropertyDescriptor | undefined;

beforeEach(() => {
  originalOlDescriptor = Object.getOwnPropertyDescriptor(window, 'ol');
  jest.resetModules();
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
  if (originalOlDescriptor) {
    Object.defineProperty(window, 'ol', originalOlDescriptor);
  } else {
    delete window.ol;
  }
});

test('captures map instance when ol is already available', async () => {
  const { getOlMap, initOlMapCapture } = await import('./olMap');

  const fakeView = createFakeView();
  const fakeMap = { getView: () => fakeView };

  window.ol = {
    Map: { prototype: { getView: fakeMap.getView } },
  };

  initOlMapCapture();

  const promise = getOlMap();
  const result = getProto().getView.call(fakeMap);
  expect(result).toBe(fakeView);

  const captured = await promise;
  expect(captured).toBe(fakeMap);
});

test('waits for ol and captures when it becomes available', async () => {
  delete window.ol;

  const { getOlMap, initOlMapCapture } = await import('./olMap');

  initOlMapCapture();

  const promise = getOlMap();

  // Simulate game loading OL later
  const fakeView = createFakeView();
  const fakeMap = { getView: () => fakeView };

  window.ol = {
    Map: { prototype: { getView: fakeMap.getView } },
  };

  // Simulate game calling getView on the map
  getProto().getView.call(fakeMap);

  const captured = await promise;
  expect(captured).toBe(fakeMap);
});

test('restores window.ol as a normal property after interception', async () => {
  delete window.ol;

  const { initOlMapCapture } = await import('./olMap');

  initOlMapCapture();

  const fakeView = createFakeView();
  window.ol = {
    Map: { prototype: { getView: () => fakeView } },
  };

  const desc = Object.getOwnPropertyDescriptor(window, 'ol');
  expect(desc?.writable).toBe(true);
  expect(desc?.value).toBeDefined();
});

test('restores original getView after capture', async () => {
  const { initOlMapCapture } = await import('./olMap');

  const fakeView = createFakeView();
  const originalGetView = () => fakeView;
  const fakeMap = { getView: originalGetView };

  window.ol = {
    Map: { prototype: { getView: originalGetView } },
  };

  initOlMapCapture();

  const proto = getProto();
  proto.getView.call(fakeMap);

  expect(proto.getView).toBe(originalGetView);
});

test('does not throw when ol is undefined', async () => {
  const { initOlMapCapture } = await import('./olMap');

  window.ol = undefined;
  expect(() => {
    initOlMapCapture();
  }).not.toThrow();
});

test('waits indefinitely until map is created', async () => {
  delete window.ol;

  const { getOlMap, initOlMapCapture } = await import('./olMap');

  initOlMapCapture();

  const promise = getOlMap();
  let resolved = false;
  void promise.then(() => {
    resolved = true;
  });

  // Промис не резолвится без создания карты
  await Promise.resolve();
  expect(resolved).toBe(false);

  // Создаём карту — промис резолвится
  const fakeView = createFakeView();
  const fakeMap = { getView: () => fakeView };
  window.ol = {
    Map: { prototype: { getView: fakeMap.getView } },
  };
  getProto().getView.call(fakeMap);

  const captured = await promise;
  expect(captured).toBe(fakeMap);
});

test('logs diagnostic warning when map is not captured in time', async () => {
  delete window.ol;

  const { initOlMapCapture } = await import('./olMap');

  const warnSpy = jest.spyOn(console, 'warn').mockImplementation();

  initOlMapCapture();
  jest.advanceTimersByTime(5000);

  expect(warnSpy).toHaveBeenCalledWith(
    expect.stringContaining('OL Map не захвачен'),
    expect.anything(),
    expect.anything(),
    expect.anything(),
    expect.anything(),
    expect.anything(),
  );
  warnSpy.mockRestore();
});

test('does not log diagnostic if map captured before delay', async () => {
  const { initOlMapCapture } = await import('./olMap');

  const fakeView = createFakeView();
  const fakeMap = { getView: () => fakeView };
  window.ol = {
    Map: { prototype: { getView: fakeMap.getView } },
  };

  const warnSpy = jest.spyOn(console, 'warn').mockImplementation();

  initOlMapCapture();
  getProto().getView.call(fakeMap);
  jest.advanceTimersByTime(5000);

  expect(warnSpy).not.toHaveBeenCalled();
  warnSpy.mockRestore();
});

test('retries hook when ol available but defineProperty missed', async () => {
  delete window.ol;

  const { getOlMap, initOlMapCapture } = await import('./olMap');

  initOlMapCapture();

  // Симулируем: другой скрипт перезаписал defineProperty, ol появился напрямую
  Object.defineProperty(window, 'ol', {
    configurable: true,
    enumerable: true,
    writable: true,
    value: undefined,
  });
  const fakeView = createFakeView();
  const fakeMap = { getView: () => fakeView };
  window.ol = {
    Map: { prototype: { getView: fakeMap.getView } },
  };

  const warnSpy = jest.spyOn(console, 'warn').mockImplementation();

  // Диагностика обнаруживает: ol есть, hook не вызван → повторный перехват
  jest.advanceTimersByTime(5000);

  expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Повторная попытка'));

  // После повторного перехвата getView вызов резолвит промис
  const promise = getOlMap();
  getProto().getView.call(fakeMap);

  const captured = await promise;
  expect(captured).toBe(fakeMap);

  warnSpy.mockRestore();
});

// ── findLayerByName ──────────────────────────────────────────────────────────

describe('findLayerByName', () => {
  function makeLayer(name: string): IOlLayer {
    return {
      get: (key: string) => (key === 'name' ? name : undefined),
      getSource: () => null,
    };
  }

  function makeMap(layers: IOlLayer[]): IOlMap {
    return {
      getView: createFakeView,
      getSize: () => [800, 600],
      getLayers: () => ({ getArray: () => layers }),
      getInteractions: () => ({ getArray: () => [] }),
      addLayer: jest.fn(),
      removeLayer: jest.fn(),
      updateSize: jest.fn(),
    };
  }

  test('returns layer with matching name', () => {
    const target = makeLayer('points');
    const map = makeMap([makeLayer('regions'), target, makeLayer('lines')]);
    expect(findLayerByName(map, 'points')).toBe(target);
  });

  test('returns null when no layer matches', () => {
    const map = makeMap([makeLayer('regions'), makeLayer('lines')]);
    expect(findLayerByName(map, 'points')).toBeNull();
  });

  test('returns null for empty layers array', () => {
    const map = makeMap([]);
    expect(findLayerByName(map, 'points')).toBeNull();
  });
});

// ── createDragPanControl ─────────────────────────────────────────────────────

describe('createDragPanControl', () => {
  function makeDragPan(): IOlInteraction & { active: boolean } {
    const interaction = {
      active: true,
      setActive(value: boolean) {
        interaction.active = value;
      },
      getActive() {
        return interaction.active;
      },
    };
    return interaction;
  }

  function makeMapWithDragPan(interactions: IOlInteraction[]): IOlMap {
    // DragPan detection relies on instanceof — mock window.ol.interaction.DragPan
    // eslint-disable-next-line @typescript-eslint/no-extraneous-class -- заглушка для instanceof
    const FakeDragPan = class {};
    window.ol = {
      Map: { prototype: { getView: jest.fn() } },
      interaction: {
        DragPan: FakeDragPan as unknown as new () => IOlInteraction,
      },
    } as typeof window.ol;

    // Make interactions instances of FakeDragPan
    for (const interaction of interactions) {
      Object.setPrototypeOf(interaction, FakeDragPan.prototype);
    }

    return {
      getView: createFakeView,
      getSize: () => [800, 600],
      getLayers: () => ({ getArray: () => [] }),
      getInteractions: () => ({ getArray: () => interactions }),
      addLayer: jest.fn(),
      removeLayer: jest.fn(),
      updateSize: jest.fn(),
    };
  }

  afterEach(() => {
    delete window.ol;
  });

  test('disable deactivates DragPan interactions', () => {
    const dragPan = makeDragPan();
    const map = makeMapWithDragPan([dragPan]);
    const control = createDragPanControl(map);

    control.disable();
    expect(dragPan.active).toBe(false);
  });

  test('restore reactivates previously disabled interactions', () => {
    const dragPan = makeDragPan();
    const map = makeMapWithDragPan([dragPan]);
    const control = createDragPanControl(map);

    control.disable();
    control.restore();
    expect(dragPan.active).toBe(true);
  });

  test('restore after restore is a no-op', () => {
    const dragPan = makeDragPan();
    const map = makeMapWithDragPan([dragPan]);
    const control = createDragPanControl(map);

    control.disable();
    control.restore();
    dragPan.active = false; // externally disabled
    control.restore(); // should not re-enable
    expect(dragPan.active).toBe(false);
  });

  test('instances are isolated', () => {
    const dragPan = makeDragPan();
    const map = makeMapWithDragPan([dragPan]);
    const controlA = createDragPanControl(map);
    const controlB = createDragPanControl(map);

    controlA.disable();
    controlB.restore(); // B hasn't disabled anything — no effect
    expect(dragPan.active).toBe(false);
  });
});
