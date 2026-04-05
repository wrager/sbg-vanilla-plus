import { installInventoryFilter, uninstallInventoryFilter } from './inventoryFilter';
import { addFavorite, loadFavorites, isFavorited, resetForTests } from './favoritesStore';

async function resetIdb(): Promise<void> {
  resetForTests();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase('CUI');
    request.onsuccess = (): void => {
      resolve();
    };
    request.onerror = (): void => {
      reject(request.error instanceof Error ? request.error : new Error('delete failed'));
    };
    request.onblocked = (): void => {
      resolve();
    };
  });
}

interface IInventoryDom {
  container: HTMLElement;
  content: HTMLElement;
}

function createInventoryDom(activeTab: string, hidden = false): IInventoryDom {
  const container = document.createElement('div');
  container.className = hidden ? 'inventory popup hidden' : 'inventory popup';
  const content = document.createElement('div');
  content.className = 'inventory__content';
  content.dataset.tab = activeTab;
  container.appendChild(content);
  document.body.appendChild(container);
  return { container, content };
}

function addKeyItem(content: HTMLElement, pointGuid: string): HTMLElement {
  // Симулируем структуру ключа из игры (script.js:2176-2189):
  // item > controls + item-left (title+descr) + ic-repair
  const item = document.createElement('div');
  item.className = 'inventory__item';
  item.dataset.guid = `item-${pointGuid}`;
  item.dataset.ref = pointGuid;

  const controls = document.createElement('div');
  controls.className = 'inventory__item-controls';
  item.appendChild(controls);

  const left = document.createElement('div');
  left.className = 'inventory__item-left';
  const title = document.createElement('span');
  title.className = 'inventory__item-title';
  title.textContent = 'Title';
  left.appendChild(title);
  const descr = document.createElement('span');
  descr.className = 'inventory__item-descr';
  left.appendChild(descr);
  item.appendChild(left);

  const repair = document.createElement('button');
  repair.className = 'inventory__ic-repair';
  item.appendChild(repair);

  content.appendChild(item);
  return item;
}

function addCoreItem(content: HTMLElement, itemGuid: string): HTMLElement {
  const item = document.createElement('div');
  item.className = 'inventory__item';
  item.dataset.guid = itemGuid;
  content.appendChild(item);
  return item;
}

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}

function findCheckbox(): HTMLInputElement {
  const checkbox = document.querySelector<HTMLInputElement>('.svp-fav-filter-checkbox');
  if (!checkbox) throw new Error('checkbox not found');
  return checkbox;
}

function findItemStar(item: HTMLElement): HTMLButtonElement {
  const star = item.querySelector<HTMLButtonElement>('.svp-inv-item-star');
  if (!star) throw new Error('item star not found');
  return star;
}

afterEach(() => {
  uninstallInventoryFilter();
  document.body.innerHTML = '';
});

