import packageJson from './package.json' with { type: 'json' };

/** @type {import('jest').Config} */
export default {
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  roots: ['<rootDir>/src'],
  moduleFileExtensions: ['ts', 'js'],
  setupFiles: ['<rootDir>/src/__mocks__/jestPolyfills.ts', 'fake-indexeddb/auto'],
  moduleNameMapper: {
    '\\.css\\?inline$': '<rootDir>/src/__mocks__/cssMock.ts',
  },
  globals: {
    __SVP_VERSION__: packageJson.version,
  },
};
