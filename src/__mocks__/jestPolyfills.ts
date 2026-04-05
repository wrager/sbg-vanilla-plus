// jsdom testEnvironment не пробрасывает structuredClone из Node.
// fake-indexeddb использует его для клонирования значений при put().
if (typeof globalThis.structuredClone !== 'function') {
  globalThis.structuredClone = (value: unknown): unknown => {
    if (value === undefined) return undefined;
    return JSON.parse(JSON.stringify(value)) as unknown;
  };
}

export {};
