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

/**
 * Полная инициализация БД CUI v26.4.1: stores + дефолтные данные.
 * Портировано из refs/cui/index.js initializeDB() (строки 147-179).
 *
 * CUI при open('CUI', 9) проверяет oldVersion:
 * - oldVersion == 0 → initializeDB() (stores + данные)
 * - oldVersion > 0  → updateDB() (миграции, ожидает stores и данные)
 * Если мы создадим stores без данных — CUI пропустит onupgradeneeded
 * (версия уже >= 9), получит пустой config и сломается.
 */
function initializeCuiDb(database: IDBDatabase, transaction: IDBTransaction): void {
  // Трекаем какие stores были созданы нами, чтобы заполнять данными только новые.
  // Если store уже существует (CUI создал раньше) — не трогаем его данные.
  const created = new Set<string>();

  function ensureStore(name: string, options?: IDBObjectStoreParameters): void {
    if (!database.objectStoreNames.contains(name)) {
      database.createObjectStore(name, options);
      created.add(name);
    }
  }

  ensureStore('config');
  ensureStore('logs', { keyPath: 'timestamp' });
  ensureStore('state');
  ensureStore('stats', { keyPath: 'name' });
  ensureStore('tiles');
  ensureStore(STORE_NAME, { keyPath: 'guid' });

  let isDarkMode = false;
  try {
    const settings: unknown = JSON.parse(localStorage.getItem('settings') ?? '{}');
    isDarkMode =
      typeof settings === 'object' &&
      settings !== null &&
      (settings as Record<string, unknown>).theme === 'dark';
  } catch {
    // Невалидный JSON — используем светлую тему по умолчанию.
  }

  // Дефолтная конфигурация CUI v26.4.1 (refs/cui/index.js defaultConfig).
  const defaultConfig: Record<string, unknown> = {
    maxAmountInBag: {
      cores: { 1: -1, 2: -1, 3: -1, 4: -1, 5: -1, 6: -1, 7: -1, 8: -1, 9: -1, 10: -1 },
      catalysers: { 1: -1, 2: -1, 3: -1, 4: -1, 5: -1, 6: -1, 7: -1, 8: -1, 9: -1, 10: -1 },
      references: { allied: -1, hostile: -1 },
    },
    autoSelect: { deploy: 'max', upgrade: 'min', attack: 'latest' },
    mapFilters: {
      invert: isDarkMode ? 1 : 0,
      hueRotate: 0,
      brightness: isDarkMode ? 0.75 : 1,
      grayscale: isDarkMode ? 1 : 0,
      sepia: 0,
      blur: 0,
      branding: 'default',
      brandingColor: '#CCCCCC',
    },
    tinting: { map: 1, point: 'team', profile: 1 },
    vibration: { buttons: 1, notifications: 1 },
    ui: {
      chamomile: 1,
      doubleClickZoom: 0,
      restoreRotation: 1,
      pointBgImage: 0,
      pointBtnsRtl: 0,
      pointBgImageBlur: 1,
      pointDischargeTimeout: 1,
    },
    pointHighlighting: {
      inner: 'uniqc',
      outer: 'off',
      outerTop: 'cores',
      outerBottom: 'highlevel',
      text: 'refsAmount',
      innerColor: '#E87100',
      outerColor: '#E87100',
      outerTopColor: '#EB4DBF',
      outerBottomColor: '#28C4F4',
    },
    drawing: {
      returnToPointInfo: 'discoverable',
      minDistance: -1,
      maxDistance: -1,
      hideLastFavRef: 0,
    },
    notifications: { status: 'all', onClick: 'jumpto', interval: 30000, duration: -1 },
  };

  if (created.has('config')) {
    const configStore = transaction.objectStore('config');
    for (const key of Object.keys(defaultConfig)) {
      configStore.add(defaultConfig[key], key);
    }
  }

  if (created.has('logs')) {
    transaction.objectStore('logs').createIndex('action_type', 'type');
  }

  if (created.has('state')) {
    const stateStore = transaction.objectStore('state');
    stateStore.add(new Set<string>(), 'excludedCores');
    stateStore.add(true, 'isMainToolbarOpened');
    stateStore.add(false, 'isRotationLocked');
    stateStore.add(false, 'isStarMode');
    stateStore.add(null, 'lastUsedCatalyser');
    stateStore.add(null, 'starModeTarget');
    stateStore.add(0, 'versionWarns');
    stateStore.add(false, 'isAutoShowPoints');
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
      const allCuiStores = ['config', 'logs', 'state', 'stats', 'tiles', STORE_NAME];
      if (allCuiStores.every((name) => db.objectStoreNames.contains(name))) {
        resolve(db);
        return;
      }
      // Не все CUI stores на месте — полная инициализация.
      // Версия = CUI_DB_VERSION чтобы CUI не запускал onupgradeneeded.
      const targetVersion = Math.max(db.version + 1, CUI_DB_VERSION);
      db.close();
      const upgrade = indexedDB.open(DB_NAME, targetVersion);
      upgrade.onupgradeneeded = (event): void => {
        const upgradeTransaction = (event.target as IDBOpenDBRequest).transaction;
        if (!upgradeTransaction) {
          reject(new Error('IDB upgrade transaction is null'));
          return;
        }
        initializeCuiDb(upgrade.result, upgradeTransaction);
      };
      upgrade.onsuccess = (): void => {
        resolve(upgrade.result);
      };
      upgrade.onerror = (): void => {
        dbPromise = null;
        reject(upgrade.error ?? new Error('IDB upgrade failed'));
      };
    };
    // probe.onupgradeneeded: БД не существовала — создаётся пустой на версии 1.
    // Не создаём stores здесь: probe.onsuccess увидит отсутствие favorites и
    // запустит upgrade до CUI_DB_VERSION с полной инициализацией.
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
