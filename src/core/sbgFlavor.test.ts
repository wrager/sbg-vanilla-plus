import { installSbgFlavor } from './sbgFlavor';

describe('installSbgFlavor', () => {
  let originalFetch: typeof window.fetch;
  let mockFetch: jest.Mock<Promise<unknown>, [RequestInfo | URL, RequestInit | undefined]>;

  function getLastCallHeaders(): Headers {
    const [, init] = mockFetch.mock.calls[0];
    return new Headers(init?.headers);
  }

  beforeEach(() => {
    mockFetch = jest
      .fn<Promise<unknown>, [RequestInfo | URL, RequestInit | undefined]>()
      .mockResolvedValue({});
    originalFetch = window.fetch;
    Object.defineProperty(window, 'fetch', { value: mockFetch, writable: true });
  });

  afterEach(() => {
    window.fetch = originalFetch;
  });

  it('should add x-sbg-flavor header to fetch requests', async () => {
    installSbgFlavor();

    await window.fetch('/api/self');

    expect(getLastCallHeaders().get('x-sbg-flavor')).toBe('VanillaPlus/0.1.0');
  });

  it('should append to existing x-sbg-flavor header', async () => {
    installSbgFlavor();

    await window.fetch('/api/self', {
      headers: { 'x-sbg-flavor': 'OtherScript/1.0' },
    });

    expect(getLastCallHeaders().get('x-sbg-flavor')).toBe('OtherScript/1.0 VanillaPlus/0.1.0');
  });

  it('should not duplicate flavor if already present', async () => {
    installSbgFlavor();

    await window.fetch('/api/self', {
      headers: { 'x-sbg-flavor': 'VanillaPlus/0.1.0' },
    });

    expect(getLastCallHeaders().get('x-sbg-flavor')).toBe('VanillaPlus/0.1.0');
  });

  it('should preserve existing init options', async () => {
    installSbgFlavor();

    await window.fetch('/api/self', {
      method: 'POST',
      body: 'test',
    });

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/self');
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe('test');
  });

  it('should work when called without init argument', async () => {
    installSbgFlavor();

    await window.fetch('/api/self');

    expect(getLastCallHeaders().get('x-sbg-flavor')).toBe('VanillaPlus/0.1.0');
  });
});
