// jsdom testEnvironment не пробрасывает structuredClone из Node.
// fake-indexeddb использует его для клонирования значений при put().
if (typeof globalThis.structuredClone !== 'function') {
  globalThis.structuredClone = (value: unknown): unknown => {
    if (value === undefined) return undefined;
    return JSON.parse(JSON.stringify(value)) as unknown;
  };
}

// Язык браузера в тестах фиксирован. С дефолтом игры lang: 'sys' локаль SVP
// берётся из navigator.language, поэтому все suite'ы, ожидающие английские
// строки и не ставящие settings, зависят от него. Без фиксации ожидания держал
// бы дефолт jsdom, а не решение проекта.
// Свойство остаётся нередактируемым, как и нативное: тип navigator.language
// объявлен readonly, поэтому присваивание всё равно не компилируется, а
// подмена в тестах идёт через defineProperty поверх (configurable: true).
Object.defineProperty(Navigator.prototype, 'language', {
  value: 'en-US',
  configurable: true,
});

/**
 * Подменяет ответ prefers-color-scheme на время теста. Снимается общим
 * `jest.restoreAllMocks()`.
 *
 * Подменяется сама matchMedia, а не поле matches у ранее возвращённого
 * объекта: заглушка ниже создаёт объект ответа на каждый вызов, и правка
 * готового на следующий вызов не влияет.
 */
export function stubPrefersColorSchemeDark(matches: boolean): void {
  const nativeMatchMedia = window.matchMedia.bind(window);
  jest.spyOn(window, 'matchMedia').mockImplementation((query: string) => {
    const list = nativeMatchMedia(query);
    Object.defineProperty(list, 'matches', { value: matches, configurable: true });
    return list;
  });
}

// jsdom не реализует matchMedia. Заглушка отвечает "запрос не совпадает" -
// это дефолт светлой системной темы для isGameDarkTheme.
if (typeof globalThis.matchMedia !== 'function') {
  class MockMediaQueryList {
    matches = false;
    onchange: unknown = null;
    constructor(readonly media: string) {}
    addListener(): void {}
    removeListener(): void {}
    addEventListener(): void {}
    removeEventListener(): void {}
    dispatchEvent(): boolean {
      return false;
    }
  }

  Object.defineProperty(globalThis, 'matchMedia', {
    value: (query: string): MockMediaQueryList => new MockMediaQueryList(query),
    writable: true,
    configurable: true,
  });
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
