import { pluralizeLastRefs } from './lastRefsPluralize';

describe('pluralizeLastRefs', () => {
  test('count=1 — единственное число', () => {
    expect(pluralizeLastRefs(1)).toEqual({
      ru: 'последний ключ',
      en: '1 last key',
    });
  });

  test.each([
    [2, 'последние 2 ключа'],
    [3, 'последние 3 ключа'],
    [4, 'последние 4 ключа'],
  ])('count=%d → "%s"', (count, expected) => {
    expect(pluralizeLastRefs(count).ru).toBe(expected);
  });

  test.each([
    [5, 'последние 5 ключей'],
    [9, 'последние 9 ключей'],
    [10, 'последние 10 ключей'],
  ])('count=%d → "%s"', (count, expected) => {
    expect(pluralizeLastRefs(count).ru).toBe(expected);
  });

  // Особый случай: 11-14 русское правило перебивает «хвост 1-4 → ключа».
  test.each([
    [11, 'последние 11 ключей'],
    [12, 'последние 12 ключей'],
    [13, 'последние 13 ключей'],
    [14, 'последние 14 ключей'],
  ])('count=%d (особый случай 11-14) → "%s"', (count, expected) => {
    expect(pluralizeLastRefs(count).ru).toBe(expected);
  });

  // После 14 правило «хвост по последней цифре» снова работает.
  // Хвост 1 (вне 11..14) - «ключ», 2..4 - «ключа», 0/5..9 - «ключей».
  test.each([
    [21, 'последние 21 ключ'],
    [22, 'последние 22 ключа'],
    [24, 'последние 24 ключа'],
    [25, 'последние 25 ключей'],
    [101, 'последние 101 ключ'],
    [111, 'последние 111 ключей'],
    [112, 'последние 112 ключей'],
    [121, 'последние 121 ключ'],
  ])('count=%d (хвост по последней цифре) → "%s"', (count, expected) => {
    expect(pluralizeLastRefs(count).ru).toBe(expected);
  });

  test('en: count>1 всегда множественное число', () => {
    expect(pluralizeLastRefs(2).en).toBe('2 last keys');
    expect(pluralizeLastRefs(11).en).toBe('11 last keys');
    expect(pluralizeLastRefs(100).en).toBe('100 last keys');
  });
});
