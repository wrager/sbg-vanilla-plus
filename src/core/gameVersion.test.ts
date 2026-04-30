import {
  compareVersions,
  getDetectedVersion,
  initGameVersionDetection,
  installGameVersionCapture,
  isModuleConflictingWithCurrentGame,
  isModuleNativeInCurrentGame,
  isSbgAtLeast,
  isSbgGreaterThan,
  resetDetectedVersionForTest,
  setDetectedVersionForTest,
} from './gameVersion';

const originalFetch: typeof window.fetch | undefined = window.fetch;

function installFetchStub(stub: jest.Mock): void {
  Object.defineProperty(window, 'fetch', { value: stub, writable: true, configurable: true });
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

function fetchStubReturning(rawVersionHeader: string | null, status = 200): jest.Mock {
  return jest.fn().mockImplementation(() => {
    const headers = new Headers();
    if (rawVersionHeader !== null) headers.set('x-sbg-version', rawVersionHeader);
    return Promise.resolve(new Response(null, { status, headers }));
  });
}

describe('installGameVersionCapture', () => {
  afterEach(() => {
    resetDetectedVersionForTest();
    restoreFetch();
    jest.restoreAllMocks();
  });

  test('захватывает версию из заголовка первого /api/* ответа', async () => {
    installFetchStub(fetchStubReturning('0.6.0'));
    installGameVersionCapture();
    await window.fetch('/api/self');
    // Дожидаемся microtask .then() внутри перехватчика.
    await Promise.resolve();
    expect(getDetectedVersion()).toBe('0.6.0');
  });

  test('нормализует pre-release суффикс: 0.6.1-beta → 0.6.1', async () => {
    installFetchStub(fetchStubReturning('0.6.1-beta'));
    installGameVersionCapture();
    await window.fetch('/api/self');
    await Promise.resolve();
    expect(getDetectedVersion()).toBe('0.6.1');
  });

  test('если ответ без заголовка — ждём следующий /api/*', async () => {
    let callIndex = 0;
    const stub = jest.fn().mockImplementation(() => {
      const headers = new Headers();
      if (callIndex === 1) headers.set('x-sbg-version', '0.6.0');
      callIndex += 1;
      return Promise.resolve(new Response(null, { status: 200, headers }));
    });
    installFetchStub(stub);
    installGameVersionCapture();

    await window.fetch('/api/liveness');
    await Promise.resolve();
    // После первого ответа версия ещё не пойманная — кэш undefined.

    await window.fetch('/api/self');
    await Promise.resolve();
    expect(getDetectedVersion()).toBe('0.6.0');
  });

  test('первый пойманный заголовок побеждает — повторы не затирают', async () => {
    const versions = ['0.6.0', '0.7.0'];
    let callIndex = 0;
    const stub = jest.fn().mockImplementation(() => {
      const headers = new Headers();
      headers.set('x-sbg-version', versions[callIndex]);
      callIndex += 1;
      return Promise.resolve(new Response(null, { status: 200, headers }));
    });
    installFetchStub(stub);
    installGameVersionCapture();

    await window.fetch('/api/self');
    await Promise.resolve();
    await window.fetch('/api/inview');
    await Promise.resolve();

    expect(getDetectedVersion()).toBe('0.6.0');
  });

  test('оригинальный rejected fetch возвращает ошибку наружу, но не крашит перехватчик', async () => {
    installFetchStub(jest.fn().mockRejectedValue(new Error('network down')));
    installGameVersionCapture();
    await expect(window.fetch('/api/self')).rejects.toThrow('network down');
  });

  test('прокидывает аргументы и возвращает исходный Response без подмены', async () => {
    const stub = fetchStubReturning('0.6.0', 201);
    installFetchStub(stub);
    installGameVersionCapture();

    const response = await window.fetch('/api/self', { method: 'POST' });
    expect(stub).toHaveBeenCalledWith('/api/self', { method: 'POST' });
    expect(response.status).toBe(201);
  });
});

describe('initGameVersionDetection', () => {
  afterEach(() => {
    resetDetectedVersionForTest();
    restoreFetch();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test('резолвится сразу, если версия уже захвачена', async () => {
    setDetectedVersionForTest('0.6.1');
    await initGameVersionDetection();
    expect(getDetectedVersion()).toBe('0.6.1');
  });

  test('резолвится, как только перехватчик ловит версию', async () => {
    installFetchStub(fetchStubReturning('0.6.0'));
    installGameVersionCapture();

    const detectionPromise = initGameVersionDetection();
    await window.fetch('/api/self');
    await detectionPromise;

    expect(getDetectedVersion()).toBe('0.6.0');
  });

  test('если за таймаут никто не принёс заголовок — фиксирует null', async () => {
    jest.useFakeTimers();
    const detectionPromise = initGameVersionDetection(5000);
    jest.advanceTimersByTime(5000);
    await detectionPromise;
    expect(getDetectedVersion()).toBeNull();
  });

  test('повторный вызов после таймаута резолвится сразу', async () => {
    jest.useFakeTimers();
    const first = initGameVersionDetection(5000);
    jest.advanceTimersByTime(5000);
    await first;
    jest.useRealTimers();

    await initGameVersionDetection();
    expect(getDetectedVersion()).toBeNull();
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

describe('isSbgGreaterThan', () => {
  afterEach(() => {
    resetDetectedVersionForTest();
  });

  test('0.6.1 > 0.6.0 → true', () => {
    setDetectedVersionForTest('0.6.1');
    expect(isSbgGreaterThan('0.6.0')).toBe(true);
  });

  test('будущая 0.6.2 > 0.6.0 → true', () => {
    setDetectedVersionForTest('0.6.2');
    expect(isSbgGreaterThan('0.6.0')).toBe(true);
  });

  test('0.7.0 > 0.6.0 → true', () => {
    setDetectedVersionForTest('0.7.0');
    expect(isSbgGreaterThan('0.6.0')).toBe(true);
  });

  test('0.6.0 не больше 0.6.0 → false (строгое неравенство)', () => {
    setDetectedVersionForTest('0.6.0');
    expect(isSbgGreaterThan('0.6.0')).toBe(false);
  });

  test('0.5.9 < 0.6.0 → false', () => {
    setDetectedVersionForTest('0.5.9');
    expect(isSbgGreaterThan('0.6.0')).toBe(false);
  });

  test('версия не определена → false (safe default: модули работают как на старой версии)', () => {
    setDetectedVersionForTest(null);
    expect(isSbgGreaterThan('0.6.0')).toBe(false);
  });
});

describe('isModuleNativeInCurrentGame', () => {
  afterEach(() => {
    resetDetectedVersionForTest();
  });

  test('без детекта любой модуль считается нативно не реализованным', () => {
    setDetectedVersionForTest(null);
    expect(isModuleNativeInCurrentGame('any-module-id')).toBe(false);
  });

  test('на 0.6.0 native-модули не подавляются', () => {
    setDetectedVersionForTest('0.6.0');
    expect(isModuleNativeInCurrentGame('any-module-id')).toBe(false);
  });

  test('на 0.6.1 пустое множество NATIVE_SINCE_061: ни один модуль не помечен как нативный', () => {
    // Сет изначально содержал id модулей, которые в 0.6.1 минимальной адаптации
    // подавлялись (favoritedPoints, inventoryCleanup, keyCountOnPoints,
    // singleFingerRotation, nextPointNavigation, repairAtFullCharge, ngrsZoom).
    // После полноценной адаптации одни модули возвращены (с переосмыслением /
    // runtime-детекцией native), другие удалены физически (repairAtFullCharge,
    // ngrsZoom), swipeToClosePopup возвращён под новым жестом, keyCountOnPoints
    // переименован в improvedPointText (промежуточные rename keyCountFix и
    // pointTextFix до публичного релиза не дошли), nextPointNavigation переосмыслен как betterNextPointSwipe
    // - заменяет нативный горизонтальный свайп через runtime-override на
    // Hammer.Manager.prototype.emit + наша приоритетная навигация в радиусе
    // взаимодействия (нативный ходил по всем точкам в зоне видимости).
    // Сет пуст.
    setDetectedVersionForTest('0.6.1');
    expect(isModuleNativeInCurrentGame('favoritedPoints')).toBe(false);
    expect(isModuleNativeInCurrentGame('inventoryCleanup')).toBe(false);
    expect(isModuleNativeInCurrentGame('improvedPointText')).toBe(false);
    expect(isModuleNativeInCurrentGame('singleFingerRotation')).toBe(false);
    expect(isModuleNativeInCurrentGame('betterNextPointSwipe')).toBe(false);
    expect(isModuleNativeInCurrentGame('repairAtFullCharge')).toBe(false);
    expect(isModuleNativeInCurrentGame('ngrsZoom')).toBe(false);
  });
});

describe('isModuleConflictingWithCurrentGame', () => {
  afterEach(() => {
    resetDetectedVersionForTest();
  });

  test('пустое множество DEPRECATED_MODULES_CONFLICTED: ни один модуль не помечен как конфликтующий', () => {
    setDetectedVersionForTest('0.6.1');
    expect(isModuleConflictingWithCurrentGame('swipeToClosePopup')).toBe(false);
    expect(isModuleConflictingWithCurrentGame('favoritedPoints')).toBe(false);
  });
});
