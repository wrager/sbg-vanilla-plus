// Хранилище избранных точек совместимо с CUI: та же база `CUI`, тот же objectStore
// `favorites` (keyPath='guid'). Запись — { guid, cooldown }. Поле cooldown нужно
// только CUI (таймер остывания точки); наш модуль его не использует.
//
// До 0.6.1 модуль favoritedPoints добавлял/удалял записи (звезда в попапе,
// фильтр инвентаря). В 0.6.1 эту функциональность взяла на себя игра нативно
// (поле `f` на стопках инвентаря, см. release-notes 1.3). После переименования
// модуля в favoritesMigration write-операции стали не нужны: модуль ТОЛЬКО
// читает локальный список и переносит точки в нативные «звёздочки»/«замочки»
// игры через POST /api/marks. Поэтому хранилище упрощено до read-only API.

import { t } from './l10n';

const DB_NAME = 'CUI';
const STORE_NAME = 'favorites';
const CUI_DB_VERSION = 9;

// Count seal: количество избранных записывается в localStorage при первой
// успешной loadFavorites(). При следующем старте, если IDB пуста, а seal > 0 —
// данные потеряны (Android IDB wipe). В этом случае snapshotLoaded = false,
// удаление ключей в inventoryCleanup заблокировано, пользователь получает alert.
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
let dbPromise: Promise<IDBDatabase> | null = null;
// true после успешного loadFavorites() — означает, что memoryGuids содержит
// достоверный снимок IDB (даже если Set пуст — пользователь просто не добавлял
// избранных). false — IDB не читалась или чтение упало. Используется в
// inventoryCleanup как guard: на 0.6.0 без этого снимка ключи не удаляются.
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
  for (const record of records) {
    if (!isFavoriteRecord(record)) continue;
    memoryGuids.add(record.guid);
  }

  // Count seal: если IDB пуста, а seal говорит что были избранные —
  // данные потеряны (Android IDB wipe). Блокируем удаление ключей.
  const seal = readSeal();
  if (memoryGuids.size === 0 && seal > 0) {
    snapshotLoaded = false;
    alert(
      t({
        en: 'Favorited points data may have been lost (storage cleared). Key auto-cleanup is blocked. Re-add favorites in CUI or reinstall the script.',
        ru: 'Данные избранных точек могли быть потеряны (хранилище очищено). Автоочистка ключей заблокирована. Добавьте избранные снова в CUI или переустановите скрипт.',
      }),
    );
    return;
  }

  snapshotLoaded = true;
  updateSeal();
}

/** Синхронная проверка — для будущих use case'ов, остаётся в публичном API. */
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

/** Только для тестов: сбрасывает кеш и закрывает БД. */
export function resetForTests(): void {
  memoryGuids = new Set();
  snapshotLoaded = false;
  localStorage.removeItem(SEAL_KEY);
  if (dbPromise) {
    void dbPromise.then((db) => {
      db.close();
    });
  }
  dbPromise = null;
}
