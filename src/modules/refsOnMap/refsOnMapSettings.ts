/**
 * Локальные настройки модуля refsOnMap, не связанные с глобальным
 * `svp_settings`. Поля: `keepOwnTeam` (фильтр свои), `keepOneKey` (оставлять
 * 1 ключ на точку после удаления).
 *
 * Хранилище отдельно от `svp_settings`, симметрично с `svp_inventoryCleanup`:
 * глобальные настройки - тогглы модулей, локальные - параметры конкретного
 * модуля. Версионирование не используем: для каждого поля - явный fallback
 * на default при отсутствии или невалидном типе. Это безопасно совместимо со
 * старыми записями localStorage без новых полей.
 */

const STORAGE_KEY = 'svp_refsOnMap';

export interface IRefsOnMapSettings {
  /**
   * При `true` viewer пропускает в `protectedByOwnTeam` ключи точек, чья
   * команда совпадает с командой игрока (а также точек с неизвестной
   * командой - fail-safe). Дефолт - `false`: исторически viewer удалял всех,
   * флаг - opt-in.
   */
  keepOwnTeam: boolean;
  /**
   * При `true` viewer при удалении гарантирует, что у каждой выделенной точки
   * в инвентаре останется минимум 1 ключ (с учётом невыделенных стопок).
   * Дефолт - `true`: типичный сценарий пользователя, защита от случайного
   * полного удаления ключей точки. fail-safe: если запись в localStorage
   * отсутствует или невалидна, флаг считается включённым (см. README).
   */
  keepOneKey: boolean;
}

export function defaultRefsOnMapSettings(): IRefsOnMapSettings {
  return { keepOwnTeam: false, keepOneKey: true };
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

  // Per-field fallback: невалидное или отсутствующее поле -> default. Это
  // важно для keepOneKey: при добавлении флага у пользователей в localStorage
  // уже лежит запись с keepOwnTeam, но без keepOneKey. Чтение должно вернуть
  // keepOneKey=true (default), а не сломаться и не отдать false.
  const defaults = defaultRefsOnMapSettings();
  return {
    keepOwnTeam:
      typeof parsed.keepOwnTeam === 'boolean' ? parsed.keepOwnTeam : defaults.keepOwnTeam,
    keepOneKey: typeof parsed.keepOneKey === 'boolean' ? parsed.keepOneKey : defaults.keepOneKey,
  };
}

export function saveRefsOnMapSettings(settings: IRefsOnMapSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}
