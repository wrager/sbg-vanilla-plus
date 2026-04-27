import {
  installRepairButtonOverride,
  parseEnergyPercent,
  uninstallRepairButtonOverride,
} from './repairButtonOverride';

// MutationObserver работает асинхронно — после атрибутной правки нужно дать
// микротаску прокачаться. Хелпер, чтобы не повторять `await Promise.resolve()`
// в каждом тесте.
async function flushObserver(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function createInventoryContent(tab: string): HTMLElement {
  // .inventory__content — корень, на который вешается observer (refs/game-beta/
  // dom/body.html:430). data-tab задаёт активную вкладку: 1=cores, 2=cats, 3=refs.
  const content = document.createElement('div');
  content.className = 'inventory__content';
  content.setAttribute('data-tab', tab);
  return content;
}

function createRefItem(opts: {
  pointGuid: string;
  energy?: number | null;
  loaded?: boolean;
  repairDisabled?: boolean;
}): HTMLElement {
  // Карточка реф-ключа из refs/game-beta/script.js:3392-3453: контейнер с
  // data-ref, .inventory__item-left (title + descr) и .inventory__ic-repair.
  const item = document.createElement('div');
  item.className = 'inventory__item';
  if (opts.loaded ?? true) item.classList.add('loaded');
  item.setAttribute('data-ref', opts.pointGuid);
  item.setAttribute('data-guid', `stack-${opts.pointGuid}`);

  const left = document.createElement('div');
  left.className = 'inventory__item-left';
  const descr = document.createElement('div');
  descr.className = 'inventory__item-descr';
  if (opts.energy !== null && opts.energy !== undefined) {
    const energySpan = document.createElement('span');
    energySpan.className = 'iid-energy';
    energySpan.textContent = `${opts.energy}% @ 4`;
    descr.appendChild(energySpan);
  }
  left.appendChild(descr);

  const repair = document.createElement('button');
  repair.className = 'inventory__ic-repair';
  if (opts.repairDisabled) repair.setAttribute('disabled', '');

  item.append(left, repair);
  return item;
}

describe('parseEnergyPercent', () => {
  test('формат «<percent>% @ <cores>» парсится в число', () => {
    expect(parseEnergyPercent('87% @ 4')).toBe(87);
    expect(parseEnergyPercent('100% @ 1')).toBe(100);
    expect(parseEnergyPercent('0% @ 0')).toBe(0);
  });

  test('значение с дробной частью (на случай локали)', () => {
    expect(parseEnergyPercent('87.5% @ 4')).toBe(87.5);
    expect(parseEnergyPercent('87,5% @ 4')).toBe(87.5);
  });

  test('пустые / невалидные строки → null', () => {
    expect(parseEnergyPercent('')).toBeNull();
    expect(parseEnergyPercent(null)).toBeNull();
    expect(parseEnergyPercent(undefined)).toBeNull();
    expect(parseEnergyPercent('загрузка...')).toBeNull();
  });
});

describe('repairButtonOverride — observer behaviour', () => {
  let content: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = '';
    content = createInventoryContent('3');
    document.body.appendChild(content);
  });

  afterEach(() => {
    uninstallRepairButtonOverride();
    document.body.innerHTML = '';
  });

  test('синхронный sync существующих карточек: 100% → disabled', async () => {
    const item = createRefItem({ pointGuid: 'p1', energy: 100 });
    content.appendChild(item);

    installRepairButtonOverride();
    await flushObserver();

    const repair = item.querySelector('.inventory__ic-repair');
    expect(repair?.hasAttribute('disabled')).toBe(true);
  });

  test('< 100% existing item: disabled не выставляется', async () => {
    const item = createRefItem({ pointGuid: 'p1', energy: 87 });
    content.appendChild(item);

    installRepairButtonOverride();
    await flushObserver();

    const repair = item.querySelector('.inventory__ic-repair');
    expect(repair?.hasAttribute('disabled')).toBe(false);
  });

  test('добавление новой карточки 100% после install: disabled', async () => {
    installRepairButtonOverride();
    await flushObserver();

    const item = createRefItem({ pointGuid: 'p2', energy: 100 });
    content.appendChild(item);
    await flushObserver();

    const repair = item.querySelector('.inventory__ic-repair');
    expect(repair?.hasAttribute('disabled')).toBe(true);
  });

  test('класс loaded появляется позже energy (типичный flow makeEntry): disabled выставится', async () => {
    // Игра в refs/game-beta/script.js:3568 переключает класс на `loaded`
    // ПОСЛЕ заполнения descr — обработать должны именно по этому событию.
    const item = createRefItem({ pointGuid: 'p3', energy: 100, loaded: false });
    content.appendChild(item);

    installRepairButtonOverride();
    await flushObserver();

    const repair = item.querySelector('.inventory__ic-repair');
    expect(repair?.hasAttribute('disabled')).toBe(false); // ещё не loaded

    item.classList.remove('loading');
    item.classList.add('loaded');
    await flushObserver();

    expect(repair?.hasAttribute('disabled')).toBe(true);
  });

  test('игра сняла disabled с repair при 100% энергии: возвращаем обратно', async () => {
    const item = createRefItem({ pointGuid: 'p4', energy: 100, repairDisabled: true });
    content.appendChild(item);

    installRepairButtonOverride();
    await flushObserver();

    const repair = item.querySelector<HTMLButtonElement>('.inventory__ic-repair');
    if (!repair) throw new Error('repair not found');

    // Имитируем игру: removeAttribute (как в makeEntry)
    repair.removeAttribute('disabled');
    await flushObserver();

    expect(repair.hasAttribute('disabled')).toBe(true);
  });

  test('игра сняла disabled при < 100%: оставляем активной', async () => {
    const item = createRefItem({ pointGuid: 'p5', energy: 50, repairDisabled: true });
    content.appendChild(item);

    installRepairButtonOverride();
    await flushObserver();

    const repair = item.querySelector<HTMLButtonElement>('.inventory__ic-repair');
    if (!repair) throw new Error('repair not found');

    repair.removeAttribute('disabled');
    await flushObserver();

    expect(repair.hasAttribute('disabled')).toBe(false);
  });

  test('после disable observer перестаёт реагировать на новые карточки', async () => {
    installRepairButtonOverride();
    await flushObserver();
    uninstallRepairButtonOverride();

    const item = createRefItem({ pointGuid: 'p6', energy: 100 });
    content.appendChild(item);
    await flushObserver();

    const repair = item.querySelector('.inventory__ic-repair');
    expect(repair?.hasAttribute('disabled')).toBe(false);
  });

  test('observer не циклится: наша запись disabled не вызывает повторных setAttribute', async () => {
    const item = createRefItem({ pointGuid: 'p7', energy: 100 });
    content.appendChild(item);

    installRepairButtonOverride();
    await flushObserver();

    const repair = item.querySelector<HTMLButtonElement>('.inventory__ic-repair');
    if (!repair) throw new Error('repair not found');

    const setAttrSpy = jest.spyOn(repair, 'setAttribute');
    // ждём ещё пару микротасков — за это время handleMutations не должен
    // снова дернуть setAttribute (наш WeakSet-страж).
    await flushObserver();
    await flushObserver();

    expect(setAttrSpy).not.toHaveBeenCalled();
  });
});
