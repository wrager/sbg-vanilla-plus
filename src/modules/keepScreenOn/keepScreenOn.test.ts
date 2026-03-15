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

afterEach(async () => {
  await keepScreenOn.disable();
});

describe('keepScreenOn', () => {
  test('requests wake lock on enable', async () => {
    await keepScreenOn.enable();
    expect(mockRequest).toHaveBeenCalledWith('screen');
  });

  test('releases wake lock on disable', async () => {
    const sentinel = new MockSentinel();
    mockRequest.mockResolvedValueOnce(sentinel);

    await keepScreenOn.enable();
    await keepScreenOn.disable();
    expect(sentinel.release).toHaveBeenCalledTimes(1);
  });

  test('re-requests wake lock when tab becomes visible after browser releases lock', async () => {
    const sentinel = new MockSentinel();
    mockRequest.mockResolvedValueOnce(sentinel);

    await keepScreenOn.enable();
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

  test('rejects when wake lock API is unavailable', async () => {
    Object.defineProperty(navigator, 'wakeLock', {
      value: undefined,
      configurable: true,
    });
    await expect(keepScreenOn.enable()).rejects.toThrow();
  });

  test('silently handles re-acquisition failure on visibility change', async () => {
    const sentinel = new MockSentinel();
    mockRequest.mockResolvedValueOnce(sentinel);
    await keepScreenOn.enable();

    sentinel.dispatchEvent(new Event('release'));
    await Promise.resolve();

    mockRequest.mockRejectedValueOnce(new Error('transient'));
    document.dispatchEvent(new Event('visibilitychange'));
    await Promise.resolve();
  });
});
