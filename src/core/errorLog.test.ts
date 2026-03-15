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
  test('intercepts console.error with [SVP] prefix', () => {
    initErrorLog();

    console.error('[SVP] Something broke');

    const log = getErrorLog();
    expect(log).toHaveLength(1);
    expect(log[0].level).toBe('error');
    expect(log[0].message).toContain('[SVP] Something broke');
  });

  test('intercepts console.warn with [SVP] prefix', () => {
    initErrorLog();

    console.warn('[SVP] Модуль "Test" не загрузился:', 'some reason');

    const log = getErrorLog();
    expect(log).toHaveLength(1);
    expect(log[0].level).toBe('warn');
    expect(log[0].message).toContain('[SVP]');
  });

  test('ignores console messages without [SVP] prefix', () => {
    initErrorLog();

    console.error('unrelated error from game');
    console.warn('unrelated warning');

    expect(getErrorLog()).toHaveLength(0);
  });

  test('captures errors with sbg-vanilla-plus in stack', () => {
    initErrorLog();

    const error = new Error('test error');
    error.stack = 'Error: test error\n    at Object.<anonymous> (sbg-vanilla-plus.user.js:42:1)';
    console.error(error);

    const log = getErrorLog();
    expect(log).toHaveLength(1);
    expect(log[0].level).toBe('error');
    expect(log[0].message).toContain('test error');
    expect(log[0].message).toContain('sbg-vanilla-plus');
  });

  test('still calls original console methods', () => {
    const spyError = jest.fn();
    const spyWarn = jest.fn();
    console.error = spyError;
    console.warn = spyWarn;

    initErrorLog();

    console.error('[SVP] test');
    console.warn('[SVP] test');

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
    console.error('[SVP] format test');

    const formatted = formatErrorLog();
    expect(formatted).toMatch(/\[\d{4}-\d{2}-\d{2}T/);
    expect(formatted).toContain('[error]');
    expect(formatted).toContain('[SVP] format test');
  });
});

describe('clearErrorLog', () => {
  test('removes all entries', () => {
    initErrorLog();
    console.error('[SVP] will be cleared');
    expect(getErrorLog()).toHaveLength(1);

    clearErrorLog();
    expect(getErrorLog()).toHaveLength(0);
  });
});
