import { initErrorLog, getErrorLog, formatErrorLog, clearErrorLog } from './errorLog';

let originalConsoleError: typeof console.error;
let originalConsoleWarn: typeof console.warn;

beforeEach(() => {
  originalConsoleError = console.error;
  originalConsoleWarn = console.warn;
  clearErrorLog();
});

afterEach(() => {
  console.error = originalConsoleError;
  console.warn = originalConsoleWarn;
});

describe('initErrorLog', () => {
  test('captures console.error', () => {
    initErrorLog();

    console.error('[SVP] Something broke');

    const log = getErrorLog();
    expect(log).toHaveLength(1);
    expect(log[0].level).toBe('error');
    expect(log[0].message).toContain('[SVP] Something broke');
  });

  test('captures console.warn', () => {
    initErrorLog();

    console.warn('some warning message');

    const log = getErrorLog();
    expect(log).toHaveLength(1);
    expect(log[0].level).toBe('warn');
    expect(log[0].message).toContain('some warning message');
  });

  test('captures all errors regardless of source', () => {
    initErrorLog();

    console.error('unrelated error from game');
    console.warn('unrelated warning');

    expect(getErrorLog()).toHaveLength(2);
  });

  test('formats Error objects with stack trace', () => {
    initErrorLog();

    const error = new Error('test error');
    error.stack = 'Error: test error\n    at Object.<anonymous> (script.js:42:1)';
    console.error(error);

    const log = getErrorLog();
    expect(log).toHaveLength(1);
    expect(log[0].message).toContain('test error');
    expect(log[0].message).toContain('script.js:42:1');
  });

  test('still calls original console methods', () => {
    const spyError = jest.fn();
    const spyWarn = jest.fn();
    console.error = spyError;
    console.warn = spyWarn;

    initErrorLog();

    console.error('test');
    console.warn('test');

    expect(spyError).toHaveBeenCalled();
    expect(spyWarn).toHaveBeenCalled();
  });
});

describe('formatErrorLog', () => {
  test('returns empty string when no entries', () => {
    expect(formatErrorLog()).toBe('');
  });

  test('formats entries with ISO timestamp and level', () => {
    initErrorLog();
    console.error('format test');

    const formatted = formatErrorLog();
    expect(formatted).toMatch(/\[\d{4}-\d{2}-\d{2}T/);
    expect(formatted).toContain('[error]');
    expect(formatted).toContain('format test');
  });
});

describe('clearErrorLog', () => {
  test('removes all entries', () => {
    initErrorLog();
    console.error('will be cleared');
    expect(getErrorLog()).toHaveLength(1);

    clearErrorLog();
    expect(getErrorLog()).toHaveLength(0);
  });
});
