import { installMigrationUi, uninstallMigrationUi } from './migrationUi';
import { favoritesMigration } from './favoritesMigration';
import {
  loadFavorites,
  resetForTests as resetFavoritesStoreForTests,
  setLockMigrationDone,
  isLockMigrationDone,
} from '../../core/favoritesStore';

async function resetIdb(): Promise<void> {
  resetFavoritesStoreForTests();
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

async function seedFavorites(records: { guid: string; cooldown: number | null }[]): Promise<void> {
  await loadFavorites();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('CUI');
    request.onsuccess = (): void => {
      const db = request.result;
      const tx = db.transaction('favorites', 'readwrite');
      const store = tx.objectStore('favorites');
      for (const record of records) store.put(record);
      tx.oncomplete = (): void => {
        db.close();
        resolve();
      };
      tx.onabort = (): void => {
        db.close();
        reject(tx.error ?? new Error('seed transaction aborted'));
      };
    };
    request.onerror = (): void => {
      reject(request.error ?? new Error('seed open failed'));
    };
  });
}

function buildSettingsRow(): void {
  // installMigrationUi ищет .svp-module-row с .svp-module-id == 'favoritesMigration'
  // и инжектирует кнопку "Настроить" в .svp-module-name-line. Минимальная
  // структура для теста.
  const row = document.createElement('div');
  row.className = 'svp-module-row';
  const idElement = document.createElement('div');
  idElement.className = 'svp-module-id';
  idElement.textContent = 'favoritesMigration';
  row.appendChild(idElement);
  const nameLine = document.createElement('div');
  nameLine.className = 'svp-module-name-line';
  row.appendChild(nameLine);
  document.body.appendChild(row);
}

function openMigrationPanel(): HTMLElement {
  const configure = document.querySelector<HTMLButtonElement>('.svp-migration-configure-button');
  if (!configure) throw new Error('configure button not found');
  configure.click();
  const panel = document.querySelector<HTMLElement>('.svp-migration-panel');
  if (!panel) throw new Error('panel not opened');
  return panel;
}

beforeEach(async () => {
  document.body.innerHTML = '';
  await resetIdb();
  buildSettingsRow();
  installMigrationUi();
});

afterEach(() => {
  uninstallMigrationUi();
  document.body.innerHTML = '';
});

describe('favoritesMigration: метаданные модуля', () => {
  test('id равен "favoritesMigration"', () => {
    expect(favoritesMigration.id).toBe('favoritesMigration');
  });

  test('category - feature (не utility)', () => {
    // Миграция избранного - пользовательская фича, не служебная утилита.
    // CATEGORY_ORDER в settings UI ставит feature перед utility, поэтому
    // изменение наблюдаемо в порядке отображения модулей в настройках.
    expect(favoritesMigration.category).toBe('feature');
  });

  test('defaultEnabled = true', () => {
    expect(favoritesMigration.defaultEnabled).toBe(true);
  });

  test('имеет локализованные name и description', () => {
    expect(favoritesMigration.name.ru).toBeTruthy();
    expect(favoritesMigration.name.en).toBeTruthy();
    expect(favoritesMigration.description.ru).toBeTruthy();
    expect(favoritesMigration.description.en).toBeTruthy();
  });
});

