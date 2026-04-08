export type ReferencesMode = 'off' | 'fast' | 'slow';

export interface ICleanupLimits {
  cores: Record<number, number>;
  catalysers: Record<number, number>;
  /**
   * Режим удаления ключей:
   * - 'off': автоочистка не трогает ключи.
   * - 'fast': лимит на точку referencesFastLimit; работает синхронно в автоочистке.
   * - 'slow': раздельные лимиты союзные/несоюзные; требует /api/point для каждого
   *   уникального GUID точки, вызывается только вручную по кнопке.
   */
  referencesMode: ReferencesMode;
  referencesFastLimit: number;
  referencesAlliedLimit: number;
  referencesNotAlliedLimit: number;
}

export interface ICleanupSettings {
  version: number;
  limits: ICleanupLimits;
  minFreeSlots: number;
}

const STORAGE_KEY = 'svp_inventoryCleanup';
const MIN_FREE_SLOTS_FLOOR = 20;
const CURRENT_VERSION = 2;

function defaultLevelLimits(): Record<number, number> {
  const limits: Record<number, number> = {};
  for (let level = 1; level <= 10; level++) {
    limits[level] = -1;
  }
  return limits;
}

export function defaultCleanupSettings(): ICleanupSettings {
  return {
    version: CURRENT_VERSION,
    limits: {
      cores: defaultLevelLimits(),
      catalysers: defaultLevelLimits(),
      referencesMode: 'off',
      referencesFastLimit: -1,
      referencesAlliedLimit: -1,
      referencesNotAlliedLimit: -1,
    },
    minFreeSlots: 100,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isLevelLimits(value: unknown): value is Record<number, number> {
  if (!isRecord(value)) return false;
  for (let level = 1; level <= 10; level++) {
    if (typeof value[level] !== 'number') return false;
  }
  return true;
}

function isReferencesMode(value: unknown): value is ReferencesMode {
  return value === 'off' || value === 'fast' || value === 'slow';
}

function isCleanupLimitsV2(value: unknown): value is ICleanupLimits {
  if (!isRecord(value)) return false;
  return (
    isLevelLimits(value.cores) &&
    isLevelLimits(value.catalysers) &&
    isReferencesMode(value.referencesMode) &&
    typeof value.referencesFastLimit === 'number' &&
    typeof value.referencesAlliedLimit === 'number' &&
    typeof value.referencesNotAlliedLimit === 'number'
  );
}

function isCleanupSettingsV2(value: unknown): value is ICleanupSettings {
  if (!isRecord(value)) return false;
  return (
    typeof value.version === 'number' &&
    isCleanupLimitsV2(value.limits) &&
    typeof value.minFreeSlots === 'number'
  );
}

/** v1 limits: old format with `references: number`. */
interface ICleanupLimitsV1 {
  cores: Record<number, number>;
  catalysers: Record<number, number>;
  references: number;
}

function isCleanupLimitsV1(value: unknown): value is ICleanupLimitsV1 {
  if (!isRecord(value)) return false;
  return (
    isLevelLimits(value.cores) &&
    isLevelLimits(value.catalysers) &&
    typeof value.references === 'number'
  );
}

interface ICleanupSettingsV1 {
  version: number;
  limits: ICleanupLimitsV1;
  minFreeSlots: number;
}

function isCleanupSettingsV1(value: unknown): value is ICleanupSettingsV1 {
  if (!isRecord(value)) return false;
  return (
    typeof value.version === 'number' &&
    value.version === 1 &&
    isCleanupLimitsV1(value.limits) &&
    typeof value.minFreeSlots === 'number'
  );
}

function migrateV1ToV2(v1: ICleanupSettingsV1): ICleanupSettings {
  // v1: references: -1 означало «не удалять». Переводим в 'off'.
  // v1: references >= 0 означало общий лимит. Переводим в 'fast' с тем же числом.
  const { references } = v1.limits;
  const mode: ReferencesMode = references === -1 ? 'off' : 'fast';
  return {
    version: 2,
    limits: {
      cores: v1.limits.cores,
      catalysers: v1.limits.catalysers,
      referencesMode: mode,
      referencesFastLimit: references,
      referencesAlliedLimit: -1,
      referencesNotAlliedLimit: -1,
    },
    minFreeSlots: v1.minFreeSlots,
  };
}

export function loadCleanupSettings(): ICleanupSettings {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return defaultCleanupSettings();

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return defaultCleanupSettings();
  }

  if (isCleanupSettingsV1(parsed)) {
    const migrated = migrateV1ToV2(parsed);
    saveCleanupSettings(migrated);
    return applyRuntimeGuards(migrated);
  }

  if (!isCleanupSettingsV2(parsed)) return defaultCleanupSettings();
  return applyRuntimeGuards(parsed);
}

function applyRuntimeGuards(settings: ICleanupSettings): ICleanupSettings {
  if (settings.minFreeSlots < MIN_FREE_SLOTS_FLOOR) {
    settings.minFreeSlots = MIN_FREE_SLOTS_FLOOR;
  }
  sanitizeLimits(settings.limits);
  return settings;
}

/** Clamp invalid negative limits (not -1) to 0. */
function sanitizeLevelLimits(limits: Record<number, number>): void {
  for (let level = 1; level <= 10; level++) {
    if (limits[level] < -1) {
      limits[level] = 0;
    }
  }
}

function sanitizeRefLimit(value: number): number {
  return value < -1 ? 0 : value;
}

function sanitizeLimits(limits: ICleanupLimits): void {
  sanitizeLevelLimits(limits.cores);
  sanitizeLevelLimits(limits.catalysers);
  limits.referencesFastLimit = sanitizeRefLimit(limits.referencesFastLimit);
  limits.referencesAlliedLimit = sanitizeRefLimit(limits.referencesAlliedLimit);
  limits.referencesNotAlliedLimit = sanitizeRefLimit(limits.referencesNotAlliedLimit);
}

export function saveCleanupSettings(settings: ICleanupSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}
