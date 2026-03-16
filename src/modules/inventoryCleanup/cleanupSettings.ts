export interface ICleanupLimits {
  cores: Record<number, number>;
  catalysers: Record<number, number>;
  references: number;
}

export interface ICleanupSettings {
  version: number;
  limits: ICleanupLimits;
  minFreeSlots: number;
}

const STORAGE_KEY = 'svp_inventoryCleanup';
const MIN_FREE_SLOTS_FLOOR = 20;

function defaultLevelLimits(): Record<number, number> {
  const limits: Record<number, number> = {};
  for (let level = 1; level <= 10; level++) {
    limits[level] = -1;
  }
  return limits;
}

export function defaultCleanupSettings(): ICleanupSettings {
  return {
    version: 1,
    limits: {
      cores: defaultLevelLimits(),
      catalysers: defaultLevelLimits(),
      references: -1,
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

function isCleanupLimits(value: unknown): value is ICleanupLimits {
  if (!isRecord(value)) return false;
  return (
    isLevelLimits(value.cores) &&
    isLevelLimits(value.catalysers) &&
    typeof value.references === 'number'
  );
}

function isCleanupSettings(value: unknown): value is ICleanupSettings {
  if (!isRecord(value)) return false;
  return (
    typeof value.version === 'number' &&
    isCleanupLimits(value.limits) &&
    typeof value.minFreeSlots === 'number'
  );
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

  if (!isCleanupSettings(parsed)) return defaultCleanupSettings();
  if (parsed.minFreeSlots < MIN_FREE_SLOTS_FLOOR) {
    parsed.minFreeSlots = MIN_FREE_SLOTS_FLOOR;
  }
  sanitizeLimits(parsed.limits);
  return parsed;
}

/** Clamp invalid negative limits (not -1) to 0. */
function sanitizeLevelLimits(limits: Record<number, number>): void {
  for (let level = 1; level <= 10; level++) {
    if (limits[level] < -1) {
      limits[level] = 0;
    }
  }
}

function sanitizeLimits(limits: ICleanupLimits): void {
  sanitizeLevelLimits(limits.cores);
  sanitizeLevelLimits(limits.catalysers);
  if (limits.references < -1) {
    limits.references = 0;
  }
}

export function saveCleanupSettings(settings: ICleanupSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}
