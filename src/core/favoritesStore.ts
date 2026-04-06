// Хранилище избранных точек совместимо с CUI: та же база `CUI`, тот же objectStore
// `favorites` (keyPath='guid'). Запись — { guid, cooldown }. Поле cooldown нужно
// только CUI (таймер остывания точки); наш модуль его не использует, но обязан
// сохранять существующие значения при upsert, чтобы не затереть данные CUI.

export const FAVORITES_CHANGED_EVENT = 'svp:favorites-changed';

function emitChange(): void {
  document.dispatchEvent(new CustomEvent(FAVORITES_CHANGED_EVENT));
}

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
// true после успешного loadFavorites() — означает, что memoryGuids содержит
// достоверный снимок IDB (даже если Set пуст — пользователь просто не добавлял
// избранных). false — IDB не читалась или чтение упало. Используется в
// cleanupCalculator как guard вместо size > 0 (коммит 8a1c2b4).
let snapshotLoaded = false;

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
  snapshotLoaded = true;
}

/** Синхронная проверка — используется из hot path автоочистки. */
export function isFavorited(pointGuid: string): boolean {
  return memoryGuids.has(pointGuid);
}

export function getFavoritedGuids(): ReadonlySet<string> {
  return memoryGuids;
}

/**
 * true — loadFavorites() завершился успешно (снимок IDB достоверен, даже если пуст).
 * false — IDB ещё не читалась или чтение упало. Автоочистка НЕ должна удалять ключи.
 */
export function isFavoritesSnapshotReady(): boolean {
  return snapshotLoaded;
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
  emitChange();
}

export async function removeFavorite(pointGuid: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  const store = tx.objectStore(STORE_NAME);
  await promisifyRequest(store.delete(pointGuid));
  memoryGuids.delete(pointGuid);
  cooldownByGuid.delete(pointGuid);
  emitChange();
}

/** Экспорт: простой массив GUID'ов точек (формат для миграции между браузерами). */
export async function exportToJson(): Promise<string> {
  const db = await openDb();
  const tx = db.transaction(STORE_NAME, 'readonly');
  const store = tx.objectStore(STORE_NAME);
  const records: unknown[] = await promisifyRequest(store.getAll());
  const guids = records
    .filter(isFavoriteRecord)
    .map((record) => record.guid)
    .sort();
  return JSON.stringify(guids, null, 2);
}

function isGuidArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/**
 * Импорт в режиме REPLACE: удаляет ВСЕ существующие избранные, затем добавляет
 * записи из массива. Cooldown существующих записей теряется (формат хранит
 * только GUID). Новые записи создаются с cooldown=null.
 */
export async function importFromJson(json: string): Promise<number> {
  const parsed: unknown = JSON.parse(json);
  if (!isGuidArray(parsed)) {
    throw new Error('Некорректный формат JSON: ожидается массив GUID-строк');
  }
  const db = await openDb();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  const store = tx.objectStore(STORE_NAME);
  await promisifyRequest(store.clear());
  for (const guid of parsed) {
    const record: IFavoriteRecord = { guid, cooldown: null };
    await promisifyRequest(store.put(record));
  }
  memoryGuids = new Set(parsed);
  cooldownByGuid = new Map(parsed.map((guid) => [guid, null]));
  emitChange();
  return parsed.length;
}

/** Только для тестов: сбрасывает кеш и закрывает БД. */
export function resetForTests(): void {
  memoryGuids = new Set();
  cooldownByGuid = new Map();
  snapshotLoaded = false;
  if (dbPromise) {
    void dbPromise.then((db) => {
      db.close();
    });
  }
  dbPromise = null;
}