describe('inventoryFilter', () => {
  beforeEach(async () => {
    await resetIdb();
    await loadFavorites();
  });

  test('инъектит панель фильтра над контейнером инвентаря', () => {
    createInventoryDom('3');
    installInventoryFilter();
    expect(document.querySelector('.svp-fav-filter-bar')).not.toBeNull();
  });

  test('панель фильтра скрыта, если активен не таб ключей', () => {
    createInventoryDom('1');
    installInventoryFilter();
    const bar = document.querySelector('.svp-fav-filter-bar');
    expect(bar?.classList.contains('svp-hidden')).toBe(true);
  });

  test('панель фильтра видна для таба ключей', () => {
    createInventoryDom('3');
    installInventoryFilter();
    const bar = document.querySelector('.svp-fav-filter-bar');
    expect(bar?.classList.contains('svp-hidden')).toBe(false);
  });

  test('проставляет svp-is-fav на ключах избранных точек', async () => {
    await addFavorite('point-1');
    const { content } = createInventoryDom('3');
    const item1 = addKeyItem(content, 'point-1');
    const item2 = addKeyItem(content, 'point-2');
    installInventoryFilter();
    expect(item1.classList.contains('svp-is-fav')).toBe(true);
    expect(item2.classList.contains('svp-is-fav')).toBe(false);
  });

  test('чекбокс включён → не-избранные ключи получают игровой hidden-класс', async () => {
    await addFavorite('point-1');
    const { content } = createInventoryDom('3');
    const item1 = addKeyItem(content, 'point-1');
    const item2 = addKeyItem(content, 'point-2');
    installInventoryFilter();
    const checkbox = findCheckbox();
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));
    expect(item1.classList.contains('hidden')).toBe(false);
    expect(item2.classList.contains('hidden')).toBe(true);
    expect(item2.classList.contains('svp-fav-filter-hidden')).toBe(true);
  });

  test('чекбокс выключен → игровой hidden снимается только с наших элементов', async () => {
    await addFavorite('point-1');
    const { content } = createInventoryDom('3');
    const item1 = addKeyItem(content, 'point-1');
    const item2 = addKeyItem(content, 'point-2');
    // Игра уже поставила hidden на item1 по своей причине — не нашей.
    item1.classList.add('hidden');
    installInventoryFilter();
    const checkbox = findCheckbox();
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));
    checkbox.checked = false;
    checkbox.dispatchEvent(new Event('change'));
    // Наш hidden снят, но чужой hidden на item1 остался.
    expect(item1.classList.contains('hidden')).toBe(true);
    expect(item2.classList.contains('hidden')).toBe(false);
  });

  test('состояние чекбокса НЕ сохраняется между установками', () => {
    createInventoryDom('3');
    installInventoryFilter();
    const checkbox = findCheckbox();
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));

    // Переустановка — новое состояние.
    uninstallInventoryFilter();
    createInventoryDom('3');
    installInventoryFilter();
    const freshCheckbox = findCheckbox();
    expect(freshCheckbox.checked).toBe(false);
  });

  test('состояние чекбокса сбрасывается при открытии инвентаря', async () => {
    const { container, content } = createInventoryDom('3', true);
    // Инвентарь открыт — сперва показываем его.
    container.classList.remove('hidden');
    installInventoryFilter();
    const checkbox = findCheckbox();
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));
    expect(checkbox.checked).toBe(true);

    // Игра закрыла инвентарь.
    container.classList.add('hidden');
    await flush();
    // Игра открыла инвентарь снова.
    container.classList.remove('hidden');
    await flush();

    expect(checkbox.checked).toBe(false);
    const items = content.querySelectorAll('.svp-fav-filter-hidden');
    expect(items).toHaveLength(0);
  });

  test('в каждом ключе появляется кнопка-звезда', async () => {
    await addFavorite('point-1');
    const { content } = createInventoryDom('3');
    const item1 = addKeyItem(content, 'point-1');
    const item2 = addKeyItem(content, 'point-2');
    installInventoryFilter();
    expect(findItemStar(item1).classList.contains('is-filled')).toBe(true);
    expect(findItemStar(item2).classList.contains('is-filled')).toBe(false);
  });

  test('клик по звезде в item добавляет точку в избранные', async () => {
    const { content } = createInventoryDom('3');
    const item = addKeyItem(content, 'point-1');
    installInventoryFilter();
    const star = findItemStar(item);
    star.click();
    await flush();
    expect(isFavorited('point-1')).toBe(true);
    expect(star.classList.contains('is-filled')).toBe(true);
  });

  test('клик по звезде в item повторно убирает из избранных', async () => {
    await addFavorite('point-1');
    const { content } = createInventoryDom('3');
    const item = addKeyItem(content, 'point-1');
    installInventoryFilter();
    const star = findItemStar(item);
    star.click();
    await flush();
    expect(isFavorited('point-1')).toBe(false);
    expect(star.classList.contains('is-filled')).toBe(false);
  });

  test('клик по звезде не всплывает до игрового обработчика item', () => {
    const { content } = createInventoryDom('3');
    const item = addKeyItem(content, 'point-1');
    const itemClickHandler = jest.fn();
    item.addEventListener('click', itemClickHandler);
    installInventoryFilter();
    const star = findItemStar(item);
    star.click();
    expect(itemClickHandler).not.toHaveBeenCalled();
  });

  test('при перерисовке инвентаря (childList) классы и звёзды ставятся заново', async () => {
    await addFavorite('point-1');
    const { content } = createInventoryDom('3');
    installInventoryFilter();
    content.innerHTML = '';
    const item1 = addKeyItem(content, 'point-1');
    const item2 = addKeyItem(content, 'point-2');
    await flush();
    expect(item1.classList.contains('svp-is-fav')).toBe(true);
    expect(item2.classList.contains('svp-is-fav')).toBe(false);
    expect(item1.querySelector('.svp-inv-item-star')).not.toBeNull();
    expect(item2.querySelector('.svp-inv-item-star')).not.toBeNull();
  });

  test('перерисовка во время активного фильтра — новые items сразу скрываются', async () => {
    await addFavorite('point-1');
    const { content } = createInventoryDom('3');
    installInventoryFilter();
    const checkbox = findCheckbox();
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));
    // Игра перерисовывает.
    content.innerHTML = '';
    const item1 = addKeyItem(content, 'point-1');
    const item2 = addKeyItem(content, 'point-2');
    await flush();
    expect(item1.classList.contains('hidden')).toBe(false);
    expect(item2.classList.contains('hidden')).toBe(true);
  });

  test('переключение таба на 3 показывает фильтр, переключение на 1 скрывает', async () => {
    const { content } = createInventoryDom('1');
    installInventoryFilter();
    const bar = document.querySelector('.svp-fav-filter-bar');
    expect(bar?.classList.contains('svp-hidden')).toBe(true);

    content.dataset.tab = '3';
    await flush();
    expect(bar?.classList.contains('svp-hidden')).toBe(false);

    content.dataset.tab = '1';
    await flush();
    expect(bar?.classList.contains('svp-hidden')).toBe(true);
  });

  test('не-ключевые items не получают звезду', () => {
    const { content } = createInventoryDom('3');
    const coreItem = addCoreItem(content, 'core-guid-xyz');
    installInventoryFilter();
    expect(coreItem.querySelector('.svp-inv-item-star')).toBeNull();
    expect(coreItem.classList.contains('svp-is-fav')).toBe(false);
  });

  test('изменение избранных через store обновляет метки и звёзды', async () => {
    const { content } = createInventoryDom('3');
    const item1 = addKeyItem(content, 'point-1');
    installInventoryFilter();
    const star = findItemStar(item1);
    expect(star.classList.contains('is-filled')).toBe(false);

    await addFavorite('point-1');
    await flush();
    expect(star.classList.contains('is-filled')).toBe(true);
    expect(item1.classList.contains('svp-is-fav')).toBe(true);
  });

  test('uninstall удаляет панель, звёзды, классы и снимает hidden только со своих', async () => {
    await addFavorite('point-1');
    const { content } = createInventoryDom('3');
    const item1 = addKeyItem(content, 'point-1');
    const item2 = addKeyItem(content, 'point-2');
    installInventoryFilter();
    const checkbox = findCheckbox();
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));
    expect(item2.classList.contains('hidden')).toBe(true);

    uninstallInventoryFilter();
    expect(document.querySelector('.svp-fav-filter-bar')).toBeNull();
    expect(item1.querySelector('.svp-inv-item-star')).toBeNull();
    expect(item1.classList.contains('svp-is-fav')).toBe(false);
    expect(item2.classList.contains('hidden')).toBe(false);
    expect(item2.classList.contains('svp-fav-filter-hidden')).toBe(false);
  });
});