describe('migrationUi: footer и кнопка закрытия (общие классы)', () => {
  test('header содержит только title, без кнопки закрытия', () => {
    const panel = openMigrationPanel();
    const header = panel.querySelector<HTMLElement>('.svp-migration-header');
    expect(header).not.toBeNull();
    expect(header?.querySelector('.svp-settings-close')).toBeNull();
  });

  test('используются общие классы settings-panel: footer и close', () => {
    const panel = openMigrationPanel();
    const footer = panel.querySelector<HTMLElement>('.svp-settings-footer');
    expect(footer).not.toBeNull();
    const close = panel.querySelector<HTMLButtonElement>('.svp-settings-close');
    expect(close).not.toBeNull();
    expect(close?.textContent).toBe('[x]');
    expect(close?.getAttribute('aria-label')).toMatch(/закрыть|close/i);
    // Собственных alias-классов больше нет - всё переиспользует основной экран.
    expect(panel.querySelector('.svp-migration-footer')).toBeNull();
    expect(panel.querySelector('.svp-migration-close')).toBeNull();
  });

  test('footer и close - direct children panel, идут после content', () => {
    const panel = openMigrationPanel();
    const content = panel.querySelector<HTMLElement>('.svp-migration-content');
    const footer = content?.nextElementSibling;
    expect(footer?.classList.contains('svp-settings-footer')).toBe(true);
    // close - последний child панели, position: fixed (sibling footer'а, не внутри).
    const lastChild = panel.lastElementChild;
    expect(lastChild?.classList.contains('svp-settings-close')).toBe(true);
  });

  test('клик по крестику закрывает панель', () => {
    const panel = openMigrationPanel();
    const close = panel.querySelector<HTMLButtonElement>('.svp-settings-close');
    expect(close).not.toBeNull();
    close?.click();
    expect(document.querySelector('.svp-migration-panel')).toBeNull();
  });
});

