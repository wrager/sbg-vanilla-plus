export interface IFavoritedPointsSettings {
  version: number;
  hideLastFavRef: boolean;
}

const STORAGE_KEY = 'svp_favoritedPoints';

export function defaultFavoritedPointsSettings(): IFavoritedPointsSettings {
  return {
    version: 1,
    hideLastFavRef: true,
  };
}

function isSettings(value: unknown): value is IFavoritedPointsSettings {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.version === 'number' && typeof record.hideLastFavRef === 'boolean';
}

export function loadFavoritedPointsSettings(): IFavoritedPointsSettings {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return defaultFavoritedPointsSettings();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return defaultFavoritedPointsSettings();
  }
  if (!isSettings(parsed)) return defaultFavoritedPointsSettings();
  return parsed;
}

export function saveFavoritedPointsSettings(settings: IFavoritedPointsSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}
