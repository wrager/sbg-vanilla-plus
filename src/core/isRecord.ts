/**
 * Значение пригодно для чтения по строковому ключу: объект, не null.
 *
 * Основной потребитель - разбор JSON из localStorage и игровых ответов, где
 * `JSON.parse` отдаёт unknown, а дальше нужен доступ по имени поля.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
