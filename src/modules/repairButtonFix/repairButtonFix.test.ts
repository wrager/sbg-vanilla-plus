import { repairButtonFix } from './repairButtonFix';

function createRepairButton(): HTMLButtonElement {
  const button = document.createElement('button');
  button.id = 'repair';
  document.body.appendChild(button);
  return button;
}

describe('repairButtonFix', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(async () => {
    await repairButtonFix.disable();
    jest.useRealTimers();
    document.body.innerHTML = '';
  });

  test('id, fix-категория, defaultEnabled, локализованные name/description', () => {
    expect(repairButtonFix.id).toBe('repairButtonFix');
    expect(repairButtonFix.category).toBe('fix');
    expect(repairButtonFix.defaultEnabled).toBe(true);
    expect(repairButtonFix.name.ru).toBeTruthy();
    expect(repairButtonFix.name.en).toBeTruthy();
    expect(repairButtonFix.description.ru).toBeTruthy();
    expect(repairButtonFix.description.en).toBeTruthy();
  });

  test('locked висит >10с - класс и disabled сняты автоматически', async () => {
    await repairButtonFix.enable();
    const button = createRepairButton();
    await Promise.resolve();

    button.classList.add('locked');
    button.setAttribute('disabled', '');
    await Promise.resolve();

    jest.advanceTimersByTime(10001);

    expect(button.classList.contains('locked')).toBe(false);
    expect(button.hasAttribute('disabled')).toBe(false);
  });

  test('locked снят игрой до таймаута - модуль не вмешивается', async () => {
    await repairButtonFix.enable();
    const button = createRepairButton();
    await Promise.resolve();

    button.classList.add('locked');
    button.setAttribute('disabled', '');
    await Promise.resolve();

    jest.advanceTimersByTime(500);
    button.classList.remove('locked');
    button.removeAttribute('disabled');
    await Promise.resolve();

    jest.advanceTimersByTime(15000);

    expect(button.classList.contains('locked')).toBe(false);
    expect(button.hasAttribute('disabled')).toBe(false);
  });

  test('повторное добавление locked не плодит таймеров - только один unstick', async () => {
    await repairButtonFix.enable();
    const button = createRepairButton();
    await Promise.resolve();

    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    button.classList.add('locked');
    await Promise.resolve();
    // Игра не сняла - повторный mutation на том же class всё ещё locked.
    button.classList.add('locked');
    await Promise.resolve();

    jest.advanceTimersByTime(10001);

    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  test('locked на чужой кнопке не триггерит unstick', async () => {
    await repairButtonFix.enable();
    const other = document.createElement('button');
    other.id = 'something-else';
    document.body.appendChild(other);
    await Promise.resolve();

    other.classList.add('locked');
    other.setAttribute('disabled', '');
    await Promise.resolve();

    jest.advanceTimersByTime(15000);

    expect(other.classList.contains('locked')).toBe(true);
    expect(other.hasAttribute('disabled')).toBe(true);
  });

  test('disable снимает observer - locked после disable не триггерит unstick', async () => {
    await repairButtonFix.enable();
    const button = createRepairButton();
    await Promise.resolve();
    await repairButtonFix.disable();

    button.classList.add('locked');
    button.setAttribute('disabled', '');
    await Promise.resolve();

    jest.advanceTimersByTime(15000);

    expect(button.classList.contains('locked')).toBe(true);
    expect(button.hasAttribute('disabled')).toBe(true);
  });

  test('disable отменяет уже запущенный stuckTimer', async () => {
    await repairButtonFix.enable();
    const button = createRepairButton();
    await Promise.resolve();

    button.classList.add('locked');
    button.setAttribute('disabled', '');
    await Promise.resolve();

    jest.advanceTimersByTime(500);
    await repairButtonFix.disable();

    jest.advanceTimersByTime(15000);

    expect(button.classList.contains('locked')).toBe(true);
    expect(button.hasAttribute('disabled')).toBe(true);
  });
});
