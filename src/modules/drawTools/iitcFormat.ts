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

export type IitcParseReason =
  | 'invalid_json'
  | 'not_array'
  | 'not_object'
  | 'unsupported_type'
  | 'lat_lngs_not_array'
  | 'polyline_too_few_points'
  | 'polygon_too_few_points'
  | 'invalid_coordinates'
  | 'invalid_color';

export class IitcParseError extends Error {
  constructor(
    public readonly reason: IitcParseReason,
    public readonly path: string,
    public readonly value: unknown,
  ) {
    super(`${reason} at ${path}`);
    this.name = 'IitcParseError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isLatLng(value: unknown): value is IIitcLatLng {
  if (!isRecord(value)) return false;
  return typeof value.lat === 'number' && typeof value.lng === 'number';
}

function normalizeColor(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  if (/^#[0-9a-fA-F]{6}$/.test(value)) return value;
  if (/^#[0-9a-fA-F]{3}$/.test(value)) {
    const r = value[1];
    const g = value[2];
    const b = value[3];
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  return null;
}

function validateDrawItem(item: unknown, index: number): IIitcDrawItem {
  const path = `items[${index}]`;

  if (!isRecord(item)) {
    throw new IitcParseError('not_object', path, item);
  }
  if (item.type !== 'polyline' && item.type !== 'polygon') {
    throw new IitcParseError('unsupported_type', path, item.type);
  }
  if (!Array.isArray(item.latLngs)) {
    throw new IitcParseError('lat_lngs_not_array', path, item.latLngs);
  }
  if (item.type === 'polyline' && item.latLngs.length < 2) {
    throw new IitcParseError('polyline_too_few_points', path, item.latLngs.length);
  }
  if (item.type === 'polygon' && item.latLngs.length < 3) {
    throw new IitcParseError('polygon_too_few_points', path, item.latLngs.length);
  }

  const badIndex = item.latLngs.findIndex((coord: unknown) => !isLatLng(coord));
  if (badIndex >= 0) {
    throw new IitcParseError('invalid_coordinates', path, item.latLngs[badIndex]);
  }

  let color: string | undefined;
  if (item.color !== undefined) {
    const normalized = normalizeColor(item.color);
    if (normalized === null) {
      throw new IitcParseError('invalid_color', path, item.color);
    }
    color = normalized;
  }

  return {
    type: item.type,
    latLngs: item.latLngs as IIitcLatLng[],
    ...(color !== undefined ? { color } : {}),
  } as IIitcDrawItem;
}

/**
 * Parses IITC draw-tools JSON (array of items).
 * Only polyline/polygon are accepted in SVP MVP.
 * Throws IitcParseError with reason/path/value on validation failure.
 */
export function parseIitcDrawItems(raw: string): IIitcDrawItem[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new IitcParseError('invalid_json', 'root', raw);
  }

  if (!Array.isArray(parsed)) {
    throw new IitcParseError('not_array', 'root', parsed);
  }

  return parsed.map(validateDrawItem);
}

export function stringifyIitcDrawItems(items: IIitcDrawItem[]): string {
  return JSON.stringify(items);
}
