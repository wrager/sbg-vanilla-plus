import {
  checkVersion,
  getGameVersionWhereNative,
  isModuleNativeInCurrentGame,
  isSbg061Detected,
  SBG_COMPATIBLE_VERSIONS,
} from './gameVersion';

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

describe('isSbg061Detected', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('возвращает true, если .navi-floater есть в DOM (0.6.1)', () => {
    document.body.innerHTML = '<div class="navi-floater hidden"></div>';
    expect(isSbg061Detected()).toBe(true);
  });

  test('возвращает false, если .navi-floater отсутствует (0.6.0)', () => {
    document.body.innerHTML = '<div class="info"></div>';
    expect(isSbg061Detected()).toBe(false);
  });
});

describe('isModuleNativeInCurrentGame', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('без .navi-floater любой модуль считается нативно не реализованным', () => {
    document.body.innerHTML = '';
    expect(isModuleNativeInCurrentGame('favoritedPoints')).toBe(false);
    expect(isModuleNativeInCurrentGame('keepScreenOn')).toBe(false);
  });

  test('с .navi-floater модуль, которого нет в списке, считается не реализованным', () => {
    document.body.innerHTML = '<div class="navi-floater hidden"></div>';
    // enhancedMainScreen в SBG 0.6.1 не перекрыт нативом — наш модуль должен
    // работать как обычно.
    expect(isModuleNativeInCurrentGame('enhancedMainScreen')).toBe(false);
  });

  test('с .navi-floater favoritedPoints считается нативно реализованным', () => {
    document.body.innerHTML = '<div class="navi-floater hidden"></div>';
    expect(isModuleNativeInCurrentGame('favoritedPoints')).toBe(true);
  });

  test('с .navi-floater inventoryCleanup считается нативно реализованным', () => {
    document.body.innerHTML = '<div class="navi-floater hidden"></div>';
    expect(isModuleNativeInCurrentGame('inventoryCleanup')).toBe(true);
  });

  test('с .navi-floater keyCountOnPoints считается нативно реализованным', () => {
    document.body.innerHTML = '<div class="navi-floater hidden"></div>';
    expect(isModuleNativeInCurrentGame('keyCountOnPoints')).toBe(true);
  });
});

describe('getGameVersionWhereNative', () => {
  test('для модуля вне списка возвращает null', () => {
    expect(getGameVersionWhereNative('enhancedMainScreen')).toBeNull();
    expect(getGameVersionWhereNative('keepScreenOn')).toBeNull();
  });

  test('для favoritedPoints возвращает 0.6.1', () => {
    expect(getGameVersionWhereNative('favoritedPoints')).toBe('0.6.1');
  });

  test('для inventoryCleanup возвращает 0.6.1', () => {
    expect(getGameVersionWhereNative('inventoryCleanup')).toBe('0.6.1');
  });

  test('для keyCountOnPoints возвращает 0.6.1', () => {
    expect(getGameVersionWhereNative('keyCountOnPoints')).toBe('0.6.1');
  });
});
