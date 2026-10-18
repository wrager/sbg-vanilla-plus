import { extractXpDiff } from './xpResponse';

describe('extractXpDiff', () => {
  test.each([
    ['ответ действия целиком', { xp: { cur: 16914979, diff: 130 } }, 130],
    ['без cur - берём то, что есть', { xp: { diff: 130 } }, 130],
    ['нулевой прирост доходит до вызывающего', { xp: { cur: 10, diff: 0 } }, 0],
    ['отрицательный прирост доходит до вызывающего', { xp: { cur: 10, diff: -5 } }, -5],
  ])('%s', (_name, payload, expected) => {
    expect(extractXpDiff(payload)).toBe(expected);
  });

  test.each([
    ['нет поля xp', {}],
    // GET /api/profile отдаёт xp числом (refs/game/script.js:3305) - совпадение
    // по имени поля не должно превратиться в попап.
    ['xp - число, форма /api/profile', { xp: 16914849 }],
    ['xp - null', { xp: null }],
    ['diff - строка', { xp: { diff: '130' } }],
    ['diff - NaN', { xp: { diff: Number.NaN } }],
    ['diff - Infinity', { xp: { diff: Number.POSITIVE_INFINITY } }],
    ['ошибка сервера вместо данных', { error: 'Точка вне зоны действия' }],
    ['корень - null', null],
    ['корень - строка с валидным JSON внутри', '{"xp":{"diff":1}}'],
    // isRecord пропускает массивы (это `typeof === object` плюс отсев null),
    // отсекать их обязан сам потребитель - проверяем, что отсекает.
    ['корень - массив', [{ xp: { diff: 1 } }]],
  ])('%s - null', (_name, payload) => {
    expect(extractXpDiff(payload)).toBeNull();
  });
});
