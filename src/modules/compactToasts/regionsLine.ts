/**
 * Короткая строка про новые регионы.
 *
 * Замкнув регион линией, игрок получает трёхстрочный тост
 * (`popups.new-regions`, refs/game/script.js:1753):
 *
 *   Новые регионы: 3<br>Общая площадь: 1.4 км²<br>Макс. площадь: 0.7 км²
 *
 * В серии рисования такие тосты идут вперемешку с отказами сервера, и в общем
 * блоке три строки на одно событие вытесняют всё остальное. Здесь тост
 * узнаётся по шаблону из локализации самой игры и заменяется одной строкой.
 *
 * Локализацию игры используем и для распознавания, и для текста: слово берётся
 * из игрового ключа `info.regions`, площадь - уже отформатированная игрой
 * (`areaToString`, refs/game/script.js), поэтому единицы измерения и язык
 * совпадают с тем, что игрок видит в остальном интерфейсе.
 */

const REGIONS_TEMPLATE_KEY = 'popups.new-regions';
const REGIONS_LABEL_KEY = 'info.regions';

/** Namespace переводов игры (`defaultNs`, refs/game/script.js:41-52). */
const GAME_I18N_NAMESPACE = 'main';

interface IGameI18n {
  language?: string;
  resolvedLanguage?: string;
  t(key: string): unknown;
  getResource(language: string, namespace: string, key: string): unknown;
}

interface ITemplateCache {
  language: string;
  pattern: RegExp | null;
}

let cache: ITemplateCache | null = null;

function getGameI18n(): IGameI18n | null {
  const globals = window as unknown as Record<string, unknown>;
  const i18next = globals['i18next'];
  if (typeof i18next !== 'object' || i18next === null) return null;

  const candidate = i18next as Partial<IGameI18n>;
  if (typeof candidate.t !== 'function' || typeof candidate.getResource !== 'function') return null;
  return candidate as IGameI18n;
}

function getLanguage(i18n: IGameI18n): string {
  return i18n.resolvedLanguage ?? i18n.language ?? '';
}

function escapeForRegExp(source: string): string {
  return source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Регулярка из игрового шаблона: плейсхолдеры заменяются на группы захвата,
 * остальное экранируется. Шаблон берётся сырым через `getResource`, а не через
 * `t()` с подставными значениями: `count` у i18next зарезервирован под
 * плюрализацию, и подстановка в него постороннего значения меняла бы разбор.
 */
function buildPattern(template: string): RegExp | null {
  const parts = template.split(/\{\{(?:count|area|max)\}\}/);
  if (parts.length !== 4) return null;

  const [before, betweenCountAndArea, betweenAreaAndMax, after] = parts;
  const body = [
    escapeForRegExp(before),
    '(\\d+)',
    escapeForRegExp(betweenCountAndArea),
    '(.+?)',
    escapeForRegExp(betweenAreaAndMax),
    '(.+?)',
    escapeForRegExp(after),
  ].join('');

  return new RegExp(`^${body}$`);
}

/**
 * Шаблон кэшируется вместе с языком: игрок может сменить язык игры, не
 * перезагружая страницу, и старая регулярка перестала бы совпадать.
 */
function getPattern(i18n: IGameI18n): RegExp | null {
  const language = getLanguage(i18n);
  if (cache !== null && cache.language === language) return cache.pattern;

  const template = i18n.getResource(language, GAME_I18N_NAMESPACE, REGIONS_TEMPLATE_KEY);
  const pattern = typeof template === 'string' ? buildPattern(template) : null;
  cache = { language, pattern };
  return pattern;
}

/** Тестовый сброс кэша шаблона. Только для тестов. */
export function resetRegionsTemplateCacheForTest(): void {
  cache = null;
}

/**
 * Заменяет игровой тост про новые регионы короткой строкой. Любой другой текст
 * возвращается как есть: обрезать чужие сообщения по длине нельзя, оборванная
 * фраза хуже длинной.
 */
export function shortenRegionsText(text: string): string {
  const i18n = getGameI18n();
  if (i18n === null) return text;

  const pattern = getPattern(i18n);
  if (pattern === null) return text;

  const match = pattern.exec(text);
  if (match === null) return text;

  const label = i18n.t(REGIONS_LABEL_KEY);
  if (typeof label !== 'string' || label === REGIONS_LABEL_KEY) return text;

  const [, count, area] = match;
  return `${label}: +${count} (${area})`;
}
