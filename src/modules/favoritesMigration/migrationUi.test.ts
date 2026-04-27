import { installMigrationUi, uninstallMigrationUi } from './migrationUi';
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
