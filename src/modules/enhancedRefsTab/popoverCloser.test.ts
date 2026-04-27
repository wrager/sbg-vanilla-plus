import { installPopoverCloser, uninstallPopoverCloser } from './popoverCloser';

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function createPopover(): {
  popover: HTMLUListElement;
  favBtn: HTMLButtonElement;
  lockBtn: HTMLButtonElement;
  manageBtn: HTMLButtonElement;
} {
  // Структура из refs/game-beta/dom/body.html:415-423.
  const popover = document.createElement('ul');
  popover.className = 'inventory__ref-actions popover';
  // Без `hidden` - имитируем открытое меню.

  const favLi = document.createElement('li');
  favLi.className = 'inventory__ra-item';
  const favBtn = document.createElement('button');
  favBtn.dataset.flag = 'favorite';
  favLi.appendChild(favBtn);

  const lockLi = document.createElement('li');
  lockLi.className = 'inventory__ra-item';
  const lockBtn = document.createElement('button');
  lockBtn.dataset.flag = 'locked';
  lockLi.appendChild(lockBtn);

  const manageLi = document.createElement('li');
  manageLi.className = 'inventory__ra-item';
  const manageBtn = document.createElement('button');
  manageBtn.id = 'inventory__ra-manage';
  manageLi.appendChild(manageBtn);

  popover.append(favLi, lockLi, manageLi);
  document.body.appendChild(popover);
  return { popover, favBtn, lockBtn, manageBtn };
}

describe('popoverCloser', () => {
  afterEach(() => {
    uninstallPopoverCloser();
    document.body.innerHTML = '';
  });

  test('клик на favorite-кнопку добавляет hidden к popover', async () => {
    const { popover, favBtn } = createPopover();
    installPopoverCloser();
    await flushMicrotasks();

    favBtn.click();
    await flushMicrotasks();

    expect(popover.classList.contains('hidden')).toBe(true);
  });

  test('клик на locked-кнопку добавляет hidden', async () => {
    const { popover, lockBtn } = createPopover();
    installPopoverCloser();
    await flushMicrotasks();

    lockBtn.click();
    await flushMicrotasks();

    expect(popover.classList.contains('hidden')).toBe(true);
  });

  test('клик на manage-кнопку (Removal menu) добавляет hidden', async () => {
    const { popover, manageBtn } = createPopover();
    installPopoverCloser();
    await flushMicrotasks();

    manageBtn.click();
    await flushMicrotasks();

    expect(popover.classList.contains('hidden')).toBe(true);
  });

  test('закрытие происходит через микротаск, не синхронно', async () => {
    const { popover, favBtn } = createPopover();
    installPopoverCloser();
    await flushMicrotasks();

    favBtn.click();
    // Сразу после клика hidden ещё не должен быть установлен (микротаск не отработал).
    expect(popover.classList.contains('hidden')).toBe(false);

    await flushMicrotasks();
    expect(popover.classList.contains('hidden')).toBe(true);
  });

  test('uninstall: клики больше не закрывают popover', async () => {
    const { popover, favBtn } = createPopover();
    installPopoverCloser();
    await flushMicrotasks();

    uninstallPopoverCloser();
    favBtn.click();
    await flushMicrotasks();

    expect(popover.classList.contains('hidden')).toBe(false);
  });

  test('повторный enable->disable->enable: новый install корректно вешает listeners', async () => {
    const { popover, favBtn } = createPopover();
    installPopoverCloser();
    await flushMicrotasks();
    uninstallPopoverCloser();
    installPopoverCloser();
    await flushMicrotasks();

    favBtn.click();
    await flushMicrotasks();

    expect(popover.classList.contains('hidden')).toBe(true);
  });

  test('install до появления popover: ждёт через waitForElement', async () => {
    installPopoverCloser();
    // Popover ещё нет в DOM - waitForElement пока не зарезолвится.
    await flushMicrotasks();

    const { popover, favBtn } = createPopover();
    // После добавления popover MutationObserver внутри waitForElement подхватит элемент.
    // Дадим достаточно микротасков чтобы observer отработал.
    for (let i = 0; i < 10; i++) await flushMicrotasks();

    favBtn.click();
    await flushMicrotasks();

    expect(popover.classList.contains('hidden')).toBe(true);
  });
});
