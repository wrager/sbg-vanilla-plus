export type FavProtectionMode = 'off' | 'protectLastKey' | 'hideAllFavorites';

export interface IDrawingRestrictionsSettings {
  version: number;
  favProtectionMode: FavProtectionMode;
  maxDistanceMeters: number;
}

const STORAGE_KEY = 'svp_drawingRestrictions';
const LEGACY_STORAGE_KEY = 'svp_favoritedPoints';

export function defaultDrawingRestrictionsSettings(): IDrawingRestrictionsSettings {
  return {
    version: 1,
    favProtectionMode: 'protectLastKey',
    maxDistanceMeters: 0,
  };
}

function isFavProtectionMode(value: unknown): value is FavProtectionMode {
  return value === 'off' || value === 'protectLastKey' || value === 'hideAllFavorites';
}

function isSettings(value: unknown): value is IDrawingRestrictionsSettings {
  return (
    typeof value === 'object' &&
    value !== null &&
    'version' in value &&
    typeof value.version === 'number' &&
    'favProtectionMode' in value &&
    isFavProtectionMode(value.favProtectionMode) &&
    'maxDistanceMeters' in value &&
    typeof value.maxDistanceMeters === 'number'
  );
}

function readLegacyFavMode(): FavProtectionMode | null {
  const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  if (!('hideLastFavRef' in parsed)) return null;
  const value = parsed.hideLastFavRef;
  if (typeof value !== 'boolean') return null;
  return value ? 'protectLastKey' : 'off';
}

/**
 * Чистый геттер: читает свежий ключ localStorage, без записи. Возвращает defaults,
 * если ключ отсутствует или значение не проходит валидацию. Миграция со старого
 * ключа `hideLastFavRef` выполняется отдельно — `migrateDrawingRestrictionsSettings`
 * вызывается из `init()` модуля.
 */
export function loadDrawingRestrictionsSettings(): IDrawingRestrictionsSettings {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return defaultDrawingRestrictionsSettings();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return defaultDrawingRestrictionsSettings();
  }
  if (!isSettings(parsed)) return defaultDrawingRestrictionsSettings();
  return parsed;
}

export function saveDrawingRestrictionsSettings(settings: IDrawingRestrictionsSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

/**
 * Идемпотентная миграция: при отсутствии `svp_drawingRestrictions` переносит
 * настройку `hideLastFavRef` из legacy-ключа `svp_favoritedPoints` и сохраняет
 * defaults с подставленным `favProtectionMode`. Вызывается из `init()` модуля —
 * один раз за жизнь страницы, до первого `load`.
 */
export function migrateDrawingRestrictionsSettings(): void {
  if (localStorage.getItem(STORAGE_KEY) !== null) return;
  const legacy = readLegacyFavMode();
  const migrated: IDrawingRestrictionsSettings = {
    ...defaultDrawingRestrictionsSettings(),
    favProtectionMode: legacy ?? 'protectLastKey',
  };
  saveDrawingRestrictionsSettings(migrated);
}
