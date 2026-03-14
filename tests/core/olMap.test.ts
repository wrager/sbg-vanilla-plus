type Win = Record<string, unknown>;
type OlProto = { Map: { prototype: { getView: () => unknown } } };

function getProto(): OlProto['Map']['prototype'] {
  return ((window as unknown as Win).ol as OlProto).Map.prototype;
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
    delete (window as unknown as Win).ol;
  }
});

test('captures map instance when ol is already available', async () => {
  const { getOlMap, initOlMapCapture } = await import('../../src/core/olMap');

  const fakeView = { padding: [0, 0, 0, 0] };
  const fakeMap = { getView: () => fakeView };

  (window as unknown as Win).ol = {
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
  delete (window as unknown as Win).ol;

  const { getOlMap, initOlMapCapture } = await import('../../src/core/olMap');

  initOlMapCapture();

  const promise = getOlMap();

  // Simulate game loading OL later
  const fakeView = { padding: [0, 0, 0, 0] };
  const fakeMap = { getView: () => fakeView };

  (window as unknown as Win).ol = {
    Map: { prototype: { getView: fakeMap.getView } },
  };

  // Simulate game calling getView on the map
  getProto().getView.call(fakeMap);

  const captured = await promise;
  expect(captured).toBe(fakeMap);
});

test('restores window.ol as a normal property after interception', async () => {
  delete (window as unknown as Win).ol;

  const { initOlMapCapture } = await import('../../src/core/olMap');

  initOlMapCapture();

  const fakeView = { padding: [0, 0, 0, 0] };
  (window as unknown as Win).ol = {
    Map: { prototype: { getView: () => fakeView } },
  };

  const desc = Object.getOwnPropertyDescriptor(window, 'ol');
  expect(desc?.writable).toBe(true);
  expect(desc?.value).toBeDefined();
});

test('restores original getView after capture', async () => {
  const { initOlMapCapture } = await import('../../src/core/olMap');

  const fakeView = { padding: [0, 0, 0, 0] };
  const originalGetView = () => fakeView;
  const fakeMap = { getView: originalGetView };

  (window as unknown as Win).ol = {
    Map: { prototype: { getView: originalGetView } },
  };

  initOlMapCapture();

  const proto = getProto();
  proto.getView.call(fakeMap);

  expect(proto.getView).toBe(originalGetView);
});

test('does not throw when ol is undefined', async () => {
  const { initOlMapCapture } = await import('../../src/core/olMap');

  (window as unknown as Win).ol = undefined;
  expect(() => {
    initOlMapCapture();
  }).not.toThrow();
});
