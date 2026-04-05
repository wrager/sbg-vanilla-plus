import {
  loadFavorites,
  isFavorited,
  getFavoritedGuids,
  getFavoritesCount,
  addFavorite,
  removeFavorite,
  exportToJson,
  importFromJson,
  resetForTests,
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

beforeEach(async () => {
  await resetIdb();
});

describe('favoritesStore', () => {
  test('loadFavorites на пустой БД не падает и даёт пустой кеш', async () => {
    await loadFavorites();
    expect(getFavoritesCount()).toBe(0);
    expect(getFavoritedGuids().size).toBe(0);
  });

  test('addFavorite сохраняет GUID и обновляет кеш', async () => {
    await loadFavorites();
    await addFavorite('guid-1');
    expect(isFavorited('guid-1')).toBe(true);
    expect(getFavoritesCount()).toBe(1);
  });

  test('данные сохраняются между сессиями', async () => {
    await loadFavorites();
    await addFavorite('guid-1');
    await addFavorite('guid-2');

    resetForTests();
    expect(isFavorited('guid-1')).toBe(false);

    await loadFavorites();
    expect(isFavorited('guid-1')).toBe(true);
    expect(isFavorited('guid-2')).toBe(true);
    expect(getFavoritesCount()).toBe(2);
  });

  test('removeFavorite удаляет из БД и кеша', async () => {
    await loadFavorites();
    await addFavorite('guid-1');
    await addFavorite('guid-2');
    await removeFavorite('guid-1');
    expect(isFavorited('guid-1')).toBe(false);
    expect(isFavorited('guid-2')).toBe(true);

    resetForTests();
    await loadFavorites();
    expect(isFavorited('guid-1')).toBe(false);
    expect(isFavorited('guid-2')).toBe(true);
  });

  test('addFavorite сохраняет существующий cooldown (совместимость с CUI)', async () => {
    // Сначала симулируем запись CUI: открыть БД напрямую и записать {guid, cooldown: 12345}.
    await loadFavorites();
    // Чтобы вставить «чужую» запись с cooldown, используем низкоуровневый доступ.
    const request = indexedDB.open('CUI');
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = (): void => {
        resolve(request.result);
      };
      request.onerror = (): void => {
        reject(request.error instanceof Error ? request.error : new Error('open failed'));
      };
    });
    const tx = db.transaction('favorites', 'readwrite');
    tx.objectStore('favorites').put({ guid: 'guid-1', cooldown: 99999 });
    await new Promise<void>((resolve) => {
      tx.oncomplete = (): void => {
        resolve();
      };
    });
    db.close();

    // Наш addFavorite должен сохранить 99999 как cooldown.
    await addFavorite('guid-1');

    // Публичный export не возвращает cooldown, но запись в БД должна его содержать.
    // Проверяем через низкоуровневый доступ к IDB.
    const request2 = indexedDB.open('CUI');
    const db2 = await new Promise<IDBDatabase>((resolve, reject) => {
      request2.onsuccess = (): void => {
        resolve(request2.result);
      };
      request2.onerror = (): void => {
        reject(request2.error instanceof Error ? request2.error : new Error('open failed'));
      };
    });
    const tx2 = db2.transaction('favorites', 'readonly');
    const stored = await new Promise<unknown>((resolve, reject) => {
      const req = tx2.objectStore('favorites').get('guid-1');
      req.onsuccess = (): void => {
        resolve(req.result);
      };
      req.onerror = (): void => {
        reject(req.error instanceof Error ? req.error : new Error('get failed'));
      };
    });
    db2.close();
    expect(stored).toEqual({ guid: 'guid-1', cooldown: 99999 });
  });

  test('exportToJson возвращает массив GUID-строк', async () => {
    await loadFavorites();
    await addFavorite('guid-b');
    await addFavorite('guid-a');

    const json = await exportToJson();
    const parsed = JSON.parse(json) as unknown;
    expect(Array.isArray(parsed)).toBe(true);
    // Отсортировано для стабильности.
    expect(parsed).toEqual(['guid-a', 'guid-b']);
  });

  test('importFromJson ЗАМЕНЯЕТ все существующие записи (replace mode)', async () => {
    await loadFavorites();
    await addFavorite('old-1');
    await addFavorite('old-2');

    const count = await importFromJson(JSON.stringify(['new-1', 'new-2', 'new-3']));
    expect(count).toBe(3);
    expect(isFavorited('old-1')).toBe(false);
    expect(isFavorited('old-2')).toBe(false);
    expect(isFavorited('new-1')).toBe(true);
    expect(getFavoritesCount()).toBe(3);
  });

  test('importFromJson валидирует формат — массив строк', async () => {
    await loadFavorites();
    await expect(importFromJson('{}')).rejects.toThrow('Некорректный формат');
    await expect(importFromJson('[1, 2, 3]')).rejects.toThrow();
    await expect(importFromJson('[{"guid":"x"}]')).rejects.toThrow();
  });

  test('importFromJson очищает БД если передан пустой массив', async () => {
    await loadFavorites();
    await addFavorite('guid-1');
    await addFavorite('guid-2');

    const count = await importFromJson('[]');
    expect(count).toBe(0);
    expect(getFavoritesCount()).toBe(0);

    // Проверяем через повторную загрузку.
    resetForTests();
    await loadFavorites();
    expect(getFavoritesCount()).toBe(0);
  });

  test('importFromJson новые записи имеют cooldown=null', async () => {
    await loadFavorites();
    await importFromJson(JSON.stringify(['new-1']));

    const request = indexedDB.open('CUI');
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = (): void => {
        resolve(request.result);
      };
      request.onerror = (): void => {
        reject(request.error instanceof Error ? request.error : new Error('open failed'));
      };
    });
    const tx = db.transaction('favorites', 'readonly');
    const stored = await new Promise<unknown>((resolve, reject) => {
      const req = tx.objectStore('favorites').get('new-1');
      req.onsuccess = (): void => {
        resolve(req.result);
      };
      req.onerror = (): void => {
        reject(req.error instanceof Error ? req.error : new Error('get failed'));
      };
    });
    db.close();
    expect(stored).toEqual({ guid: 'new-1', cooldown: null });
  });
});
