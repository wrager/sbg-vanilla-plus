// Полифиллы подключены через setupFiles, поэтому здесь проверяется не импорт,
// а то состояние окружения, на которое опираются остальные suite'ы.
describe('jestPolyfills', () => {
  test('язык браузера зафиксирован проектом, а не дефолтом jsdom', () => {
    expect(navigator.language).toBe('en-US');
  });

  // Подмена языка в тестах идёт только через defineProperty: свойство отдано
  // нередактируемым, как и нативное, а тип navigator.language readonly.
  test('язык браузера подменяется собственным свойством поверх прототипа', () => {
    Object.defineProperty(navigator, 'language', { value: 'ru-RU', configurable: true });
    try {
      expect(navigator.language).toBe('ru-RU');
    } finally {
      Reflect.deleteProperty(navigator, 'language');
    }
    expect(navigator.language).toBe('en-US');
  });

  test('matchMedia отвечает "запрос не совпадает" - светлая системная тема', () => {
    expect(matchMedia('(prefers-color-scheme: dark)').matches).toBe(false);
  });

  // Подменяется сама функция: объект ответа создаётся на каждый вызов, поэтому
  // правка matches у ранее возвращённого на следующий вызов не влияет.
  test('matchMedia подменяется через spyOn целиком', () => {
    const nativeMatchMedia = window.matchMedia.bind(window);
    const stubbed = jest.spyOn(window, 'matchMedia').mockImplementation((query: string) => {
      const list = nativeMatchMedia(query);
      Object.defineProperty(list, 'matches', { value: true, configurable: true });
      return list;
    });
    try {
      expect(matchMedia('(prefers-color-scheme: dark)').matches).toBe(true);
    } finally {
      stubbed.mockRestore();
    }
  });
});
