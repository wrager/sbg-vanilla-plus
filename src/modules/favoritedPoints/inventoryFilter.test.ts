import { installInventoryFilter, uninstallInventoryFilter } from './inventoryFilter';
import { addFavorite, loadFavorites, isFavorited, resetForTests } from '../../core/favoritesStore';

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

let alertSpy: jest.SpyInstance;
const originalFetch = global.fetch;

function mockFetchPointData(data: Record<string, unknown> | null): void {
  global.fetch = jest.fn().mockResolvedValue({
    ok: data !== null,
    json: () => Promise.resolve(data !== null ? { data } : {}),
  });
}

beforeEach(() => {
  // Мокаем alert чтобы seal-детекция в loadFavorites не вызывала ошибку jsdom.
  alertSpy = jest.spyOn(window, 'alert').mockImplementation(() => {});
  // Мокаем fetch для placeholder'ов (по умолчанию — успешный ответ).
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: () =>
      Promise.resolve({ data: { t: 'Test Point', te: 1, l: 5, o: 'Owner', e: 80, co: 3 } }),
  });
});

afterEach(() => {
  uninstallInventoryFilter();
  document.body.innerHTML = '';
  alertSpy.mockRestore();
  global.fetch = originalFetch;
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
    expect(item2.classList.contains('svp-fav-filtered')).toBe(true);
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
    const items = content.querySelectorAll('.svp-fav-filtered');
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

  test('title звезды в инвентаре локализован', async () => {
    const { content } = createInventoryDom('3');
    const item = addKeyItem(content, 'point-1');
    installInventoryFilter();
    const star = findItemStar(item);
    expect(star.title).toContain('Add to favorites');

    star.click();
    await flush();
    expect(star.title).toContain('Remove from favorites');
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

  test('при активном фильтре снятие звезды НЕ скрывает элемент сразу', async () => {
    await addFavorite('point-1');
    await addFavorite('point-2');
    const { content } = createInventoryDom('3');
    const item1 = addKeyItem(content, 'point-1');
    addKeyItem(content, 'point-2');
    const item3 = addKeyItem(content, 'point-3');
    installInventoryFilter();
    const checkbox = findCheckbox();
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));
    expect(item3.classList.contains('hidden')).toBe(true);
    expect(item1.classList.contains('hidden')).toBe(false);

    // Снимаем point-1 из избранных через звезду item1.
    const star1 = findItemStar(item1);
    star1.click();
    await flush();

    // item1 НЕ должен исчезнуть — фильтр не пересчитывается по клику звезды.
    expect(item1.classList.contains('hidden')).toBe(false);
    expect(item1.classList.contains('svp-fav-filtered')).toBe(false);
    // Но метка svp-is-fav снялась, звезда больше не жёлтая.
    expect(item1.classList.contains('svp-is-fav')).toBe(false);
    expect(star1.classList.contains('is-filled')).toBe(false);
  });

  test('переключение чекбокса сбрасывает скролл в начало', () => {
    const { content } = createInventoryDom('3');
    addKeyItem(content, 'point-1');
    installInventoryFilter();
    content.scrollTop = 200;
    const checkbox = findCheckbox();
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));
    expect(content.scrollTop).toBe(0);
  });

  test('переключение чекбокса пересчитывает фильтр заново', async () => {
    await addFavorite('point-1');
    const { content } = createInventoryDom('3');
    const item1 = addKeyItem(content, 'point-1');
    installInventoryFilter();
    const checkbox = findCheckbox();
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));

    // Снимаем избранное через звезду (фильтр ещё активен).
    findItemStar(item1).click();
    await flush();
    expect(item1.classList.contains('hidden')).toBe(false);

    // Переключаем чекбокс off-on → item1 теперь не избранный, фильтр скрывает его.
    checkbox.checked = false;
    checkbox.dispatchEvent(new Event('change'));
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));
    expect(item1.classList.contains('hidden')).toBe(true);
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

  test('фильтр «Только избранные» без избранных: все ключи скрыты, снятие показывает все', () => {
    const { content } = createInventoryDom('3');
    const item1 = addKeyItem(content, 'point-1');
    const item2 = addKeyItem(content, 'point-2');
    installInventoryFilter();

    const checkbox = findCheckbox();
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));

    // Без избранных все ключи скрыты.
    expect(item1.classList.contains('hidden')).toBe(true);
    expect(item2.classList.contains('hidden')).toBe(true);

    // Снятие фильтра показывает все.
    checkbox.checked = false;
    checkbox.dispatchEvent(new Event('change'));
    expect(item1.classList.contains('hidden')).toBe(false);
    expect(item2.classList.contains('hidden')).toBe(false);
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
    expect(item2.classList.contains('svp-fav-filtered')).toBe(false);
  });
});

