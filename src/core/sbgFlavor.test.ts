import { installSbgFlavor } from './sbgFlavor';

declare const __SVP_VERSION__: string;

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
    jest.restoreAllMocks();
  });

  it('should add x-sbg-flavor header to fetch requests', async () => {
    installSbgFlavor();

    await window.fetch('/api/self');

    expect(getLastCallHeaders().get('x-sbg-flavor')).toBe(`VanillaPlus/${__SVP_VERSION__}`);
  });

  it('should append to existing x-sbg-flavor header', async () => {
    installSbgFlavor();

    await window.fetch('/api/self', {
      headers: { 'x-sbg-flavor': 'OtherScript/1.0' },
    });

    expect(getLastCallHeaders().get('x-sbg-flavor')).toBe(
      `OtherScript/1.0 VanillaPlus/${__SVP_VERSION__}`,
    );
  });

  it('should not duplicate flavor if already present', async () => {
    installSbgFlavor();

    await window.fetch('/api/self', {
      headers: { 'x-sbg-flavor': `VanillaPlus/${__SVP_VERSION__}` },
    });

    expect(getLastCallHeaders().get('x-sbg-flavor')).toBe(`VanillaPlus/${__SVP_VERSION__}`);
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

    expect(getLastCallHeaders().get('x-sbg-flavor')).toBe(`VanillaPlus/${__SVP_VERSION__}`);
  });

  test('заголовок, который не принимает Headers, не обрывает запрос игры', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    installSbgFlavor();
    const brokenInit = { headers: { 'x-sbg-flavor': 'bad\nvalue' } };

    // Нативный fetch на таком заголовке отклоняет промис, а не бросает
    // синхронно: игровой код с обработчиком на промисе увидел бы наш throw
    // мимо своего catch.
    await expect(window.fetch('/api/self', brokenInit)).resolves.toBeDefined();

    // Оригиналу запрос уходит нетронутым: без нашего заголовка, но с init
    // игры - решение о судьбе такого запроса остаётся за ней.
    expect(mockFetch).toHaveBeenCalledWith('/api/self', brokenInit);
    // Ошибку конструирует Headers из jsdom, поэтому она инстанс Error чужого
    // realm - expect.any(Error) на ней не срабатывает.
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('[SVP]'), expect.anything());
  });

  test('отказ пишется в лог один раз', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    installSbgFlavor();

    await window.fetch('/api/self', { headers: { 'x-sbg-flavor': 'bad\nvalue' } });
    await window.fetch('/api/draw', { headers: { 'x-sbg-flavor': 'bad\nvalue' } });

    expect(consoleError).toHaveBeenCalledTimes(1);
    // Перехват остаётся в цепочке: следующий корректный запрос снова получает
    // наш заголовок.
    await window.fetch('/api/self');
    const [, init] = mockFetch.mock.calls[2];
    expect(new Headers(init?.headers).get('x-sbg-flavor')).toBe(`VanillaPlus/${__SVP_VERSION__}`);
  });
});