describe('migrationUi: секции legacy / native', () => {
  test('content разделён на секции legacy (импорт/экспорт + счётчик) и native (миграция)', () => {
    const panel = openMigrationPanel();
    const content = panel.querySelector<HTMLElement>('.svp-migration-content');
    if (!content) throw new Error('content missing');

    const sections = content.querySelectorAll<HTMLElement>('.svp-migration-section');
    expect(sections.length).toBe(2);

    const legacy = content.querySelector<HTMLElement>('.svp-migration-section-legacy');
    const native = content.querySelector<HTMLElement>('.svp-migration-section-native');
    if (!legacy || !native) throw new Error('sections missing');

    // legacy идёт первой в DOM-порядке.
    expect(content.firstElementChild).toBe(legacy);

    // Заголовки на русском (locale по умолчанию в jsdom-окружении проекта).
    const legacyHeader = legacy.querySelector<HTMLElement>('.svp-migration-section-header');
    const nativeHeader = native.querySelector<HTMLElement>('.svp-migration-section-header');
    expect(legacyHeader?.textContent).toContain('CUI');
    expect(legacyHeader?.textContent).toMatch(/устаревшее|legacy/i);
    expect(nativeHeader?.textContent).toMatch(/новое|new/i);

    // legacy содержит IO + counter; native содержит actions + progress.
    expect(legacy.querySelector('.svp-migration-io')).not.toBeNull();
    expect(legacy.querySelector('.svp-migration-counter')).not.toBeNull();
    expect(native.querySelector('.svp-migration-actions')).not.toBeNull();
    expect(native.querySelector('.svp-migration-progress')).not.toBeNull();
  });

  test('label импорт + кнопка экспорт рендерятся в legacy-секции', () => {
    const panel = openMigrationPanel();
    const legacy = panel.querySelector<HTMLElement>('.svp-migration-section-legacy');
    if (!legacy) throw new Error('legacy section missing');

    const importLabel = legacy.querySelector<HTMLLabelElement>(
      'label.svp-migration-io-button[data-io="import"]',
    );
    const exportButton = legacy.querySelector<HTMLButtonElement>(
      'button.svp-migration-io-button[data-io="export"]',
    );
    expect(importLabel).not.toBeNull();
    expect(exportButton).not.toBeNull();
    // Скрытый file input должен быть внутри label.
    expect(importLabel?.querySelector('input[type="file"]')).not.toBeNull();
  });

  test('legacy-секция содержит два абзаца пояснений (intro + warning)', () => {
    const panel = openMigrationPanel();
    const legacy = panel.querySelector<HTMLElement>('.svp-migration-section-legacy');
    if (!legacy) throw new Error('legacy section missing');

    const texts = legacy.querySelectorAll<HTMLElement>('.svp-migration-section-text');
    expect(texts.length).toBe(2);
    expect(texts[0].textContent).toMatch(/из этого браузера|from or to this browser/i);
    expect(texts[1].textContent).toMatch(/больше не используется|no longer used/i);
    // Фраза "с помощью кнопок ниже" удалена: кнопки миграции теперь в отдельной
    // секции "новое", а не сразу под warning - указание "ниже" географически
    // неверное.
    expect(texts[1].textContent).not.toMatch(/кнопок ниже|buttons below/i);
    expect(texts[1].classList.contains('svp-migration-section-text-warning')).toBe(true);
  });

  test('IO-кнопки импорта и экспорта - сиблинги в .svp-migration-io (горизонтальный лейаут)', () => {
    const panel = openMigrationPanel();
    const io = panel.querySelector<HTMLElement>('.svp-migration-io');
    if (!io) throw new Error('io missing');

    const ioChildren = Array.from(io.children);
    expect(ioChildren).toHaveLength(2);
    expect(ioChildren[0].matches('label.svp-migration-io-button[data-io="import"]')).toBe(true);
    expect(ioChildren[1].matches('button.svp-migration-io-button[data-io="export"]')).toBe(true);
    // Подсказка о перезаписи удалена.
    expect(panel.querySelector('.svp-migration-io-warning')).toBeNull();
  });

  test('native-секция: intro+use перед actions, duration после actions', () => {
    const panel = openMigrationPanel();
    const native = panel.querySelector<HTMLElement>('.svp-migration-section-native');
    if (!native) throw new Error('native section missing');

    const children = Array.from(native.children);
    const actionsIndex = children.findIndex((el) => el.classList.contains('svp-migration-actions'));
    expect(actionsIndex).toBeGreaterThan(0);

    const beforeActions = children
      .slice(0, actionsIndex)
      .filter((el) => el.classList.contains('svp-migration-section-text'));
    const afterActions = children
      .slice(actionsIndex + 1)
      .filter((el) => el.classList.contains('svp-migration-section-text'));

    // intro + use идут до actions; duration - после.
    expect(beforeActions).toHaveLength(2);
    expect(beforeActions[0].textContent).toMatch(/избранн|favorite/i);
    expect(beforeActions[1].textContent).toMatch(/перетащить|transfer/i);
    expect(afterActions).toHaveLength(1);
    expect(afterActions[0].textContent).toMatch(/некоторое время|may take some time/i);
  });

  test('кнопки миграции: иконка после текста (не перед)', () => {
    const panel = openMigrationPanel();
    const favButton = panel.querySelector<HTMLButtonElement>(
      '.svp-migration-action[data-flag="favorite"]',
    );
    if (!favButton) throw new Error('fav button missing');

    // Структура: <span>label</span><svg>...</svg> - текст первым ребёнком.
    expect(favButton.firstElementChild?.tagName.toLowerCase()).toBe('span');
    expect(favButton.lastElementChild?.tagName.toLowerCase()).toBe('svg');
  });

  test('кнопки миграции переименованы: "перенести старый список в избранное / в заблокированное"', () => {
    const panel = openMigrationPanel();
    const favButton = panel.querySelector<HTMLButtonElement>(
      '.svp-migration-action[data-flag="favorite"]',
    );
    const lockButton = panel.querySelector<HTMLButtonElement>(
      '.svp-migration-action[data-flag="locked"]',
    );
    expect(favButton?.textContent).toMatch(/перенести.*избранное|migrate.*favorites/i);
    expect(lockButton?.textContent).toMatch(/перенести.*заблокированное|migrate.*locked/i);
  });

  test('explanation удалён', () => {
    const panel = openMigrationPanel();
    expect(panel.querySelector('.svp-migration-explanation')).toBeNull();
  });

  test('импорт через File: записывает GUIDы в IDB, обновляет счётчик, показывает alert', async () => {
    await seedFavorites([{ guid: 'old-1', cooldown: null }]);
    await loadFavorites();
    setLockMigrationDone();
    expect(isLockMigrationDone()).toBe(true);

    const panel = openMigrationPanel();
    const counter = panel.querySelector<HTMLElement>('.svp-migration-counter');
    if (!counter) throw new Error('counter missing');
    expect(counter.textContent).toContain('1');

    const fileInput = panel.querySelector<HTMLInputElement>('input[type="file"]');
    if (!fileInput) throw new Error('file input missing');

    const alertSpy = jest.spyOn(window, 'alert').mockImplementation();

    const importedJson = JSON.stringify(['imported-a', 'imported-b', 'imported-c']);
    // jsdom не имеет реализации File.prototype.text в текущей версии: подставляем
    // мок только с тем API, которое использует doImport.
    const file = { text: () => Promise.resolve(importedJson) } as unknown as File;

    Object.defineProperty(fileInput, 'files', {
      configurable: true,
      get: () => [file] as unknown as FileList,
    });
    fileInput.dispatchEvent(new Event('change'));

    for (let i = 0; i < 30; i++) {
      if (counter.textContent.includes('3')) break;
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
      });
    }

    expect(counter.textContent).toContain('3');
    expect(isLockMigrationDone()).toBe(false);
    expect(alertSpy).toHaveBeenCalledWith(expect.stringContaining('3'));
    alertSpy.mockRestore();
  });
});

