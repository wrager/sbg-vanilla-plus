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
