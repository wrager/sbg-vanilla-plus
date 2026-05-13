import type { IOlFeature } from './olMap';
import {
  getAmount,
  getPointGuid,
  getRefFeatureProps,
  getTeam,
  isFeatureSelected,
} from './olFeatureProps';

function makeFeature(properties: Record<string, unknown> | undefined): IOlFeature {
  return {
    getId: () => undefined,
    setId: () => undefined,
    setStyle: () => undefined,
    set: () => undefined,
    getProperties: properties === undefined ? undefined : (): Record<string, unknown> => properties,
    getGeometry: () => ({ getCoordinates: () => [0, 0] }) as unknown as IOlFeature['getGeometry'],
  } as unknown as IOlFeature;
}

describe('getRefFeatureProps', () => {
  test('returns properties when getProperties available', () => {
    const feature = makeFeature({ pointGuid: 'p1', amount: 5 });
    expect(getRefFeatureProps(feature)).toEqual({ pointGuid: 'p1', amount: 5 });
  });

  test('returns {} when getProperties absent', () => {
    const feature = makeFeature(undefined);
    expect(getRefFeatureProps(feature)).toEqual({});
  });
});

describe('getPointGuid', () => {
  test('returns string pointGuid', () => {
    expect(getPointGuid(makeFeature({ pointGuid: 'point-1' }))).toBe('point-1');
  });

  test('returns null when pointGuid missing', () => {
    expect(getPointGuid(makeFeature({}))).toBeNull();
  });

  test('returns null when pointGuid not a string', () => {
    expect(getPointGuid(makeFeature({ pointGuid: 42 }))).toBeNull();
  });
});

describe('getTeam', () => {
  test('returns team number', () => {
    expect(getTeam(makeFeature({ team: 2 }))).toBe(2);
  });

  test('returns null for neutral team', () => {
    expect(getTeam(makeFeature({ team: null }))).toBeNull();
  });

  test('returns undefined when team missing', () => {
    expect(getTeam(makeFeature({}))).toBeUndefined();
  });

  test('returns undefined when team has wrong type', () => {
    expect(getTeam(makeFeature({ team: 'red' }))).toBeUndefined();
  });
});

describe('getAmount', () => {
  test('returns amount number', () => {
    expect(getAmount(makeFeature({ amount: 7 }))).toBe(7);
  });

  test('returns 0 when amount missing', () => {
    expect(getAmount(makeFeature({}))).toBe(0);
  });

  test('returns 0 when amount has wrong type', () => {
    expect(getAmount(makeFeature({ amount: 'many' }))).toBe(0);
  });
});

describe('isFeatureSelected', () => {
  test('returns true only when isSelected === true', () => {
    expect(isFeatureSelected(makeFeature({ isSelected: true }))).toBe(true);
    expect(isFeatureSelected(makeFeature({ isSelected: false }))).toBe(false);
    expect(isFeatureSelected(makeFeature({}))).toBe(false);
    expect(isFeatureSelected(makeFeature({ isSelected: 1 }))).toBe(false);
  });
});
