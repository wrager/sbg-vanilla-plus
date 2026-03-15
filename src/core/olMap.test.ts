import type { IOlView } from './olMap';

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
});

afterEach(() => {
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