// Сценарии runFlow с пустым toSend - проверяют, что lock-migration-done
// выставляется по любому из условий "защита фактически полная": либо все стопки
// уже locked (alreadyApplied > 0), либо у легаси-точек нет ключей в инвентаре
// (withoutKeys > 0). Без покрытия второго случая пользователь, у которого все
// легаси-точки без ключей в инвентаре, нажал бы "Перенести в заблокированное",
// получил toast и остался бы с заблокированной автоочисткой до перезагрузки.
describe('migrationUi: runFlow lock-migration-done при пустом toSend', () => {
  function setInventoryCache(items: unknown[]): void {
    localStorage.setItem('inventory-cache', JSON.stringify(items));
  }

  function clickLockedMigration(panel: HTMLElement): void {
    const lockButton = panel.querySelector<HTMLButtonElement>(
      '.svp-migration-action[data-flag="locked"]',
    );
    if (!lockButton) throw new Error('locked button missing');
    lockButton.click();
  }

  test('withoutKeys > 0 (легаси без стопок), alreadyApplied = 0: флаг ставится', async () => {
    await seedFavorites([{ guid: 'legacy-no-stacks', cooldown: null }]);
    await loadFavorites();
    setInventoryCache([]);
    expect(isLockMigrationDone()).toBe(false);

    const showToastSpy = jest.spyOn(window, 'alert').mockImplementation();
    const panel = openMigrationPanel();
    clickLockedMigration(panel);

    expect(isLockMigrationDone()).toBe(true);
    showToastSpy.mockRestore();
  });

  test('alreadyApplied > 0, withoutKeys = 0: флаг ставится (старая ветка)', async () => {
    await seedFavorites([{ guid: 'p1', cooldown: null }]);
    await loadFavorites();
    setInventoryCache([{ g: 's1', t: 3, l: 'p1', a: 5, f: 0b10 }]);
    expect(isLockMigrationDone()).toBe(false);

    const panel = openMigrationPanel();
    clickLockedMigration(panel);

    expect(isLockMigrationDone()).toBe(true);
  });

  test('flag = favorite + alreadyApplied > 0: флаг НЕ ставится (favorite не защищает)', async () => {
    await seedFavorites([{ guid: 'p1', cooldown: null }]);
    await loadFavorites();
    setInventoryCache([{ g: 's1', t: 3, l: 'p1', a: 5, f: 0b01 }]);
    expect(isLockMigrationDone()).toBe(false);

    const panel = openMigrationPanel();
    const favButton = panel.querySelector<HTMLButtonElement>(
      '.svp-migration-action[data-flag="favorite"]',
    );
    if (!favButton) throw new Error('favorite button missing');
    favButton.click();

    expect(isLockMigrationDone()).toBe(false);
  });
});

