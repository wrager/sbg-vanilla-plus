const STORAGE_KEY = 'svp_drawingRestrictions_starCenter';

export const STAR_CENTER_CHANGED_EVENT = 'svp:star-center-changed';

export function getStarCenterGuid(): string | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw === null || raw.length === 0) return null;
  return raw;
}

function dispatchChange(): void {
  document.dispatchEvent(new CustomEvent(STAR_CENTER_CHANGED_EVENT));
}

export function setStarCenterGuid(guid: string): void {
  if (typeof guid !== 'string' || guid.length === 0) return;
  localStorage.setItem(STORAGE_KEY, guid);
  dispatchChange();
}

export function clearStarCenter(): void {
  localStorage.removeItem(STORAGE_KEY);
  dispatchChange();
}
