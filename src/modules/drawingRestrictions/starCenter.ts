const STORAGE_KEY = 'svp_drawingRestrictions_starCenter';

export const STAR_CENTER_CHANGED_EVENT = 'svp:star-center-changed';

export interface IStarCenter {
  guid: string;
}

function parseStored(raw: string | null): IStarCenter | null {
  if (raw === null || raw.length === 0) return null;
  // Поддерживаем оба формата: JSON-объект `{ guid }` (с возможным полем name от
  // прошлых версий - игнорируется) и чистый GUID как строка (legacy plain).
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null && 'guid' in parsed) {
      const guidValue = parsed.guid;
      if (typeof guidValue === 'string' && guidValue.length > 0) {
        return { guid: guidValue };
      }
    }
  } catch {
    // raw не JSON - возможно, legacy plain GUID.
  }
  return { guid: raw };
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

export function setStarCenter(guid: string): void {
  if (typeof guid !== 'string' || guid.length === 0) return;
  const payload: IStarCenter = { guid };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  dispatchChange();
}

export function clearStarCenter(): void {
  localStorage.removeItem(STORAGE_KEY);
  dispatchChange();
}
