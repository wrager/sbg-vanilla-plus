import {
  captureGameLabel,
  localizeGameElement,
  restoreGameLabel,
  setGameLabel,
  translateGameKey,
} from './gameI18n';

const globals = window as unknown as Record<string, unknown>;

function createButton(text: string, i18nKey: string | null): HTMLButtonElement {
  const button = document.createElement('button');
  button.textContent = text;
  if (i18nKey !== null) button.setAttribute('data-i18n', i18nKey);
  document.body.appendChild(button);
  return button;
}

describe('gameI18n', () => {
  afterEach(() => {
    delete globals.i18next;
    delete globals.$;
    document.body.innerHTML = '';
  });

  describe('translateGameKey', () => {
    test('в window лежит не i18next - null', () => {
      globals.i18next = { language: 'ru' };
      expect(translateGameKey('buttons.close')).toBeNull();
    });

    test('null-ключ - без обращения к i18next', () => {
      const translate = jest.fn();
      globals.i18next = { t: translate };
      expect(translateGameKey(null)).toBeNull();
      expect(translate).not.toHaveBeenCalled();
    });

    test('i18next недоступен - null', () => {
      expect(translateGameKey('buttons.close')).toBeNull();
    });

    test('i18next вернул не строку - null', () => {
      globals.i18next = { t: () => ({ key: 'buttons.close' }) };
      expect(translateGameKey('buttons.close')).toBeNull();
    });

    test('перевод по ключу', () => {
      globals.i18next = { t: (key: string) => (key === 'buttons.close' ? 'Закрыть' : '') };
      expect(translateGameKey('buttons.close')).toBe('Закрыть');
    });
  });

  test('captureGameLabel снимает текст и ключ перевода', () => {
    const button = createButton('Атака', 'menu.attack');
    expect(captureGameLabel(button)).toEqual({ text: 'Атака', i18nKey: 'menu.attack' });
  });

  test('setGameLabel ставит текст и снимает data-i18n', () => {
    const button = createButton('Атака', 'menu.attack');
    setGameLabel(button, 'Закрыть');
    expect(button.textContent).toBe('Закрыть');
    expect(button.hasAttribute('data-i18n')).toBe(false);
  });

  test('restoreGameLabel берёт свежий перевод и возвращает data-i18n', () => {
    const button = createButton('Атака', 'menu.attack');
    const label = captureGameLabel(button);
    setGameLabel(button, 'Закрыть');

    // Язык мог смениться, пока подпись была подменена: снимок текста устарел,
    // а перевод по ключу актуален.
    globals.i18next = { t: (key: string) => (key === 'menu.attack' ? 'Attack' : '') };
    restoreGameLabel(button, label);

    expect(button.textContent).toBe('Attack');
    expect(button.getAttribute('data-i18n')).toBe('menu.attack');
  });

  test('restoreGameLabel без i18next возвращает текст из снимка', () => {
    const button = createButton('Атака', 'menu.attack');
    const label = captureGameLabel(button);
    setGameLabel(button, 'Закрыть');

    restoreGameLabel(button, label);

    expect(button.textContent).toBe('Атака');
    expect(button.getAttribute('data-i18n')).toBe('menu.attack');
  });

  test('restoreGameLabel дёргает jqueryI18next localize()', () => {
    const button = createButton('Атака', 'menu.attack');
    const localize = jest.fn();
    globals.$ = () => ({ localize });

    restoreGameLabel(button, captureGameLabel(button));

    expect(localize).toHaveBeenCalledTimes(1);
  });

  test('localizeGameElement без jQuery не бросает', () => {
    const button = createButton('Атака', 'menu.attack');
    expect(() => {
      localizeGameElement(button);
    }).not.toThrow();
  });
});
