const STORAGE_KEY = 'svp_drawingRestrictions_starCenter';

export const STAR_CENTER_CHANGED_EVENT = 'svp:star-center-changed';

export interface IStarCenter {
  guid: string;
  /** Название точки-центра. Пустая строка если имя не удалось получить при назначении. */
  name: string;
}

function parseStored(raw: string | null): IStarCenter | null {
  if (raw === null || raw.length === 0) return null;
  // Обратная совместимость: раньше хранили чистый GUID без name. Если парсинг
  // JSON не удался или результат — строка, трактуем как legacy-формат.
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null) {
      const record = parsed as Record<string, unknown>;
      if (typeof record.guid === 'string' && record.guid.length > 0) {
        const name = typeof record.name === 'string' ? record.name : '';
        return { guid: record.guid, name };
      }
    }
  } catch {
    // raw не JSON — возможно, legacy plain GUID.
  }
  return { guid: raw, name: '' };
}

export function getStarCenter(): IStarCenter | null {
  return parseStored(localStorage.getItem(STORAGE_KEY));
}

export function getStarCenterGuid(): string | null {
  return getStarCenter()?.guid ?? null;
}

function dispatchChange(): void {
  document.dispatchEvent(new CustomEvent(STAR_CENTER_CHANGED_EVENT));
}

export function setStarCenter(guid: string, name: string): void {
  if (typeof guid !== 'string' || guid.length === 0) return;
  const safeName = typeof name === 'string' ? name : '';
  const payload: IStarCenter = { guid, name: safeName };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  dispatchChange();
}

export function clearStarCenter(): void {
  localStorage.removeItem(STORAGE_KEY);
  dispatchChange();
}
