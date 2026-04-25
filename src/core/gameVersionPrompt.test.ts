import {
  resetDetectedVersionForTest,
  SBG_COMPATIBLE_VERSIONS,
  setDetectedVersionForTest,
} from './gameVersion';
import { ensureSbgVersionSupported } from './gameVersionPrompt';
import { isDisabled } from './killswitch';

describe('ensureSbgVersionSupported', () => {
  let confirmSpy: jest.SpyInstance;

  beforeEach(() => {
    sessionStorage.clear();
    confirmSpy = jest.spyOn(window, 'confirm').mockImplementation(() => true);
  });

  afterEach(() => {
    resetDetectedVersionForTest();
    confirmSpy.mockRestore();
  });

  test('версия не определена — считаем совместимой, confirm не показываем', () => {
    setDetectedVersionForTest(null);
    expect(ensureSbgVersionSupported()).toBe(true);
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  test('каждая версия из SBG_COMPATIBLE_VERSIONS считается поддерживаемой', () => {
    for (const v of SBG_COMPATIBLE_VERSIONS) {
      setDetectedVersionForTest(v);
      expect(ensureSbgVersionSupported()).toBe(true);
    }
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  test('несовместимая версия + OK → запускаем скрипт', () => {
    setDetectedVersionForTest('0.7.0');
    confirmSpy.mockReturnValue(true);
    expect(ensureSbgVersionSupported()).toBe(true);
    expect(confirmSpy).toHaveBeenCalledTimes(1);
  });

  test('несовместимая версия + Cancel → возвращаем false, kill switch НЕ ставится', () => {
    setDetectedVersionForTest('0.7.0');
    confirmSpy.mockReturnValue(false);
    expect(ensureSbgVersionSupported()).toBe(false);
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    // Выбор не должен персиститься: после reload пользователь снова увидит
    // вопрос. Иначе один клик на «Отмена» похоронил бы скрипт до очистки
    // sessionStorage.
    expect(isDisabled()).toBe(false);
  });

  test('confirm-сообщение называет обнаруженную и поддерживаемые версии', () => {
    setDetectedVersionForTest('0.7.0');
    confirmSpy.mockReturnValue(true);
    ensureSbgVersionSupported();
    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining('0.7.0'));
    for (const v of SBG_COMPATIBLE_VERSIONS) {
      expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining(v));
    }
  });

  test('выбор не запоминается — confirm показывается при каждом вызове', () => {
    setDetectedVersionForTest('0.7.0');
    confirmSpy.mockReturnValue(false);
    ensureSbgVersionSupported();
    ensureSbgVersionSupported();
    ensureSbgVersionSupported();
    expect(confirmSpy).toHaveBeenCalledTimes(3);
  });
});
