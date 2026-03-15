import { keepScreenOn } from './keepScreenOn';

class MockSentinel extends EventTarget {
  readonly released = false;
  readonly type: WakeLockType = 'screen';
  onrelease: ((this: WakeLockSentinel, ev: Event) => unknown) | null = null;
  release = jest.fn().mockResolvedValue(undefined);
}

const mockRequest = jest.fn();

beforeEach(() => {
  mockRequest.mockReset();
  mockRequest.mockResolvedValue(new MockSentinel());
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
    const sentinel = new MockSentinel();
    mockRequest.mockResolvedValueOnce(sentinel);

    keepScreenOn.enable();
    await Promise.resolve();
    keepScreenOn.disable();
    await Promise.resolve();
    expect(sentinel.release).toHaveBeenCalledTimes(1);
  });

  test('re-requests wake lock when tab becomes visible after browser releases lock', async () => {
    const sentinel = new MockSentinel();
    mockRequest.mockResolvedValueOnce(sentinel);

    keepScreenOn.enable();
    await Promise.resolve();
    mockRequest.mockClear();

    // Browser releases the lock (e.g. tab goes to background)
    sentinel.dispatchEvent(new Event('release'));
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
