import {
  compareVersions,
  getDetectedVersion,
  initGameVersionDetection,
  isModuleConflictingWithCurrentGame,
  isModuleNativeInCurrentGame,
  isSbgAtLeast,
  resetDetectedVersionForTest,
  setDetectedVersionForTest,
} from './gameVersion';

const originalFetch: typeof window.fetch | undefined = window.fetch;

function installFetchMock(mock: jest.Mock): void {
  Object.defineProperty(window, 'fetch', { value: mock, writable: true, configurable: true });
}

function restoreFetch(): void {
  if (originalFetch) {
    Object.defineProperty(window, 'fetch', {
      value: originalFetch,
      writable: true,
      configurable: true,
    });
  } else {
    // @ts-expect-error — jsdom не даёт fetch по умолчанию, удаляем свойство
    delete window.fetch;
  }
}

function mockFetchReturningVersion(rawVersionHeader: string | null): jest.Mock {
  const mock = jest.fn().mockImplementation(() => {
    const headers = new Headers();
    if (rawVersionHeader !== null) headers.set('x-sbg-version', rawVersionHeader);
    return Promise.resolve(new Response(null, { status: 404, headers }));
  });
  installFetchMock(mock);
  return mock;
}

describe('initGameVersionDetection', () => {
  afterEach(() => {
    resetDetectedVersionForTest();
    restoreFetch();
    jest.restoreAllMocks();
  });

  test('извлекает версию из заголовка x-sbg-version', async () => {
    mockFetchReturningVersion('0.6.0');
    await initGameVersionDetection();
    expect(getDetectedVersion()).toBe('0.6.0');
  });

  test('нормализует pre-release суффикс: 0.6.1-beta → 0.6.1', async () => {
    mockFetchReturningVersion('0.6.1-beta');
    await initGameVersionDetection();
    expect(getDetectedVersion()).toBe('0.6.1');
  });

  test('если заголовка нет — версия null', async () => {
    mockFetchReturningVersion(null);
    await initGameVersionDetection();
    expect(getDetectedVersion()).toBeNull();
  });

  test('если fetch падает — версия null', async () => {
    installFetchMock(jest.fn().mockRejectedValue(new Error('network down')));
    await initGameVersionDetection();
    expect(getDetectedVersion()).toBeNull();
  });

  test('использует HEAD /api/version — лёгкий запрос без тела', async () => {
    const mock = mockFetchReturningVersion('0.6.0');
    await initGameVersionDetection();
    expect(mock).toHaveBeenCalledWith('/api/version', { method: 'HEAD' });
  });
});

describe('getDetectedVersion без init', () => {
  afterEach(() => {
    resetDetectedVersionForTest();
    jest.restoreAllMocks();
  });

  test('без предварительного init возвращает null и пишет warning', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation();
    expect(getDetectedVersion()).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('initGameVersionDetection'));
  });
});

describe('compareVersions', () => {
  test('равные версии', () => {
    expect(compareVersions('0.6.1', '0.6.1')).toBe(0);
  });

  test('patch-bump больше', () => {
    expect(compareVersions('0.6.2', '0.6.1')).toBeGreaterThan(0);
  });

  test('minor-bump перебивает patch', () => {
    expect(compareVersions('0.7.0', '0.6.99')).toBeGreaterThan(0);
  });

  test('короткая длина трактуется как нули в хвосте', () => {
    expect(compareVersions('0.6', '0.6.0')).toBe(0);
    expect(compareVersions('0.6', '0.6.1')).toBeLessThan(0);
  });
});

describe('isSbgAtLeast', () => {
  afterEach(() => {
    resetDetectedVersionForTest();
  });

  test('0.6.1 >= 0.6.1 → true', () => {
    setDetectedVersionForTest('0.6.1');
    expect(isSbgAtLeast('0.6.1')).toBe(true);
  });

  test('будущая 0.6.2 >= 0.6.1 (правила 0.6.1 применяются и дальше)', () => {
    setDetectedVersionForTest('0.6.2');
    expect(isSbgAtLeast('0.6.1')).toBe(true);
  });

  test('0.7.0 >= 0.6.1', () => {
    setDetectedVersionForTest('0.7.0');
    expect(isSbgAtLeast('0.6.1')).toBe(true);
  });

  test('0.6.0 < 0.6.1 → false', () => {
    setDetectedVersionForTest('0.6.0');
    expect(isSbgAtLeast('0.6.1')).toBe(false);
  });

  test('версия не определена → false (safe default: модули работают как на старой версии)', () => {
    setDetectedVersionForTest(null);
    expect(isSbgAtLeast('0.6.1')).toBe(false);
  });
});

describe('isModuleNativeInCurrentGame', () => {
  afterEach(() => {
    resetDetectedVersionForTest();
  });

  test('без детекта любой модуль считается нативно не реализованным', () => {
    setDetectedVersionForTest(null);
    expect(isModuleNativeInCurrentGame('favoritedPoints')).toBe(false);
  });

  test('на 0.6.0 native-модули не подавляются', () => {
    setDetectedVersionForTest('0.6.0');
    expect(isModuleNativeInCurrentGame('favoritedPoints')).toBe(false);
  });

  test('на 0.6.1 favoritedPoints считается нативно реализованным', () => {
    setDetectedVersionForTest('0.6.1');
    expect(isModuleNativeInCurrentGame('favoritedPoints')).toBe(true);
  });

  test('на будущей 0.6.2 тоже считается нативно реализованным', () => {
    setDetectedVersionForTest('0.6.2');
    expect(isModuleNativeInCurrentGame('favoritedPoints')).toBe(true);
  });

  test('на 0.6.1 модуль вне списка не подавляется', () => {
    setDetectedVersionForTest('0.6.1');
    expect(isModuleNativeInCurrentGame('enhancedMainScreen')).toBe(false);
  });

  test('на 0.6.1 все 7 deprecated-модулей маркированы', () => {
    setDetectedVersionForTest('0.6.1');
    const deprecated = [
      'favoritedPoints',
      'inventoryCleanup',
      'keyCountOnPoints',
      'repairAtFullCharge',
      'ngrsZoom',
      'singleFingerRotation',
      'nextPointNavigation',
    ];
    for (const id of deprecated) {
      expect(isModuleNativeInCurrentGame(id)).toBe(true);
    }
  });

  test('на 0.6.1 swipeToClosePopup НЕ native (это конфликт)', () => {
    setDetectedVersionForTest('0.6.1');
    expect(isModuleNativeInCurrentGame('swipeToClosePopup')).toBe(false);
  });
});

describe('isModuleConflictingWithCurrentGame', () => {
  afterEach(() => {
    resetDetectedVersionForTest();
  });

  test('без детекта swipeToClosePopup не конфликтует', () => {
    setDetectedVersionForTest(null);
    expect(isModuleConflictingWithCurrentGame('swipeToClosePopup')).toBe(false);
  });

  test('на 0.6.0 swipeToClosePopup не конфликтует (игра ещё не перехватывает .info)', () => {
    setDetectedVersionForTest('0.6.0');
    expect(isModuleConflictingWithCurrentGame('swipeToClosePopup')).toBe(false);
  });

  test('на 0.6.1 swipeToClosePopup конфликтует', () => {
    setDetectedVersionForTest('0.6.1');
    expect(isModuleConflictingWithCurrentGame('swipeToClosePopup')).toBe(true);
  });

  test('на 0.6.1 native-модули не считаются конфликтующими', () => {
    setDetectedVersionForTest('0.6.1');
    expect(isModuleConflictingWithCurrentGame('favoritedPoints')).toBe(false);
  });
});
