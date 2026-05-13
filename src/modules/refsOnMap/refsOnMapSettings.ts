/**
 * Локальные настройки модуля refsOnMap, не связанные с глобальным
 * `svp_settings`. Одно поле: `ownTeamMode` - тройной режим защиты своих
 * ключей при массовом удалении.
 *
 * Хранилище отдельно от `svp_settings`, симметрично с `svp_inventoryCleanup`:
 * глобальные настройки - тогглы модулей, локальные - параметры конкретного
 * модуля. Миграции со старого формата (keepOwnTeam, keepOneKey) нет: при
 * чтении невалидного или старого значения применяется дефолт.
 */

const STORAGE_KEY = 'svp_refsOnMap';

/**
 * Режим защиты ключей своей команды при массовом удалении:
 * - `delete` - удалять все выделенные ключи, включая свои.
 * - `keep` - не удалять ключи своей команды (полная защита).
 * - `keepOne` - у каждой своей точки оставить 1 ключ (если их больше);
 *   точки своей команды с 1 ключом не трогаются. Не-свои удаляются полностью.
 */
export type OwnTeamMode = 'delete' | 'keep' | 'keepOne';

export interface IRefsOnMapSettings {
  ownTeamMode: OwnTeamMode;
}

export function defaultRefsOnMapSettings(): IRefsOnMapSettings {
  return { ownTeamMode: 'keepOne' };
}

function isOwnTeamMode(value: unknown): value is OwnTeamMode {
  return value === 'delete' || value === 'keep' || value === 'keepOne';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function loadRefsOnMapSettings(): IRefsOnMapSettings {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return defaultRefsOnMapSettings();

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return defaultRefsOnMapSettings();
  }

  if (!isRecord(parsed)) return defaultRefsOnMapSettings();
  if (!isOwnTeamMode(parsed.ownTeamMode)) return defaultRefsOnMapSettings();

  return { ownTeamMode: parsed.ownTeamMode };
}

export function saveRefsOnMapSettings(settings: IRefsOnMapSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}
