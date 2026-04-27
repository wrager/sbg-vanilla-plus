import {
  loadFavorites,
  isFavorited,
  isFavoritesSnapshotReady,
  getFavoritedGuids,
  getFavoritesCount,
  resetForTests,
  SEAL_KEY,
} from './favoritesStore';

// Сбрасываем и кеш, и саму БД между тестами.
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

/**
 * Вставляет записи в IDB напрямую — write-API из favoritesStore удалён
 * (тогда как тестам нужно проверять чтение реальных данных). Использует
 * CUI-совместимый формат `{ guid, cooldown }`, как пишет CUI.
 */
async function seedRecords(records: { guid: string; cooldown: number | null }[]): Promise<void> {
  await loadFavorites();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('CUI');
    request.onsuccess = (): void => {
      const db = request.result;
      const tx = db.transaction('favorites', 'readwrite');
      const store = tx.objectStore('favorites');
      for (const record of records) {
        store.put(record);
      }
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
  resetForTests();
}

beforeEach(async () => {
  await resetIdb();
});

describe('favoritesStore', () => {
  test('loadFavorites на пустой БД не падает и даёт пустой кеш', async () => {
    await loadFavorites();
    expect(getFavoritesCount()).toBe(0);
    expect(getFavoritedGuids().size).toBe(0);
  });

  test('openDb создаёт все CUI stores для совместимости', async () => {
    await loadFavorites();

    const request = indexedDB.open('CUI');
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = (): void => {
        resolve(request.result);
      };
      request.onerror = (): void => {
        reject(request.error ?? new Error('open failed'));
      };
    });

    expect(db.objectStoreNames.contains('config')).toBe(true);
    expect(db.objectStoreNames.contains('logs')).toBe(true);
    expect(db.objectStoreNames.contains('state')).toBe(true);
    expect(db.objectStoreNames.contains('stats')).toBe(true);
    expect(db.objectStoreNames.contains('tiles')).toBe(true);
    expect(db.objectStoreNames.contains('favorites')).toBe(true);
    db.close();
  });

  test('loadFavorites читает существующие записи в memory cache', async () => {
    await seedRecords([
      { guid: 'guid-1', cooldown: null },
      { guid: 'guid-2', cooldown: 12345 },
    ]);
    await loadFavorites();

    expect(getFavoritesCount()).toBe(2);
    expect(isFavorited('guid-1')).toBe(true);
    expect(isFavorited('guid-2')).toBe(true);
    expect(isFavorited('guid-3')).toBe(false);
  });

  test('getFavoritedGuids возвращает defensive copy — мутация не влияет на store', async () => {
    await seedRecords([{ guid: 'guid-1', cooldown: null }]);
    await loadFavorites();

    const set = getFavoritedGuids() as Set<string>;
    set.add('guid-injected');

    expect(isFavorited('guid-injected')).toBe(false);
    expect(getFavoritesCount()).toBe(1);
  });

  test('данные сохраняются между сессиями (loadFavorites после resetForTests)', async () => {
    await seedRecords([{ guid: 'guid-survives', cooldown: null }]);

    // Эмулируем перезагрузку страницы: сбрасываем in-memory кеш, БД остаётся.
    resetForTests();
    await loadFavorites();

    expect(isFavorited('guid-survives')).toBe(true);
  });

  test('isFavoritesSnapshotReady: false до loadFavorites, true после, false после reset', async () => {
    expect(isFavoritesSnapshotReady()).toBe(false);
    await loadFavorites();
    expect(isFavoritesSnapshotReady()).toBe(true);
    resetForTests();
    expect(isFavoritesSnapshotReady()).toBe(false);
  });
});

describe('count seal (детекция IDB wipe)', () => {
  test('loadFavorites обновляет seal значением фактического размера', async () => {
    await seedRecords([
      { guid: 'g1', cooldown: null },
      { guid: 'g2', cooldown: null },
    ]);
    await loadFavorites();
    expect(localStorage.getItem(SEAL_KEY)).toBe('2');
  });

  test('пустая IDB и seal > 0 → snapshotReady=false (детект потери данных)', async () => {
    localStorage.setItem(SEAL_KEY, '5');
    const alertSpy = jest.spyOn(window, 'alert').mockImplementation();

    await loadFavorites();

    expect(isFavoritesSnapshotReady()).toBe(false);
    expect(alertSpy).toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  test('пустая IDB и seal=0 → snapshotReady=true (нормальный пустой кейс)', async () => {
    localStorage.setItem(SEAL_KEY, '0');
    await loadFavorites();
    expect(isFavoritesSnapshotReady()).toBe(true);
  });

  test('пустая IDB и отсутствующий seal → snapshotReady=true (первый запуск)', async () => {
    localStorage.removeItem(SEAL_KEY);
    await loadFavorites();
    expect(isFavoritesSnapshotReady()).toBe(true);
  });
});
