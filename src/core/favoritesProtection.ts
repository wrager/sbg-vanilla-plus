export interface IFavoritesProtectionSnapshot {
  protectedGuids: ReadonlySet<string>;
  storageHealthy: boolean;
}

interface IStoredGuidsV1 {
  version: 1;
  guids: string[];
}

type LoadStatus = 'ok' | 'missing' | 'corrupt';

interface ILoadResult {
  status: LoadStatus;
  guids: Set<string>;
}

const PROTECTED_KEY = 'svp_favorites_protected_v1';
const BACKUP_KEY = 'svp_favorites_backup_v1';

function normalizeGuids(guids: Iterable<string>): Set<string> {
  const result = new Set<string>();
  for (const guid of guids) {
    if (typeof guid !== 'string') continue;
    const trimmed = guid.trim();
    if (trimmed.length === 0) continue;
    result.add(trimmed);
  }
  return result;
}

function isStoredGuidsV1(value: unknown): value is IStoredGuidsV1 {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    record.version === 1 &&
    Array.isArray(record.guids) &&
    record.guids.every((item) => typeof item === 'string')
  );
}

function loadGuids(key: string): ILoadResult {
  let raw: string | null;
  try {
    raw = localStorage.getItem(key);
  } catch {
    return { status: 'corrupt', guids: new Set<string>() };
  }

  if (raw === null) {
    return { status: 'missing', guids: new Set<string>() };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return { status: 'corrupt', guids: new Set<string>() };
  }

  if (!isStoredGuidsV1(parsed)) {
    return { status: 'corrupt', guids: new Set<string>() };
  }

  return { status: 'ok', guids: normalizeGuids(parsed.guids) };
}

function saveGuids(key: string, guids: ReadonlySet<string>): boolean {
  const payload: IStoredGuidsV1 = {
    version: 1,
    guids: Array.from(guids).sort(),
  };
  try {
    localStorage.setItem(key, JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

function isHealthy(status: LoadStatus): boolean {
  return status !== 'corrupt';
}

function buildUnion(
  currentFavoritedGuids: ReadonlySet<string>,
  protectedGuids: ReadonlySet<string>,
  backupGuids: ReadonlySet<string>,
): Set<string> {
  const result = normalizeGuids(currentFavoritedGuids);
  for (const guid of protectedGuids) {
    result.add(guid);
  }
  for (const guid of backupGuids) {
    result.add(guid);
  }
  return result;
}

export function getFavoritesProtectionSnapshot(
  currentFavoritedGuids: ReadonlySet<string>,
): IFavoritesProtectionSnapshot {
  const protectedStore = loadGuids(PROTECTED_KEY);
  const backupStore = loadGuids(BACKUP_KEY);
  return {
    protectedGuids: buildUnion(currentFavoritedGuids, protectedStore.guids, backupStore.guids),
    storageHealthy: isHealthy(protectedStore.status) && isHealthy(backupStore.status),
  };
}

/**
 * Обновляет защитный журнал:
 * - PROTECTED: sticky-набор (никогда не уменьшается автоматически)
 * - BACKUP: текущий снимок избранного (для диагностики/восстановления)
 *
 * Если одно из хранилищ повреждено, НЕ перезаписываем его автоматически
 * и возвращаем storageHealthy=false (fail-closed для удаления ключей).
 */
export function syncFavoritesProtection(
  currentFavoritedGuids: ReadonlySet<string>,
): IFavoritesProtectionSnapshot {
  const protectedStore = loadGuids(PROTECTED_KEY);
  const backupStore = loadGuids(BACKUP_KEY);

  const mergedSticky = buildUnion(
    currentFavoritedGuids,
    protectedStore.guids,
    backupStore.guids,
  );

  const storageHealthy = isHealthy(protectedStore.status) && isHealthy(backupStore.status);
  if (!storageHealthy) {
    return {
      protectedGuids: mergedSticky,
      storageHealthy: false,
    };
  }

  const backupCurrent = normalizeGuids(currentFavoritedGuids);
  const writeProtectedOk = saveGuids(PROTECTED_KEY, mergedSticky);
  const writeBackupOk = saveGuids(BACKUP_KEY, backupCurrent);

  return {
    protectedGuids: mergedSticky,
    storageHealthy: writeProtectedOk && writeBackupOk,
  };
}

export function resetFavoritesProtectionForTests(): void {
  localStorage.removeItem(PROTECTED_KEY);
  localStorage.removeItem(BACKUP_KEY);
}

