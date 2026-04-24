export interface IIitcLatLng {
  lat: number;
  lng: number;
}

export interface IIitcPolylineItem {
  type: 'polyline';
  latLngs: IIitcLatLng[];
  color?: string;
}

export interface IIitcPolygonItem {
  type: 'polygon';
  latLngs: IIitcLatLng[];
  color?: string;
}

export type IIitcDrawItem = IIitcPolylineItem | IIitcPolygonItem;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isLatLng(value: unknown): value is IIitcLatLng {
  if (!isRecord(value)) return false;
  return typeof value.lat === 'number' && typeof value.lng === 'number';
}

function isColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value);
}

function isDrawItem(value: unknown): value is IIitcDrawItem {
  if (!isRecord(value)) return false;
  if (value.type !== 'polyline' && value.type !== 'polygon') return false;
  if (!Array.isArray(value.latLngs)) return false;
  if (value.latLngs.length < 2) return false;
  if (!value.latLngs.every(isLatLng)) return false;
  if (value.color !== undefined && !isColor(value.color)) return false;
  return true;
}

/**
 * Parses IITC draw-tools JSON (array of items).
 * Only polyline/polygon are accepted in SVP MVP.
 */
export function parseIitcDrawItems(raw: string): IIitcDrawItem[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new Error('Invalid JSON');
  }

  if (!Array.isArray(parsed)) {
    throw new Error('Draw data must be an array');
  }

  const items: IIitcDrawItem[] = [];
  for (const item of parsed) {
    if (!isDrawItem(item)) {
      throw new Error('Unsupported or invalid draw item');
    }
    items.push(item);
  }

  return items;
}

export function stringifyIitcDrawItems(items: IIitcDrawItem[]): string {
  return JSON.stringify(items);
}

