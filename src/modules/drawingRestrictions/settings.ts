export interface IDrawingRestrictionsSettings {
  version: number;
  maxDistanceMeters: number;
}

const STORAGE_KEY = 'svp_drawingRestrictions';

export function defaultDrawingRestrictionsSettings(): IDrawingRestrictionsSettings {
  return {
    version: 1,
    maxDistanceMeters: 0,
  };
}

function isSettings(value: unknown): value is IDrawingRestrictionsSettings {
  return (
    typeof value === 'object' &&
    value !== null &&
    'version' in value &&
    typeof value.version === 'number' &&
    'maxDistanceMeters' in value &&
    typeof value.maxDistanceMeters === 'number'
  );
}

/**
 * Чистый геттер: читает свежий ключ localStorage, без записи. Возвращает defaults,
 * если ключ отсутствует или значение не проходит валидацию.
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
  return { version: parsed.version, maxDistanceMeters: parsed.maxDistanceMeters };
}

export function saveDrawingRestrictionsSettings(settings: IDrawingRestrictionsSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}
