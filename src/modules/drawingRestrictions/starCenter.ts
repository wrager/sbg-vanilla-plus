const STORAGE_KEY = 'svp_drawingRestrictions_starCenter';

export const STAR_CENTER_CHANGED_EVENT = 'svp:star-center-changed';

export interface IStarCenter {
  guid: string;
  active: boolean;
}

function parseStored(raw: string | null): IStarCenter | null {
  if (raw === null || raw.length === 0) return null;
  // Три формата:
  // - JSON `{ guid, active }` - текущий.
  // - JSON `{ guid }` (с возможным полем name от прошлых версий) - legacy,
  //   active по умолчанию true (центр был активен у пользователя на старой
  //   версии - режим продолжает работать после обновления).
  // - Plain GUID как строка - самый старый legacy.
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null && 'guid' in parsed) {
      const guidValue = parsed.guid;
      if (typeof guidValue === 'string' && guidValue.length > 0) {
        const activeValue = 'active' in parsed ? parsed.active : undefined;
        const active = typeof activeValue === 'boolean' ? activeValue : true;
        return { guid: guidValue, active };
      }
    }
  } catch {
    // raw не JSON - возможно, legacy plain GUID.
  }
  return { guid: raw, active: true };
}

export function getStarCenter(): IStarCenter | null {
  return parseStored(localStorage.getItem(STORAGE_KEY));
}

export function getStarCenterGuid(): string | null {
  return getStarCenter()?.guid ?? null;
}

/**
 * GUID центра только если режим звезды сейчас активен. Используется фильтром
 * /api/draw и map-highlight: оба должны игнорировать запомненный, но
 * выключенный центр. Для UI (видимость map-toggle, is-active в попап-кнопке)
 * используется getStarCenter() / getStarCenterGuid() - им важно само наличие
 * запомненного guid, чтобы рисовать toggle и переключать его состояние.
 */
export function getActiveStarCenterGuid(): string | null {
  const star = getStarCenter();
  if (star === null || !star.active) return null;
  return star.guid;
}

function dispatchChange(): void {
  document.dispatchEvent(new CustomEvent(STAR_CENTER_CHANGED_EVENT));
}

function writeStarCenter(state: IStarCenter): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

/**
 * Назначить новый центр. Всегда auto-активирует режим: назначение точки
 * центром в попапе - сильный intent пользователя начать рисовать звезду.
 * Сценарий "назначить, но оставить выключенным" не нужен и сбивал бы.
 */
export function setStarCenter(guid: string): void {
  if (typeof guid !== 'string' || guid.length === 0) return;
  writeStarCenter({ guid, active: true });
  dispatchChange();
}

/**
 * Переключить активность режима без потери запомненного guid. Используется
 * map-toggle (включить/выключить из карты, не возвращаясь к опорной точке) и
 * попап-кнопкой (когда попап открыт на запомненной точке - переключает
 * режим). Если центра нет - no-op (нечего активировать).
 */
export function setStarCenterActive(active: boolean): void {
  const star = getStarCenter();
  if (star === null) return;
  if (star.active === active) return;
  writeStarCenter({ guid: star.guid, active });
  dispatchChange();
}

/**
 * Полное удаление центра. В user-facing UX не вызывается: guid обновляется
 * при назначении нового через попап, выключение делается через
 * setStarCenterActive. Остаётся для install-time auto-clear, когда точка
 * получила замочек между сессиями - там центр действительно нужно забыть
 * полностью, чтобы next-session не активировал режим автоматически.
 */
export function clearStarCenter(): void {
  localStorage.removeItem(STORAGE_KEY);
  dispatchChange();
}

/**
 * Idempotent eager migration. Читает raw и, если значение в legacy формате
 * (plain GUID или JSON `{ guid }` без active), перезаписывает в новый формат
 * `{ guid, active: true }`. На новом формате - no-op (raw совпадает с
 * сериализацией parsed). Event не диспатчится: фильтрационное поведение не
 * меняется. Вызывается из drawingRestrictions.enable() первой, чтобы UI и
 * фильтр сразу читали унифицированный формат.
 */
export function migrateLegacyStarCenter(): void {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw === null || raw.length === 0) return;
  const parsed = parseStored(raw);
  if (parsed === null) return;
  const serialized = JSON.stringify(parsed);
  if (serialized === raw) return;
  localStorage.setItem(STORAGE_KEY, serialized);
}
