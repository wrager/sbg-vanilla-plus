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
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.version === 'number' &&
    isFavProtectionMode(record.favProtectionMode) &&
    typeof record.maxDistanceMeters === 'number'
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
  const value = (parsed as Record<string, unknown>).hideLastFavRef;
  if (typeof value !== 'boolean') return null;
  return value ? 'protectLastKey' : 'off';
}

export function loadDrawingRestrictionsSettings(): IDrawingRestrictionsSettings {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      return defaultDrawingRestrictionsSettings();
    }
    if (!isSettings(parsed)) return defaultDrawingRestrictionsSettings();
    return parsed;
  }
  // Первый запуск: переносим значение из favoritedPoints.hideLastFavRef, чтобы
  // пользовательская настройка «защита последнего ключа» не сбросилась при переезде.
  const legacy = readLegacyFavMode();
  const migrated: IDrawingRestrictionsSettings = {
    ...defaultDrawingRestrictionsSettings(),
    favProtectionMode: legacy ?? 'protectLastKey',
  };
  saveDrawingRestrictionsSettings(migrated);
  return migrated;
}

export function saveDrawingRestrictionsSettings(settings: IDrawingRestrictionsSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}