describe('placeholder для избранных без ключей', () => {
  beforeEach(async () => {
    await resetIdb();
    await loadFavorites();
  });

  test('при включении фильтра создаёт placeholder для избранного без ключей', async () => {
    await addFavorite('point-no-keys');
    const { content } = createInventoryDom('3');
    addKeyItem(content, 'point-with-keys');
    installInventoryFilter();
    const checkbox = findCheckbox();
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));

    const placeholder = content.querySelector('.svp-fav-placeholder');
    expect(placeholder).not.toBeNull();
    expect((placeholder as HTMLElement).dataset.ref).toBe('point-no-keys');
  });

  test('placeholder имеет класс loaded (защита от getRefsData)', async () => {
    await addFavorite('point-no-keys');
    const { content } = createInventoryDom('3');
    installInventoryFilter();
    findCheckbox().checked = true;
    findCheckbox().dispatchEvent(new Event('change'));

    const placeholder = content.querySelector('.svp-fav-placeholder');
    expect(placeholder?.classList.contains('loaded')).toBe(true);
  });

  test('placeholder получает звезду', async () => {
    await addFavorite('point-no-keys');
    const { content } = createInventoryDom('3');
    installInventoryFilter();
    findCheckbox().checked = true;
    findCheckbox().dispatchEvent(new Event('change'));

    const placeholder = content.querySelector<HTMLElement>('.svp-fav-placeholder');
    expect(placeholder).toBeTruthy();
    if (placeholder === null) return;
    expect(findItemStar(placeholder).classList.contains('is-filled')).toBe(true);
  });

  test('не создаёт placeholder для избранного, у которого есть ключи в DOM', async () => {
    await addFavorite('point-1');
    const { content } = createInventoryDom('3');
    addKeyItem(content, 'point-1');
    installInventoryFilter();
    findCheckbox().checked = true;
    findCheckbox().dispatchEvent(new Event('change'));

    expect(content.querySelectorAll('.svp-fav-placeholder')).toHaveLength(0);
  });

  test('при выключении фильтра placeholder удаляется', async () => {
    await addFavorite('point-no-keys');
    const { content } = createInventoryDom('3');
    installInventoryFilter();
    const checkbox = findCheckbox();
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));
    expect(content.querySelector('.svp-fav-placeholder')).not.toBeNull();

    checkbox.checked = false;
    checkbox.dispatchEvent(new Event('change'));
    expect(content.querySelector('.svp-fav-placeholder')).toBeNull();
  });

  test('fetch заполняет placeholder данными точки', async () => {
    mockFetchPointData({ t: 'Тестовая точка', te: 2, l: 7, o: 'Игрок', e: 50, co: 4 });
    await addFavorite('point-no-keys');
    const { content } = createInventoryDom('3');
    installInventoryFilter();
    findCheckbox().checked = true;
    findCheckbox().dispatchEvent(new Event('change'));
    await flush();

    const placeholder = content.querySelector<HTMLElement>('.svp-fav-placeholder');
    const title = placeholder?.querySelector('.inventory__item-title');
    expect(title?.textContent).toBe('Тестовая точка');
  });

  test('при ошибке fetch placeholder показывает текст ошибки', async () => {
    mockFetchPointData(null);
    await addFavorite('point-no-keys');
    const { content } = createInventoryDom('3');
    installInventoryFilter();
    findCheckbox().checked = true;
    findCheckbox().dispatchEvent(new Event('change'));
    await flush();

    const placeholder = content.querySelector<HTMLElement>('.svp-fav-placeholder');
    const title = placeholder?.querySelector('.inventory__item-title');
    expect(title?.textContent).toContain('Failed to load');
  });

  test('uninstall удаляет placeholder', async () => {
    await addFavorite('point-no-keys');
    const { content } = createInventoryDom('3');
    installInventoryFilter();
    findCheckbox().checked = true;
    findCheckbox().dispatchEvent(new Event('change'));
    expect(content.querySelector('.svp-fav-placeholder')).not.toBeNull();

    uninstallInventoryFilter();
    expect(content.querySelector('.svp-fav-placeholder')).toBeNull();
  });

  test('placeholder не дублируется при перерисовке с активным фильтром', async () => {
    await addFavorite('point-no-keys');
    const { content } = createInventoryDom('3');
    installInventoryFilter();
    findCheckbox().checked = true;
    findCheckbox().dispatchEvent(new Event('change'));
    expect(content.querySelectorAll('.svp-fav-placeholder')).toHaveLength(1);

    // Имитируем перерисовку: игра очищает content и добавляет items заново.
    // Наши placeholder'ы тоже удаляются, onContentMutation пересоздаёт их.
    const placeholderBefore = content.querySelector('.svp-fav-placeholder');
    // Удаляем только игровые items, оставляя placeholder для проверки дедупликации.
    for (const element of content.querySelectorAll('.inventory__item:not(.svp-fav-placeholder)')) {
      element.remove();
    }
    await flush();

    expect(content.querySelectorAll('.svp-fav-placeholder')).toHaveLength(1);
    // Тот же placeholder — не пересоздан.
    expect(content.querySelector('.svp-fav-placeholder')).toBe(placeholderBefore);
  });

  test('заголовок-разделитель появляется перед placeholder\u2019ами', async () => {
    await addFavorite('point-no-keys');
    const { content } = createInventoryDom('3');
    addKeyItem(content, 'point-with-keys');
    installInventoryFilter();
    findCheckbox().checked = true;
    findCheckbox().dispatchEvent(new Event('change'));

    const header = content.querySelector<HTMLElement>('.svp-fav-placeholder-header');
    expect(header).not.toBeNull();
    expect(header?.textContent).toContain('Favorited points without keys');
    // Заголовок стоит непосредственно перед первым placeholder'ом.
    const firstPlaceholder = content.querySelector('.svp-fav-placeholder');
    expect(header?.nextSibling).toBe(firstPlaceholder);
  });

  test('заголовок не создаётся, если все избранные имеют ключи', async () => {
    await addFavorite('point-1');
    const { content } = createInventoryDom('3');
    addKeyItem(content, 'point-1');
    installInventoryFilter();
    findCheckbox().checked = true;
    findCheckbox().dispatchEvent(new Event('change'));

    expect(content.querySelector('.svp-fav-placeholder-header')).toBeNull();
  });

  test('заголовок удаляется вместе с placeholder\u2019ами при выключении фильтра', async () => {
    await addFavorite('point-no-keys');
    const { content } = createInventoryDom('3');
    installInventoryFilter();
    const checkbox = findCheckbox();
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));
    expect(content.querySelector('.svp-fav-placeholder-header')).not.toBeNull();

    checkbox.checked = false;
    checkbox.dispatchEvent(new Event('change'));
    expect(content.querySelector('.svp-fav-placeholder-header')).toBeNull();
  });

  test('заголовок не дублируется при перерисовке с активным фильтром', async () => {
    await addFavorite('point-no-keys');
    const { content } = createInventoryDom('3');
    installInventoryFilter();
    findCheckbox().checked = true;
    findCheckbox().dispatchEvent(new Event('change'));
    expect(content.querySelectorAll('.svp-fav-placeholder-header')).toHaveLength(1);

    // Имитация перерисовки: удаляем только игровые items, оставляя placeholder.
    for (const element of content.querySelectorAll('.inventory__item:not(.svp-fav-placeholder)')) {
      element.remove();
    }
    await flush();

    expect(content.querySelectorAll('.svp-fav-placeholder-header')).toHaveLength(1);
  });

  test('uninstall удаляет заголовок-разделитель', async () => {
    await addFavorite('point-no-keys');
    const { content } = createInventoryDom('3');
    installInventoryFilter();
    findCheckbox().checked = true;
    findCheckbox().dispatchEvent(new Event('change'));
    expect(content.querySelector('.svp-fav-placeholder-header')).not.toBeNull();

    uninstallInventoryFilter();
    expect(content.querySelector('.svp-fav-placeholder-header')).toBeNull();
  });

  test('клик по звезде placeholder убирает из избранных', async () => {
    await addFavorite('point-no-keys');
    const { content } = createInventoryDom('3');
    installInventoryFilter();
    findCheckbox().checked = true;
    findCheckbox().dispatchEvent(new Event('change'));

    const placeholder = content.querySelector<HTMLElement>('.svp-fav-placeholder');
    expect(placeholder).toBeTruthy();
    if (placeholder === null) return;
    const star = findItemStar(placeholder);
    star.click();
    await flush();

    expect(isFavorited('point-no-keys')).toBe(false);
    expect(star.classList.contains('is-filled')).toBe(false);
  });
});
