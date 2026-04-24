import { parseIitcDrawItems, stringifyIitcDrawItems } from './iitcFormat';

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

  test('rejects invalid json', () => {
    expect(() => parseIitcDrawItems('{oops')).toThrow('Invalid JSON');
  });

  test('rejects unsupported item types (marker/circle)', () => {
    const raw = JSON.stringify([
      {
        type: 'marker',
        latLng: { lat: 55.75, lng: 37.61 },
      },
    ]);

    expect(() => parseIitcDrawItems(raw)).toThrow('Unsupported or invalid draw item');
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

