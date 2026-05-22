import type { IOlFeature, IOlInteraction, IOlLayer, IOlMap, IOlView } from './olMap';
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

// ── registerForEachFeatureAtPixelInterceptor ─────────────────────────────────

describe('registerForEachFeatureAtPixelInterceptor', () => {
  function createForEachMap(): IOlMap & { forEachFeatureAtPixel: jest.Mock } {
    return {
      getView: createFakeView,
      getSize: () => [800, 600],
      getLayers: () => ({ getArray: () => [] }),
      getInteractions: () => ({ getArray: () => [] }),
      addLayer: jest.fn(),
      removeLayer: jest.fn(),
      updateSize: jest.fn(),
      forEachFeatureAtPixel: jest.fn(),
    };
  }

  function makeLayer(name: string): IOlLayer {
    return {
      get: (key: string) => (key === 'name' ? name : undefined),
      getSource: () => null,
    };
  }

  function makeFeature(): IOlFeature {
    return {
      getGeometry: () => ({ getCoordinates: () => [0, 0] }),
      getId: () => undefined,
      setId: () => {},
      setStyle: () => {},
    };
  }

  test('wraps the method on first registration', async () => {
    const { registerForEachFeatureAtPixelInterceptor } = await import('./olMap');
    const map = createForEachMap();
    const native = map.forEachFeatureAtPixel;

    registerForEachFeatureAtPixelInterceptor(map, {});

    expect(map.forEachFeatureAtPixel).not.toBe(native);
  });

  test('forwards transformed options to the native method', async () => {
    const { registerForEachFeatureAtPixelInterceptor } = await import('./olMap');
    const map = createForEachMap();
    const native = map.forEachFeatureAtPixel;

    registerForEachFeatureAtPixelInterceptor(map, {
      transformOptions: (options) => ({ ...options, hitTolerance: 15 }),
    });

    const callback = jest.fn();
    const layerFilter = jest.fn();
    map.forEachFeatureAtPixel([3, 4], callback, { layerFilter });

    expect(native).toHaveBeenCalledWith([3, 4], expect.any(Function), {
      layerFilter,
      hitTolerance: 15,
    });
  });

  test('passes caller options through untouched when nothing transforms them', async () => {
    const { registerForEachFeatureAtPixelInterceptor } = await import('./olMap');
    const map = createForEachMap();
    const native = map.forEachFeatureAtPixel;

    registerForEachFeatureAtPixelInterceptor(map, { filterHit: () => true });

    const callback = jest.fn();
    const options = { hitTolerance: 7 };
    map.forEachFeatureAtPixel([5, 6], callback, options);

    expect(native).toHaveBeenCalledWith([5, 6], expect.any(Function), options);
  });

  test('filterHit hides a hit from the caller callback', async () => {
    const { registerForEachFeatureAtPixelInterceptor } = await import('./olMap');
    const map = createForEachMap();
    const pointFeature = makeFeature();
    const regionFeature = makeFeature();
    const pointsLayer = makeLayer('points');
    const regionsLayer = makeLayer('regions');
    map.forEachFeatureAtPixel.mockImplementation(
      (_pixel: number[], cb: (feature: IOlFeature, layer: IOlLayer) => void) => {
        cb(pointFeature, pointsLayer);
        cb(regionFeature, regionsLayer);
      },
    );

    registerForEachFeatureAtPixelInterceptor(map, {
      filterHit: (_feature, layer) => layer?.get('name') !== 'points',
    });

    const callerCallback = jest.fn();
    map.forEachFeatureAtPixel([0, 0], callerCallback);

    expect(callerCallback).toHaveBeenCalledTimes(1);
    expect(callerCallback).toHaveBeenCalledWith(regionFeature, regionsLayer);
  });

  test('two interceptors coexist; unregistering one keeps the other active', async () => {
    // Воспроизводит конфликт largerPointTapArea + drawTools: выключение одного
    // модуля вживую не должно убивать обёртку другого.
    const { registerForEachFeatureAtPixelInterceptor } = await import('./olMap');
    const map = createForEachMap();
    const native = map.forEachFeatureAtPixel;
    const pointFeature = makeFeature();
    const pointsLayer = makeLayer('points');
    native.mockImplementation(
      (_pixel: number[], cb: (feature: IOlFeature, layer: IOlLayer) => void) => {
        cb(pointFeature, pointsLayer);
      },
    );

    // Перехватчик A - как largerPointTapArea (правит options).
    const unregisterA = registerForEachFeatureAtPixelInterceptor(map, {
      transformOptions: (options) => ({ ...options, hitTolerance: 15 }),
    });
    // Перехватчик B - как drawTools (фильтрует попадания).
    registerForEachFeatureAtPixelInterceptor(map, {
      filterHit: (_feature, layer) => layer?.get('name') !== 'points',
    });

    // Снятие A не должно убивать фильтр B.
    unregisterA();

    const callerCallback = jest.fn();
    map.forEachFeatureAtPixel([0, 0], callerCallback);

    expect(callerCallback).not.toHaveBeenCalled();
    // A снят - hitTolerance больше не навязывается.
    expect(native).toHaveBeenLastCalledWith([0, 0], expect.any(Function), undefined);
  });

  test('keeps the wrapper installed until the last interceptor unregisters', async () => {
    const { registerForEachFeatureAtPixelInterceptor } = await import('./olMap');
    const map = createForEachMap();
    const native = map.forEachFeatureAtPixel;

    const unregisterA = registerForEachFeatureAtPixelInterceptor(map, {});
    const unregisterB = registerForEachFeatureAtPixelInterceptor(map, {});
    const wrapper = map.forEachFeatureAtPixel;

    unregisterA();
    expect(map.forEachFeatureAtPixel).toBe(wrapper);

    unregisterB();
    const callback = jest.fn();
    map.forEachFeatureAtPixel([1, 1], callback);
    expect(native).toHaveBeenLastCalledWith([1, 1], callback);
  });

  test('returns a no-op unregister when the map has no forEachFeatureAtPixel', async () => {
    const { registerForEachFeatureAtPixelInterceptor } = await import('./olMap');
    const map: IOlMap = {
      getView: createFakeView,
      getSize: () => [800, 600],
      getLayers: () => ({ getArray: () => [] }),
      getInteractions: () => ({ getArray: () => [] }),
      addLayer: jest.fn(),
      removeLayer: jest.fn(),
      updateSize: jest.fn(),
    };

    const unregister = registerForEachFeatureAtPixelInterceptor(map, {});

    expect(map.forEachFeatureAtPixel).toBeUndefined();
    expect(() => {
      unregister();
    }).not.toThrow();
  });
});
