// Хранилище избранных точек совместимо с CUI: та же база `CUI`, тот же objectStore
// `favorites` (keyPath='guid'). Запись — { guid, cooldown }. Поле cooldown нужно
// только CUI (таймер остывания точки); наш модуль его не использует, но обязан
// сохранять существующие значения при upsert, чтобы не затереть данные CUI.

import { t } from './l10n';

export const FAVORITES_CHANGED_EVENT = 'svp:favorites-changed';

function emitChange(): void {
  document.dispatchEvent(new CustomEvent(FAVORITES_CHANGED_EVENT));
}

const DB_NAME = 'CUI';
const STORE_NAME = 'favorites';
const CUI_DB_VERSION = 9;

// Count seal: количество избранных записывается в localStorage при каждом
// изменении. При loadFavorites() если IDB пуста, а seal > 0 — значит данные
// потеряны (Android IDB wipe). В этом случае snapshotLoaded = false, удаление
// ключей заблокировано, пользователь получает alert.
export const SEAL_KEY = 'svp_favorites_seal';

function updateSeal(): void {
  try {
    localStorage.setItem(SEAL_KEY, String(memoryGuids.size));
  } catch {
    // localStorage может быть недоступен (private mode, quota). Не критично.
  }
}

function readSeal(): number {
  try {
    const value = localStorage.getItem(SEAL_KEY);
    if (value === null) return 0;
    const parsed = parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  } catch {
    return 0;
  }
}

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

/**
 * Ждёт фактического коммита транзакции IDB. request.onsuccess не гарантирует,
 * что транзакция закоммичена — она может быть отменена (abort) после успеха
 * отдельного запроса (квота, системное давление, crash). Обновлять in-memory
 * состояние безопасно только после oncomplete.
 */
function waitForTransaction(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = (): void => {
      resolve();
    };
    tx.onabort = (): void => {
      reject(tx.error ?? new Error('IDB transaction aborted'));
    };
    tx.onerror = (): void => {
      reject(tx.error ?? new Error('IDB transaction error'));
    };
  });
}

// Stores, которые CUI создаёт в initializeDB (версия 9). Если мы создаём БД
// первыми, нужно создать ВСЕ stores — иначе CUI при upgrade увидит oldVersion > 0,
// вызовет updateDB() вместо initializeDB(), и попытается обратиться к
// несуществующим stores (config, state, tiles), что приведёт к crash.
const CUI_STORES: { name: string; options?: IDBObjectStoreParameters }[] = [
  { name: 'config' },
  { name: 'logs', options: { keyPath: 'timestamp' } },
  { name: 'state' },
  { name: 'stats', options: { keyPath: 'name' } },
  { name: 'tiles' },
  { name: STORE_NAME, options: { keyPath: 'guid' } },
];

function createAllStores(database: IDBDatabase): void {
  for (const store of CUI_STORES) {
    if (!database.objectStoreNames.contains(store.name)) {
      database.createObjectStore(store.name, store.options);
    }
  }
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
      // Store отсутствует — нужно повысить версию и создать ВСЕ CUI stores.
      const targetVersion = Math.max(db.version + 1, CUI_DB_VERSION);
      db.close();
      const upgrade = indexedDB.open(DB_NAME, targetVersion);
      upgrade.onupgradeneeded = (): void => {
        createAllStores(upgrade.result);
      };
      upgrade.onsuccess = (): void => {
        resolve(upgrade.result);
      };
      upgrade.onerror = (): void => {
        dbPromise = null;
        reject(upgrade.error ?? new Error('IDB upgrade failed'));
      };
    };
    probe.onupgradeneeded = (): void => {
      // База только что создана — создаём ВСЕ CUI stores для совместимости.
      createAllStores(probe.result);
    };
    probe.onerror = (): void => {
      dbPromise = null;
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

  // Count seal: если IDB пуста, а seal говорит что были избранные —
  // данные потеряны (Android IDB wipe). Блокируем удаление ключей.
  const seal = readSeal();
  if (memoryGuids.size === 0 && seal > 0) {
    snapshotLoaded = false;
    alert(
      t({
        en: 'Favorited points data may have been lost (storage cleared). Key auto-cleanup is blocked. Re-import favorites via module settings.',
        ru: 'Данные избранных точек могли быть потеряны (хранилище очищено). Автоочистка ключей заблокирована. Импортируйте избранные через настройки модуля.',
      }),
    );
    return;
  }

  snapshotLoaded = true;
  updateSeal();
}

/** Синхронная проверка — используется из hot path автоочистки. */
export function isFavorited(pointGuid: string): boolean {
  return memoryGuids.has(pointGuid);
}

export function getFavoritedGuids(): ReadonlySet<string> {
  return new Set(memoryGuids);
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
  // Регистрируем ожидание коммита ДО выполнения запросов — tx.oncomplete
  // может сработать сразу после последнего request.onsuccess.
  const committed = waitForTransaction(tx);
  const existing: unknown = await promisifyRequest(store.get(pointGuid));
  const cooldown = isFavoriteRecord(existing) ? existing.cooldown : null;
  const record: IFavoriteRecord = { guid: pointGuid, cooldown };
  await promisifyRequest(store.put(record));
  // Обновляем память только после фактического коммита транзакции.
  // promisifyRequest резолвится на request.onsuccess, но транзакция может
  // быть отменена после этого (квота, системное давление).
  await committed;
  memoryGuids.add(pointGuid);
  cooldownByGuid.set(pointGuid, cooldown);
  updateSeal();
  emitChange();
}

export async function removeFavorite(pointGuid: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  const store = tx.objectStore(STORE_NAME);
  const committed = waitForTransaction(tx);
  await promisifyRequest(store.delete(pointGuid));
  await committed;
  memoryGuids.delete(pointGuid);
  cooldownByGuid.delete(pointGuid);
  updateSeal();
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
  const committed = waitForTransaction(tx);
  await promisifyRequest(store.clear());
  for (const guid of parsed) {
    const record: IFavoriteRecord = { guid, cooldown: null };
    await promisifyRequest(store.put(record));
  }
  await committed;
  memoryGuids = new Set(parsed);
  cooldownByGuid = new Map(parsed.map((guid) => [guid, null]));
  updateSeal();
  emitChange();
  return parsed.length;
}

/** Только для тестов: сбрасывает кеш и закрывает БД. */
export function resetForTests(): void {
  memoryGuids = new Set();
  cooldownByGuid = new Map();
  snapshotLoaded = false;
  localStorage.removeItem(SEAL_KEY);
  if (dbPromise) {
    void dbPromise.then((db) => {
      db.close();
    });
  }
  dbPromise = null;
}
