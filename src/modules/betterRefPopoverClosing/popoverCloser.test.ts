import { installPopoverCloser, uninstallPopoverCloser } from './popoverCloser';

async function flushTasks(): Promise<void> {
  // closePopover откладывается через setTimeout(0) - flush task queue.
  await new Promise((resolve) => setTimeout(resolve, 0));
}

interface IPopperGlobal {
  createPopper: (reference: Element, popper: Element, options?: unknown) => unknown;
}

function setupPopperMock(): jest.Mock {
  // Фейковый Popper.createPopper: возвращает инстанс с минимальной структурой,
  // которую читает popoverCloser (state.elements.reference + destroy).
  const createPopper = jest.fn(
    (reference: Element, popper: Element): { state: object; destroy: jest.Mock } => ({
      state: { elements: { reference, popper } },
      destroy: jest.fn(),
    }),
  );
  (window as unknown as { Popper: IPopperGlobal }).Popper = { createPopper };
  return createPopper;
}

function teardownPopperMock(): void {
  delete (window as unknown as { Popper?: IPopperGlobal }).Popper;
}

function createPopover(): {
  popover: HTMLUListElement;
  favBtn: HTMLButtonElement;
  lockBtn: HTMLButtonElement;
  manageBtn: HTMLButtonElement;
} {
  const popover = document.createElement('ul');
  popover.className = 'inventory__ref-actions popover';

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

describe('popoverCloser - закрытие через симуляцию клика по reference', () => {
  let referenceClick: jest.Mock;
  let referenceElement: HTMLButtonElement;

  beforeEach(() => {
    setupPopperMock();
    referenceElement = document.createElement('button');
    referenceElement.className = 'inventory__item-actions';
    referenceClick = jest.fn();
    referenceElement.addEventListener('click', referenceClick);
    document.body.appendChild(referenceElement);
  });

  afterEach(() => {
    uninstallPopoverCloser();
    teardownPopperMock();
    document.body.innerHTML = '';
  });

  function simulateGameOpensPopover(popover: Element): void {
    // Имитируем работу игры: она вызывает Popper.createPopper(reference, popover, ...)
    // когда пользователь кликает троеточие. Наш перехват сохранит инстанс.
    const { Popper } = window as unknown as { Popper: IPopperGlobal };
    Popper.createPopper(referenceElement, popover);
  }

  test('клик favorite симулирует click reference-элемента (игра вызовет destroyPopover)', async () => {
    const { popover, favBtn } = createPopover();
    installPopoverCloser();
    await flushTasks();

    simulateGameOpensPopover(popover);

    favBtn.click();
    await flushTasks();

    expect(referenceClick).toHaveBeenCalledTimes(1);
  });

  test('клик locked симулирует click reference', async () => {
    const { popover, lockBtn } = createPopover();
    installPopoverCloser();
    await flushTasks();
    simulateGameOpensPopover(popover);

    lockBtn.click();
    await flushTasks();

    expect(referenceClick).toHaveBeenCalledTimes(1);
  });

  test('клик manage (Removal menu) симулирует click reference', async () => {
    const { popover, manageBtn } = createPopover();
    installPopoverCloser();
    await flushTasks();
    simulateGameOpensPopover(popover);

    manageBtn.click();
    await flushTasks();

    expect(referenceClick).toHaveBeenCalledTimes(1);
  });

  test('regression: симуляция клика срабатывает в task queue, НЕ в microtask - чтобы game sync handler успел отработать до закрытия popover', async () => {
    // HTML спецификация event dispatch выполняет microtask checkpoint после
    // КАЖДОГО bubble-listener-а на одном target. Если onActionClick запланирует
    // closePopover как microtask (`Promise.resolve().then`), checkpoint между
    // нашим listener-ом и game async listener-ом запустит destroyPopover ->
    // popovers.ref_actions=null. Затем game sync часть увидит null и сделает
    // early return до apiSend - action на сервер не уйдёт. Нужен setTimeout(0):
    // task запускается ПОСЛЕ полного click-события.
    const { popover, favBtn } = createPopover();
    installPopoverCloser();
    await flushTasks();
    simulateGameOpensPopover(popover);

    favBtn.click();
    expect(referenceClick).not.toHaveBeenCalled();

    // microtasks drain - закрытие НЕ должно произойти на этом этапе.
    await Promise.resolve();
    await Promise.resolve();
    expect(referenceClick).not.toHaveBeenCalled();

    // task queue drain - закрытие происходит здесь.
    await flushTasks();
    expect(referenceClick).toHaveBeenCalledTimes(1);
  });

  test('перехват createPopper срабатывает только для нашего popover (.inventory__ref-actions)', async () => {
    const { popover, favBtn } = createPopover();
    installPopoverCloser();
    await flushTasks();

    // Игра создаёт другой Popper - наш перехват не должен сохранить его как currentPopper.
    const otherPopover = document.createElement('div');
    otherPopover.className = 'some-other-popover';
    document.body.appendChild(otherPopover);
    const otherReference = document.createElement('button');
    document.body.appendChild(otherReference);
    const { Popper } = window as unknown as { Popper: IPopperGlobal };
    Popper.createPopper(otherReference, otherPopover);

    // Игра создаёт popover для .inventory__ref-actions.
    simulateGameOpensPopover(popover);

    favBtn.click();
    await flushTasks();

    // Должен быть кликнут именно наш reference (от .inventory__ref-actions),
    // не otherReference от чужого popover.
    expect(referenceClick).toHaveBeenCalledTimes(1);
  });

  test('uninstall: createPopper восстанавливается, кнопки больше не закрывают', async () => {
    const original = (window as unknown as { Popper: IPopperGlobal }).Popper.createPopper;
    const { popover, favBtn } = createPopover();
    installPopoverCloser();
    await flushTasks();

    // После install createPopper заменён.
    expect((window as unknown as { Popper: IPopperGlobal }).Popper.createPopper).not.toBe(original);

    uninstallPopoverCloser();

    // После uninstall - оригинал.
    expect((window as unknown as { Popper: IPopperGlobal }).Popper.createPopper).toBe(original);

    simulateGameOpensPopover(popover);
    favBtn.click();
    await flushTasks();
    expect(referenceClick).not.toHaveBeenCalled();
  });

  test('fallback: если popper не был перехвачен, popover скрывается через hidden', async () => {
    const { popover, favBtn } = createPopover();
    installPopoverCloser();
    await flushTasks();

    // Не вызываем simulateGameOpensPopover - currentPopper остаётся null.
    favBtn.click();
    await flushTasks();

    expect(referenceClick).not.toHaveBeenCalled();
    expect(popover.classList.contains('hidden')).toBe(true);
  });

  test('install до появления popover: ждёт через waitForElement', async () => {
    installPopoverCloser();
    await flushTasks();

    const { popover, favBtn } = createPopover();
    for (let i = 0; i < 10; i++) await flushTasks();
    simulateGameOpensPopover(popover);

    favBtn.click();
    await flushTasks();

    expect(referenceClick).toHaveBeenCalledTimes(1);
  });
});
