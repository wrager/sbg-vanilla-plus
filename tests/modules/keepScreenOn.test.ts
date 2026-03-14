import { keepScreenOn } from '../../src/modules/keepScreenOn';

function createMockSentinel(): WakeLockSentinel {
  const sentinel = new EventTarget() as WakeLockSentinel;
  Object.defineProperty(sentinel, 'released', { value: false, configurable: true });
  Object.defineProperty(sentinel, 'type', { value: 'screen' });
  (sentinel as unknown as { release: () => Promise<void> }).release = jest
    .fn()
    .mockResolvedValue(undefined);
  return sentinel;
}

const mockRequest = jest.fn();

beforeEach(() => {
  mockRequest.mockReset();
  mockRequest.mockResolvedValue(createMockSentinel());
  Object.defineProperty(navigator, 'wakeLock', {
    value: { request: mockRequest },
    configurable: true,
  });
  Object.defineProperty(document, 'visibilityState', {
    value: 'visible',
    configurable: true,
  });
});

afterEach(() => {
  keepScreenOn.disable();
});

describe('keepScreenOn', () => {
  test('requests wake lock on enable', async () => {
    keepScreenOn.enable();
    await Promise.resolve();
    expect(mockRequest).toHaveBeenCalledWith('screen');
  });

  test('releases wake lock on disable', async () => {
    keepScreenOn.enable();
    await Promise.resolve();
    const sentinel = (await mockRequest.mock.results[0].value) as WakeLockSentinel;
    keepScreenOn.disable();
    await Promise.resolve();
    expect((sentinel as unknown as { release: jest.Mock }).release).toHaveBeenCalledTimes(1);
  });

  test('re-requests wake lock when tab becomes visible after browser releases lock', async () => {
    keepScreenOn.enable();
    await Promise.resolve();
    const sentinel = (await mockRequest.mock.results[0].value) as WakeLockSentinel;
    mockRequest.mockClear();

    // Browser releases the lock (e.g. tab goes to background)
    (sentinel as EventTarget).dispatchEvent(new Event('release'));
    await Promise.resolve();

    // Tab becomes visible again
    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      configurable: true,
    });
    document.dispatchEvent(new Event('visibilitychange'));
    await Promise.resolve();

    expect(mockRequest).toHaveBeenCalledTimes(1);
  });

  test('does not throw when wake lock API is unavailable', () => {
    Object.defineProperty(navigator, 'wakeLock', {
      value: undefined,
      configurable: true,
    });
    expect(() => {
      keepScreenOn.enable();
    }).not.toThrow();
  });
});
