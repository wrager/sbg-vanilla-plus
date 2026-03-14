/** @type {import('jest').Config} */
export default {
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  roots: ['<rootDir>/tests'],
  moduleFileExtensions: ['ts', 'js'],
  moduleNameMapper: {
    '\\.css\\?inline$': '<rootDir>/tests/__mocks__/cssMock.ts',
  },
};
