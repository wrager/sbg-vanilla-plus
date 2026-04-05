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

    // Проверяем напрямую через экспорт.
    const json = await exportToJson();
    const parsed = JSON.parse(json) as { favorites: { guid: string; cooldown: number | null }[] };
    expect(parsed.favorites).toHaveLength(1);
    expect(parsed.favorites[0].guid).toBe('guid-1');
    expect(parsed.favorites[0].cooldown).toBe(99999);
  });

  test('exportToJson возвращает валидный JSON со всеми записями', async () => {
    await loadFavorites();
    await addFavorite('guid-1');
    await addFavorite('guid-2');

    const json = await exportToJson();
    const parsed = JSON.parse(json) as { version: number; favorites: unknown[] };
    expect(parsed.version).toBe(1);
    expect(parsed.favorites).toHaveLength(2);
  });

  test('importFromJson добавляет записи в БД и обновляет кеш', async () => {
    await loadFavorites();
    await addFavorite('existing');

    const importJson = JSON.stringify({
      version: 1,
      favorites: [
        { guid: 'imported-1', cooldown: null },
        { guid: 'imported-2', cooldown: 54321 },
      ],
    });

    const count = await importFromJson(importJson);
    expect(count).toBe(2);
    expect(isFavorited('existing')).toBe(true);
    expect(isFavorited('imported-1')).toBe(true);
    expect(isFavorited('imported-2')).toBe(true);
    expect(getFavoritesCount()).toBe(3);
  });

  test('importFromJson валидирует формат', async () => {
    await loadFavorites();
    await expect(importFromJson('{}')).rejects.toThrow('Некорректный формат');
    await expect(importFromJson('{"version":2,"favorites":[]}')).rejects.toThrow();
    await expect(importFromJson('{"version":1,"favorites":[{"guid":123}]}')).rejects.toThrow();
  });

  test('importFromJson перезаписывает существующий cooldown', async () => {
    await loadFavorites();
    await addFavorite('guid-1');

    await importFromJson(
      JSON.stringify({
        version: 1,
        favorites: [{ guid: 'guid-1', cooldown: 77777 }],
      }),
    );

    const exportJson = await exportToJson();
    const parsed = JSON.parse(exportJson) as {
      favorites: { guid: string; cooldown: number | null }[];
    };
    const record = parsed.favorites.find((r) => r.guid === 'guid-1');
    expect(record?.cooldown).toBe(77777);
  });
});
