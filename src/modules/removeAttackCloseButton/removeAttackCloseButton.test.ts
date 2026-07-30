import { removeAttackCloseButton } from './removeAttackCloseButton';

const globals = window as unknown as Record<string, unknown>;

interface IAttackUi {
  attackButton: HTMLButtonElement;
  slider: HTMLDivElement;
  closeButton: HTMLButtonElement | null;
}

/** Разметка режима атаки по refs/game/index.html:90,113-127 */
function createAttackUi({ open = false, withCloseButton = true } = {}): IAttackUi {
  const attackButton = document.createElement('button');
  attackButton.id = 'attack-menu';
  attackButton.setAttribute('data-i18n', 'menu.attack');
  attackButton.textContent = 'Атака';
  document.body.appendChild(attackButton);

  const slider = document.createElement('div');
  slider.className = open ? 'attack-slider-wrp' : 'attack-slider-wrp hidden';
  document.body.appendChild(slider);

  const fireButton = document.createElement('button');
  fireButton.id = 'attack-slider-fire';
  slider.appendChild(fireButton);

  let closeButton: HTMLButtonElement | null = null;
  if (withCloseButton) {
    closeButton = document.createElement('button');
    closeButton.id = 'attack-slider-close';
    closeButton.setAttribute('data-i18n', 'buttons.close');
    closeButton.textContent = 'Закрыть';
    slider.appendChild(closeButton);
  }

  return { attackButton, slider, closeButton };
}

/** Игровой обработчик клика на #attack-menu висит на самой кнопке */
function attachGameHandler(button: HTMLElement): jest.Mock {
  const handler = jest.fn();
  button.addEventListener('click', handler);
  return handler;
}

function openAttackMode(slider: HTMLElement): Promise<void> {
  slider.classList.remove('hidden');
  return Promise.resolve();
}

function closeAttackMode(slider: HTMLElement): Promise<void> {
  slider.classList.add('hidden');
  return Promise.resolve();
}