// e2e сценарий полного успеха миграции: легаси-точка с непомеченной стопкой,
// успешный POST /api/marks с {result:true}, runFlow ждёт runMigration, по
// завершении выставляет lock-migration-done. Полный путь "клик кнопки -> сеть
// -> флаг -> разблокировка inventoryCleanup" не покрывался ни одним тестом до
// этого: migrationApi unit-тестировался через runMigration напрямую без UI,
// migrationUi проверял только UI без реального fetch.
describe('migrationUi: e2e успешная миграция в locked выставляет lock-migration-done', () => {
  function setInventoryCache(items: unknown[]): void {
    localStorage.setItem('inventory-cache', JSON.stringify(items));
  }

  let mockFetch: jest.Mock;
  let originalFetch: typeof window.fetch;

  beforeEach(() => {
    localStorage.setItem('auth', 'test-token');
    mockFetch = jest.fn();
    originalFetch = window.fetch;
    Object.defineProperty(window, 'fetch', { value: mockFetch, writable: true });
  });

  afterEach(() => {
    window.fetch = originalFetch;
  });

  test('одна стопка, fetch -> {result:true} -> runFlow завершается success -> lock-migration-done выставлен', async () => {
    await seedFavorites([{ guid: 'p1', cooldown: null }]);
    await loadFavorites();
    // Стопка без бита locked - попадёт в toSend.
    setInventoryCache([{ g: 's1', t: 3, l: 'p1', a: 5, f: 0 }]);
    expect(isLockMigrationDone()).toBe(false);

    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result: true }),
    });

    const panel = openMigrationPanel();
    const lockButton = panel.querySelector<HTMLButtonElement>(
      '.svp-migration-action[data-flag="locked"]',
    );
    if (!lockButton) throw new Error('locked button missing');
    lockButton.click();

    // runFlow -> runMigration -> postMark -> applyFlagToCache -> markProgressTerminal.
    // Ждём пока кнопка не окажется снова enabled (finally в runFlow).
    for (let i = 0; i < 50; i++) {
      if (!lockButton.disabled) break;
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
      });
    }
    expect(lockButton.disabled).toBe(false);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(isLockMigrationDone()).toBe(true);

    // Бит 0b10 должен быть проставлен в кэше через applyFlagToCache.
    const cacheRaw = localStorage.getItem('inventory-cache');
    if (!cacheRaw) throw new Error('inventory-cache missing after migration');
    const cache = JSON.parse(cacheRaw) as { g: string; f?: number }[];
    const stack = cache.find((item) => item.g === 's1');
    expect(stack?.f).toBe(0b10);
  });

  test('одна стопка, fetch -> {result:true}, flag=favorite -> lock-migration-done НЕ выставляется', async () => {
    await seedFavorites([{ guid: 'p1', cooldown: null }]);
    await loadFavorites();
    setInventoryCache([{ g: 's1', t: 3, l: 'p1', a: 5, f: 0 }]);
    expect(isLockMigrationDone()).toBe(false);

    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result: true }),
    });

    const panel = openMigrationPanel();
    const favButton = panel.querySelector<HTMLButtonElement>(
      '.svp-migration-action[data-flag="favorite"]',
    );
    if (!favButton) throw new Error('favorite button missing');
    favButton.click();

    for (let i = 0; i < 50; i++) {
      if (!favButton.disabled) break;
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
      });
    }
    expect(favButton.disabled).toBe(false);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    // favorite не защищает от удаления, флаг не выставляется.
    expect(isLockMigrationDone()).toBe(false);
  });
});
