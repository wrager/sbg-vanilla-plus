// jsdom testEnvironment не пробрасывает structuredClone из Node.
// fake-indexeddb использует его для клонирования значений при put().
if (typeof globalThis.structuredClone !== 'function') {
  globalThis.structuredClone = (value: unknown): unknown => {
    if (value === undefined) return undefined;
    return JSON.parse(JSON.stringify(value)) as unknown;
  };
}

// jsdom 20/jest-environment-jsdom@29 не имеет Response/Headers. Минимальная реализация
// для тестов fetch-перехватчиков (lastRefProtection и т.п.).
if (typeof globalThis.Response === 'undefined') {
  class MockHeaders {
    private readonly map = new Map<string, string>();
    constructor(init?: Record<string, string>) {
      if (init) {
        for (const key of Object.keys(init)) {
          this.map.set(key.toLowerCase(), init[key]);
        }
      }
    }
    get(name: string): string | null {
      return this.map.get(name.toLowerCase()) ?? null;
    }
    set(name: string, value: string): void {
      this.map.set(name.toLowerCase(), value);
    }
    has(name: string): boolean {
      return this.map.has(name.toLowerCase());
    }
  }

  class MockResponse {
    readonly status: number;
    readonly statusText: string;
    readonly headers: MockHeaders;
    readonly ok: boolean;
    private readonly body: string;
    constructor(
      body: string,
      init?: {
        status?: number;
        statusText?: string;
        headers?: Record<string, string> | MockHeaders;
      },
    ) {
      this.body = body;
      this.status = init?.status ?? 200;
      this.statusText = init?.statusText ?? '';
      this.ok = this.status >= 200 && this.status < 300;
      // Используем Headers из глобала (jsdom's или наш MockHeaders fallback).
      const HeadersCtor = globalThis.Headers as unknown as new (
        init?: Record<string, string>,
      ) => MockHeaders;
      if (init?.headers instanceof HeadersCtor) {
        this.headers = init.headers;
      } else {
        this.headers = new HeadersCtor(init?.headers);
      }
    }
    async json(): Promise<unknown> {
      return Promise.resolve(JSON.parse(this.body) as unknown);
    }
    async text(): Promise<string> {
      return Promise.resolve(this.body);
    }
    clone(): MockResponse {
      return new MockResponse(this.body, {
        status: this.status,
        statusText: this.statusText,
        headers: this.headers,
      });
    }
  }

  (globalThis as { Response: unknown }).Response = MockResponse;
  // jsdom уже предоставляет Headers — не перезаписываем, иначе ломаются тесты,
  // которые полагаются на нативный Headers (например, sbgFlavor).
  if (typeof globalThis.Headers === 'undefined') {
    (globalThis as { Headers: unknown }).Headers = MockHeaders;
  }
}

export {};
