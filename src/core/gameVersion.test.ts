import { checkVersion, SBG_COMPATIBLE_VERSIONS } from './gameVersion';

describe('checkVersion', () => {
  beforeEach(() => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('returns true for each supported version', () => {
    for (const v of SBG_COMPATIBLE_VERSIONS) {
      expect(checkVersion(v)).toBe(true);
    }
    expect(console.warn).not.toHaveBeenCalled();
  });

  test('returns false for unsupported version', () => {
    expect(checkVersion('0.0.0')).toBe(false);
  });

  test('warning lists all supported versions', () => {
    checkVersion('0.0.0');
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('0.0.0'));
    for (const v of SBG_COMPATIBLE_VERSIONS) {
      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining(v));
    }
  });
});