describe('removeAttackCloseButton', () => {
  afterEach(async () => {
    await removeAttackCloseButton.disable();
    delete globals.i18next;
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    localStorage.clear();
  });

  test('id, ui-категория, defaultEnabled, локализованные name/description', () => {
    expect(removeAttackCloseButton.id).toBe('removeAttackCloseButton');
    expect(removeAttackCloseButton.category).toBe('ui');
    expect(removeAttackCloseButton.defaultEnabled).toBe(true);
    expect(removeAttackCloseButton.name.ru).toBeTruthy();
    expect(removeAttackCloseButton.name.en).toBeTruthy();
    expect(removeAttackCloseButton.description.ru).toBeTruthy();
    expect(removeAttackCloseButton.description.en).toBeTruthy();
  });

  describe('стили', () => {
    test('enable вставляет style-элемент', async () => {
      createAttackUi();
      await removeAttackCloseButton.enable();
      expect(document.getElementById('svp-removeAttackCloseButton')).not.toBeNull();
    });

    test('disable убирает style-элемент', async () => {
      createAttackUi();
      await removeAttackCloseButton.enable();
      await removeAttackCloseButton.disable();
      expect(document.getElementById('svp-removeAttackCloseButton')).toBeNull();
    });

    test('повторный enable не плодит style-элементы', async () => {
      createAttackUi();
      await removeAttackCloseButton.enable();
      await removeAttackCloseButton.enable();
      expect(document.querySelectorAll('#svp-removeAttackCloseButton').length).toBe(1);
    });
  });

  describe('подпись кнопки', () => {
    test('режим атаки открыт - подпись с нативной «Закрыть», data-i18n снят', async () => {
      const { attackButton, slider } = createAttackUi();
      await removeAttackCloseButton.enable();

      await openAttackMode(slider);

      expect(attackButton.textContent).toBe('Закрыть');
      expect(attackButton.hasAttribute('data-i18n')).toBe(false);
    });

    test('подпись берётся с кнопки, а не из переводов игры', async () => {
      const { attackButton, slider, closeButton } = createAttackUi();
      closeButton?.replaceChildren('Close');
      globals.i18next = { t: () => 'перевод по ключу' };
      await removeAttackCloseButton.enable();

      await openAttackMode(slider);

      expect(attackButton.textContent).toBe('Close');
    });

    test('нативная «Закрыть» без текста - подпись остаётся «Атака»', async () => {
      const { attackButton, slider, closeButton } = createAttackUi();
      closeButton?.replaceChildren();
      await removeAttackCloseButton.enable();

      await openAttackMode(slider);

      expect(attackButton.textContent).toBe('Атака');
      expect(attackButton.getAttribute('data-i18n')).toBe('menu.attack');
    });

    test('нативной «Закрыть» в разметке нет - подпись остаётся «Атака»', async () => {
      const { attackButton, slider } = createAttackUi({ withCloseButton: false });
      await removeAttackCloseButton.enable();

      await openAttackMode(slider);

      expect(attackButton.textContent).toBe('Атака');
    });

    test('режим атаки закрыт - подпись «Атака» и data-i18n на месте', async () => {
      const { attackButton, slider } = createAttackUi();
      await removeAttackCloseButton.enable();

      await openAttackMode(slider);
      await closeAttackMode(slider);

      expect(attackButton.textContent).toBe('Атака');
      expect(attackButton.getAttribute('data-i18n')).toBe('menu.attack');
    });

    test('модуль включён при уже открытом режиме - подпись сразу «Закрыть»', async () => {
      const { attackButton } = createAttackUi({ open: true });

      await removeAttackCloseButton.enable();

      expect(attackButton.textContent).toBe('Закрыть');
    });

    test('disable при открытом режиме возвращает подпись «Атака»', async () => {
      const { attackButton, slider } = createAttackUi();
      await removeAttackCloseButton.enable();
      await openAttackMode(slider);

      await removeAttackCloseButton.disable();

      expect(attackButton.textContent).toBe('Атака');
      expect(attackButton.getAttribute('data-i18n')).toBe('menu.attack');
    });
  });

  describe('действие кнопки', () => {
    test('клик в режиме атаки уходит на нативную «Закрыть», игровой обработчик не зовётся', async () => {
      const { attackButton, slider, closeButton } = createAttackUi();
      const gameHandler = attachGameHandler(attackButton);
      const closeHandler = jest.fn();
      closeButton?.addEventListener('click', closeHandler);
      await removeAttackCloseButton.enable();
      await openAttackMode(slider);

      attackButton.click();

      expect(closeHandler).toHaveBeenCalledTimes(1);
      expect(gameHandler).not.toHaveBeenCalled();
    });

    test('клик вне режима атаки отдаётся игре', async () => {
      const { attackButton, closeButton } = createAttackUi();
      const gameHandler = attachGameHandler(attackButton);
      const closeHandler = jest.fn();
      closeButton?.addEventListener('click', closeHandler);
      await removeAttackCloseButton.enable();

      attackButton.click();

      expect(gameHandler).toHaveBeenCalledTimes(1);
      expect(closeHandler).not.toHaveBeenCalled();
    });

    test('нативной «Закрыть» в разметке нет - клик отдаётся игре', async () => {
      const { attackButton, slider } = createAttackUi({ withCloseButton: false });
      const gameHandler = attachGameHandler(attackButton);
      await removeAttackCloseButton.enable();
      await openAttackMode(slider);

      attackButton.click();

      expect(gameHandler).toHaveBeenCalledTimes(1);
    });

    test('после disable клик снова отдаётся игре', async () => {
      const { attackButton, slider, closeButton } = createAttackUi();
      const gameHandler = attachGameHandler(attackButton);
      const closeHandler = jest.fn();
      closeButton?.addEventListener('click', closeHandler);
      await removeAttackCloseButton.enable();
      await openAttackMode(slider);
      await removeAttackCloseButton.disable();

      attackButton.click();

      expect(gameHandler).toHaveBeenCalledTimes(1);
      expect(closeHandler).not.toHaveBeenCalled();
    });

    test('клик по нативной «Закрыть» не перехватывается', async () => {
      const { slider, closeButton } = createAttackUi();
      const closeHandler = jest.fn();
      closeButton?.addEventListener('click', closeHandler);
      await removeAttackCloseButton.enable();
      await openAttackMode(slider);

      closeButton?.click();

      expect(closeHandler).toHaveBeenCalledTimes(1);
    });

    test('игра спрятала слайдер (вход в режим рисования) - клик снова открывает атаку', async () => {
      const { attackButton, slider, closeButton } = createAttackUi({ open: true });
      const gameHandler = attachGameHandler(attackButton);
      const closeHandler = jest.fn();
      closeButton?.addEventListener('click', closeHandler);
      await removeAttackCloseButton.enable();

      await closeAttackMode(slider);
      attackButton.click();

      expect(gameHandler).toHaveBeenCalledTimes(1);
      expect(closeHandler).not.toHaveBeenCalled();
    });
  });
});
