import { checkVersion, SBG_COMPATIBLE_VERSION } from './gameVersion';

describe('checkVersion', () => {
  beforeEach(() => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('returns true for matching version', () => {
    expect(checkVersion(SBG_COMPATIBLE_VERSION)).toBe(true);
    expect(console.warn).not.toHaveBeenCalled();
  });

  test('returns false for non-matching version', () => {
    expect(checkVersion('0.0.0')).toBe(false);
  });

  test('logs warning for non-matching version', () => {
    checkVersion('0.0.0');
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('0.0.0'));
  });
});
