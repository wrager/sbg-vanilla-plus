// Хранилище избранных точек совместимо с CUI: та же база `CUI`, тот же objectStore
// `favorites` (keyPath='guid'). Запись — { guid, cooldown }. Поле cooldown нужно
// только CUI (таймер остывания точки); наш модуль его не использует, но обязан
// сохранять существующие значения при upsert, чтобы не затереть данные CUI.

const DB_NAME = 'CUI';
const STORE_NAME = 'favorites';
const CUI_DB_VERSION = 9;

export interface IFavoriteRecord {
  guid: string;
  cooldown: number | null;
}

let memoryGuids: Set<string> = new Set();
let cooldownByGuid: Map<string, number | null> = new Map();
let dbPromise: Promise<IDBDatabase> | null = null;

function promisifyRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = (): void => {
      resolve(request.result);
    };
    request.onerror = (): void => {
      reject(request.error ?? new Error('IDB request failed'));
    };
  });
}

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    // Сначала пробуем открыть БД без указания версии — получим текущую версию,
    // если она уже создана CUI или нами ранее.
    const probe = indexedDB.open(DB_NAME);
    probe.onsuccess = (): void => {
      const db = probe.result;
      if (db.objectStoreNames.contains(STORE_NAME)) {
        resolve(db);
        return;
      }
      // Store отсутствует — нужно повысить версию и создать.
      const targetVersion = Math.max(db.version + 1, CUI_DB_VERSION);
      db.close();
      const upgrade = indexedDB.open(DB_NAME, targetVersion);
      upgrade.onupgradeneeded = (): void => {
        const upgradedDb = upgrade.result;
        if (!upgradedDb.objectStoreNames.contains(STORE_NAME)) {
          upgradedDb.createObjectStore(STORE_NAME, { keyPath: 'guid' });
        }
      };
      upgrade.onsuccess = (): void => {
        resolve(upgrade.result);
      };
      upgrade.onerror = (): void => {
        reject(upgrade.error ?? new Error('IDB upgrade failed'));
      };
    };
    probe.onupgradeneeded = (): void => {
      // База только что создана — создаём store.
      const db = probe.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'guid' });
      }
    };
    probe.onerror = (): void => {
      reject(probe.error ?? new Error('IDB open failed'));
    };
  });
  return dbPromise;
}

function isFavoriteRecord(value: unknown): value is IFavoriteRecord {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  if (typeof record.guid !== 'string') return false;
  return record.cooldown === null || typeof record.cooldown === 'number';
}

/** Загружает все записи из IDB в memory cache. Вызывается один раз в `init()`. */
export async function loadFavorites(): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE_NAME, 'readonly');
  const store = tx.objectStore(STORE_NAME);
  const records: unknown[] = await promisifyRequest(store.getAll());

  memoryGuids = new Set();
  cooldownByGuid = new Map();
  for (const record of records) {
    if (!isFavoriteRecord(record)) continue;
    memoryGuids.add(record.guid);
    cooldownByGuid.set(record.guid, record.cooldown);
  }
}

/** Синхронная проверка — используется из hot path автоочистки. */
export function isFavorited(pointGuid: string): boolean {
  return memoryGuids.has(pointGuid);
}

export function getFavoritedGuids(): ReadonlySet<string> {
  return memoryGuids;
}

export function getFavoritesCount(): number {
  return memoryGuids.size;
}

/** Добавляет GUID в избранные. Сохраняет существующий cooldown (CUI может писать его). */
export async function addFavorite(pointGuid: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  const store = tx.objectStore(STORE_NAME);
  const existing: unknown = await promisifyRequest(store.get(pointGuid));
  const cooldown = isFavoriteRecord(existing) ? existing.cooldown : null;
  const record: IFavoriteRecord = { guid: pointGuid, cooldown };
  await promisifyRequest(store.put(record));
  memoryGuids.add(pointGuid);
  cooldownByGuid.set(pointGuid, cooldown);
}

export async function removeFavorite(pointGuid: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  const store = tx.objectStore(STORE_NAME);
  await promisifyRequest(store.delete(pointGuid));
  memoryGuids.delete(pointGuid);
  cooldownByGuid.delete(pointGuid);
}

export interface IExportPayload {
  version: 1;
  favorites: IFavoriteRecord[];
}

export async function exportToJson(): Promise<string> {
  const db = await openDb();
  const tx = db.transaction(STORE_NAME, 'readonly');
  const store = tx.objectStore(STORE_NAME);
  const records: unknown[] = await promisifyRequest(store.getAll());
  const valid = records.filter(isFavoriteRecord);
  const payload: IExportPayload = { version: 1, favorites: valid };
  return JSON.stringify(payload, null, 2);
}

function isExportPayload(value: unknown): value is IExportPayload {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  if (record.version !== 1) return false;
  if (!Array.isArray(record.favorites)) return false;
  return record.favorites.every(isFavoriteRecord);
}

/** Добавляет записи из JSON, не удаляет существующие (merge). */
export async function importFromJson(json: string): Promise<number> {
  const parsed: unknown = JSON.parse(json);
  if (!isExportPayload(parsed)) {
    throw new Error('Некорректный формат JSON избранных');
  }
  const db = await openDb();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  const store = tx.objectStore(STORE_NAME);
  for (const record of parsed.favorites) {
    await promisifyRequest(store.put(record));
    memoryGuids.add(record.guid);
    cooldownByGuid.set(record.guid, record.cooldown);
  }
  return parsed.favorites.length;
}

/** Только для тестов: сбрасывает кеш и закрывает БД. */
export function resetForTests(): void {
  memoryGuids = new Set();
  cooldownByGuid = new Map();
  if (dbPromise) {
    void dbPromise.then((db) => {
      db.close();
    });
  }
  dbPromise = null;
}
