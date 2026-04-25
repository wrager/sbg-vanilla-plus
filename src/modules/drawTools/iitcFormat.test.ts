import { IitcParseError, parseIitcDrawItems, stringifyIitcDrawItems } from './iitcFormat';
import type { IitcParseReason } from './iitcFormat';

function expectParseError(
  raw: string,
  expected: { reason: IitcParseReason; path?: string; value?: unknown },
): void {
  let caught: unknown;
  try {
    parseIitcDrawItems(raw);
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(IitcParseError);
  if (!(caught instanceof IitcParseError)) return;
  expect(caught.reason).toBe(expected.reason);
  if (expected.path !== undefined) expect(caught.path).toBe(expected.path);
  if (Object.prototype.hasOwnProperty.call(expected, 'value')) {
    expect(caught.value).toEqual(expected.value);
  }
}

describe('iitcFormat', () => {
  test('parses IITC polyline/polygon items', () => {
    const raw = JSON.stringify([
      {
        type: 'polyline',
        latLngs: [
          { lat: 55.75, lng: 37.61 },
          { lat: 55.76, lng: 37.62 },
        ],
        color: '#a24ac3',
      },
      {
        type: 'polygon',
        latLngs: [
          { lat: 55.75, lng: 37.61 },
          { lat: 55.76, lng: 37.62 },
          { lat: 55.74, lng: 37.63 },
        ],
      },
    ]);

    const parsed = parseIitcDrawItems(raw);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].type).toBe('polyline');
    expect(parsed[1].type).toBe('polygon');
  });

  test('rejects invalid json with reason=invalid_json', () => {
    expectParseError('{oops', { reason: 'invalid_json' });
  });

  test('rejects non-array root with reason=not_array', () => {
    expectParseError('{}', { reason: 'not_array' });
  });

  test('rejects null item with reason=not_object', () => {
    const raw = JSON.stringify([null]);
    expectParseError(raw, { reason: 'not_object', path: 'items[0]', value: null });
  });

  test('rejects unsupported type (marker) with reason=unsupported_type', () => {
    const raw = JSON.stringify([{ type: 'marker', latLng: { lat: 55.75, lng: 37.61 } }]);
    expectParseError(raw, { reason: 'unsupported_type', path: 'items[0]', value: 'marker' });
  });

  test('rejects polyline with 1 point', () => {
    const raw = JSON.stringify([{ type: 'polyline', latLngs: [{ lat: 55.75, lng: 37.61 }] }]);
    expectParseError(raw, {
      reason: 'polyline_too_few_points',
      path: 'items[0]',
      value: 1,
    });
  });

  test('rejects polygon with 2 points', () => {
    const raw = JSON.stringify([
      {
        type: 'polygon',
        latLngs: [
          { lat: 55.75, lng: 37.61 },
          { lat: 55.76, lng: 37.62 },
        ],
      },
    ]);
    expectParseError(raw, {
      reason: 'polygon_too_few_points',
      path: 'items[0]',
      value: 2,
    });
  });

  test('rejects non-array latLngs', () => {
    const raw = JSON.stringify([{ type: 'polyline', latLngs: 'oops' }]);
    expectParseError(raw, { reason: 'lat_lngs_not_array', path: 'items[0]', value: 'oops' });
  });

  test('rejects bad coordinate, reports path with item index and the bad value', () => {
    const raw = JSON.stringify([
      {
        type: 'polyline',
        latLngs: [
          { lat: 55.75, lng: 37.61 },
          { lat: 'oops', lng: 37.62 },
        ],
      },
    ]);
    expectParseError(raw, {
      reason: 'invalid_coordinates',
      path: 'items[0]',
      value: { lat: 'oops', lng: 37.62 },
    });
  });

  test('rejects invalid color', () => {
    const raw = JSON.stringify([
      {
        type: 'polyline',
        latLngs: [
          { lat: 55.75, lng: 37.61 },
          { lat: 55.76, lng: 37.62 },
        ],
        color: '#zzz',
      },
    ]);
    expectParseError(raw, {
      reason: 'invalid_color',
      path: 'items[0]',
      value: '#zzz',
    });
  });

  test('path uses index of the failing item, not first item', () => {
    const raw = JSON.stringify([
      {
        type: 'polyline',
        latLngs: [
          { lat: 55.75, lng: 37.61 },
          { lat: 55.76, lng: 37.62 },
        ],
      },
      {
        type: 'polygon',
        latLngs: [
          { lat: 55.75, lng: 37.61 },
          { lat: 55.76, lng: 37.62 },
        ],
      },
    ]);
    expectParseError(raw, {
      reason: 'polygon_too_few_points',
      path: 'items[1]',
    });
  });

  test('stringify returns valid json string', () => {
    const raw = stringifyIitcDrawItems([
      {
        type: 'polyline',
        latLngs: [
          { lat: 55.75, lng: 37.61 },
          { lat: 55.76, lng: 37.62 },
        ],
        color: '#a24ac3',
      },
    ]);

    const parsed: unknown = JSON.parse(raw);
    expect(Array.isArray(parsed)).toBe(true);
  });
});
