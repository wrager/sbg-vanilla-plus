import {
  resetDetectedVersionForTest,
  SBG_COMPATIBLE_VERSIONS,
  setDetectedVersionForTest,
} from './gameVersion';
import { ensureSbgVersionSupported } from './gameVersionPrompt';
import { isDisabled } from './killswitch';

// Заведомо отсутствует в SBG_COMPATIBLE_VERSIONS при любой целевой версии игры.
// Раньше здесь стояла конкретная «будущая» версия, и тесты падали в тот момент,
// когда скрипт переводили на неё.
const UNSUPPORTED_VERSION = '999.0.0';

describe('ensureSbgVersionSupported', () => {
  let confirmSpy: jest.SpyInstance;

  beforeEach(() => {
    sessionStorage.clear();
    confirmSpy = jest.spyOn(window, 'confirm').mockImplementation(() => true);
  });

  afterEach(() => {
    resetDetectedVersionForTest();
    confirmSpy.mockRestore();
    localStorage.clear();
  });

  // Инвариант UNSUPPORTED_VERSION проверяется, а не объявляется комментарием:
  // попади версия в список (несколько элементов, опечатка) - кейсы с confirm
  // тихо переехали бы на совместимую ветку и остались зелёными.
  test('UNSUPPORTED_VERSION отсутствует в списке совместимых', () => {
    expect(SBG_COMPATIBLE_VERSIONS).not.toContain(UNSUPPORTED_VERSION);
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
    setDetectedVersionForTest(UNSUPPORTED_VERSION);
    confirmSpy.mockReturnValue(true);
    expect(ensureSbgVersionSupported()).toBe(true);
    expect(confirmSpy).toHaveBeenCalledTimes(1);
  });

  test('несовместимая версия + Cancel → возвращаем false, kill switch НЕ ставится', () => {
    setDetectedVersionForTest(UNSUPPORTED_VERSION);
    confirmSpy.mockReturnValue(false);
    expect(ensureSbgVersionSupported()).toBe(false);
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    // Выбор не должен персиститься: после reload пользователь снова увидит
    // вопрос. Иначе один клик на «Отмена» похоронил бы скрипт до очистки
    // sessionStorage.
    expect(isDisabled()).toBe(false);
  });

  test('confirm-сообщение называет обнаруженную и поддерживаемые версии', () => {
    setDetectedVersionForTest(UNSUPPORTED_VERSION);
    confirmSpy.mockReturnValue(true);
    ensureSbgVersionSupported();
    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining(UNSUPPORTED_VERSION));
    for (const v of SBG_COMPATIBLE_VERSIONS) {
      expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining(v));
    }
  });

  // Диалог показывается до запуска модулей, но локализация от версии игры не
  // зависит: иначе игрок с английской игрой получал бы русский текст поверх неё.
  test('confirm-сообщение по-русски при языке игры ru', () => {
    localStorage.setItem('settings', JSON.stringify({ lang: 'ru' }));
    setDetectedVersionForTest(UNSUPPORTED_VERSION);

    ensureSbgVersionSupported();

    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining('не тестировался'));
  });

  test('confirm-сообщение по-английски при языке игры en', () => {
    localStorage.setItem('settings', JSON.stringify({ lang: 'en' }));
    setDetectedVersionForTest(UNSUPPORTED_VERSION);

    ensureSbgVersionSupported();

    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining('has not been tested'));
  });

  test('выбор не запоминается — confirm показывается при каждом вызове', () => {
    setDetectedVersionForTest(UNSUPPORTED_VERSION);
    confirmSpy.mockReturnValue(false);
    ensureSbgVersionSupported();
    ensureSbgVersionSupported();
    ensureSbgVersionSupported();
    expect(confirmSpy).toHaveBeenCalledTimes(3);
  });
});
