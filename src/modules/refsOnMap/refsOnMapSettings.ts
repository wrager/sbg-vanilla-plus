/**
 * Локальные настройки модуля refsOnMap, не связанные с глобальным
 * `svp_settings`. Сейчас единственная настройка - флаг `keepOwnTeam` для
 * чекбокса в viewer'е "Не удалять свои".
 *
 * Хранилище отдельно от `svp_settings`, симметрично с `svp_inventoryCleanup`:
 * глобальные настройки - тогглы модулей, локальные - параметры конкретного
 * модуля. Версионирование пока не нужно (одно поле, формат свежий); если
 * добавятся новые опции - перейти на схему с `version` + миграциями.
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
}

export function defaultRefsOnMapSettings(): IRefsOnMapSettings {
  return { keepOwnTeam: false };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isRefsOnMapSettings(value: unknown): value is IRefsOnMapSettings {
  if (!isRecord(value)) return false;
  return typeof value.keepOwnTeam === 'boolean';
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

  if (!isRefsOnMapSettings(parsed)) return defaultRefsOnMapSettings();
  return parsed;
}

export function saveRefsOnMapSettings(settings: IRefsOnMapSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}
