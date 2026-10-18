import { isRecord } from '../../core/isRecord';

/**
 * Прирост опыта из тела ответа игрового API. Опыт приходит в поле
 * `{ xp: { cur, diff } }` ответов на действия; их разбирает handleExpChange
 * (refs/game/script.js:2776-2781).
 *
 * Возвращает null, если тело не наше: ошибка сервера (`{ error }`), профиль
 * (там xp - число, а не пара, refs/game/script.js:3305), посторонний JSON.
 *
 * Отдаётся число, а не type guard на весь объект: потребителю нужен ровно
 * diff, `cur` игра забирает себе для пересчёта уровня.
 */
export function extractXpDiff(payload: unknown): number | null {
  if (!isRecord(payload)) return null;

  const xp = payload.xp;
  // Отсекает и отсутствие поля, и форму /api/profile, где xp - число.
  if (!isRecord(xp)) return null;

  const diff = xp.diff;
  if (typeof diff !== 'number' || !Number.isFinite(diff)) return null;

  return diff;
}
