import { installInventoryFilter, uninstallInventoryFilter } from './inventoryFilter';
import { addFavorite, loadFavorites, resetForTests } from './favoritesStore';

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

function createInventoryDom(activeTab: string): IInventoryDom {
  const container = document.createElement('div');
  container.className = 'inventory popup';
  const content = document.createElement('div');
  content.className = 'inventory__content';
  content.dataset.tab = activeTab;
  container.appendChild(content);
  document.body.appendChild(container);
  return { container, content };
}

function addKeyItem(content: HTMLElement, pointGuid: string): HTMLElement {
  const item = document.createElement('div');
  item.className = 'inventory__item';
  item.dataset.guid = `item-${pointGuid}`;
  item.dataset.ref = pointGuid;
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

afterEach(() => {
  uninstallInventoryFilter();
  localStorage.removeItem('svp_favFilterEnabled');
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

  test('чекбокс проставляет data-svp-fav-filter на content', async () => {
    await addFavorite('point-1');
    const { content } = createInventoryDom('3');
    addKeyItem(content, 'point-1');
    addKeyItem(content, 'point-2');
    installInventoryFilter();
    const checkbox = findCheckbox();
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));
    expect(content.getAttribute('data-svp-fav-filter')).toBe('1');
  });

  test('состояние чекбокса сохраняется в localStorage', () => {
    createInventoryDom('3');
    installInventoryFilter();
    const checkbox = findCheckbox();
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));
    expect(localStorage.getItem('svp_favFilterEnabled')).toBe('1');
    checkbox.checked = false;
    checkbox.dispatchEvent(new Event('change'));
    expect(localStorage.getItem('svp_favFilterEnabled')).toBeNull();
  });

  test('состояние чекбокса восстанавливается при повторном install', () => {
    localStorage.setItem('svp_favFilterEnabled', '1');
    const { content } = createInventoryDom('3');
    installInventoryFilter();
    const checkbox = document.querySelector<HTMLInputElement>('.svp-fav-filter-checkbox');
    expect(checkbox?.checked).toBe(true);
    expect(content.getAttribute('data-svp-fav-filter')).toBe('1');
  });

  test('при перерисовке инвентаря (childList) классы ставятся заново', async () => {
    await addFavorite('point-1');
    const { content } = createInventoryDom('3');
    installInventoryFilter();
    // Игра делает empty() + forEach(create) — симулируем.
    content.innerHTML = '';
    const item1 = addKeyItem(content, 'point-1');
    const item2 = addKeyItem(content, 'point-2');
    await flush();
    expect(item1.classList.contains('svp-is-fav')).toBe(true);
    expect(item2.classList.contains('svp-is-fav')).toBe(false);
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

  test('не-ключевые items не получают svp-is-fav', async () => {
    await addFavorite('point-1');
    const { content } = createInventoryDom('3');
    const coreItem = addCoreItem(content, 'core-guid-xyz');
    installInventoryFilter();
    expect(coreItem.classList.contains('svp-is-fav')).toBe(false);
  });

  test('изменение избранных через store обновляет метки', async () => {
    const { content } = createInventoryDom('3');
    const item1 = addKeyItem(content, 'point-1');
    installInventoryFilter();
    expect(item1.classList.contains('svp-is-fav')).toBe(false);

    await addFavorite('point-1');
    await flush();
    expect(item1.classList.contains('svp-is-fav')).toBe(true);
  });

  test('uninstall удаляет панель, атрибут и классы', async () => {
    await addFavorite('point-1');
    localStorage.setItem('svp_favFilterEnabled', '1');
    const { content } = createInventoryDom('3');
    const item1 = addKeyItem(content, 'point-1');
    installInventoryFilter();
    expect(item1.classList.contains('svp-is-fav')).toBe(true);

    uninstallInventoryFilter();
    expect(document.querySelector('.svp-fav-filter-bar')).toBeNull();
    expect(content.hasAttribute('data-svp-fav-filter')).toBe(false);
    expect(item1.classList.contains('svp-is-fav')).toBe(false);
  });
});
