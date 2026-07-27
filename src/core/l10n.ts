export type ILocale = 'en' | 'ru';

export interface ILocalizedString {
  en: string;
  ru: string;
}

// Дефолт игры для settings.lang: язык берётся из системной локали
// (refs/game/script.js:3674, getLocalStorageDefault).
const GAME_DEFAULT_LANG = 'sys';

/**
 * Язык из игровых настроек. Отсутствие ключа `settings` - штатное состояние,
 * а не "настроек нет": SBG 0.7.0 убрал материализацию ключа при первом запуске
 * (refs/game/script.js:3641, initSettings), теперь игра читает значения через
 * getLocalStorageDefault и пишет ключ только при первом изменении настройки.
 * Поэтому у игрока, ни разу не заходившего в настройки, ключа нет, а игра при
 * этом показывает интерфейс по системной локали - возвращаем тот же дефолт.
 */
function readGameLang(): string {
  try {
    const raw = localStorage.getItem('settings');
    if (raw === null) return GAME_DEFAULT_LANG;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null && 'lang' in parsed) {
      if (typeof parsed.lang === 'string') return parsed.lang;
    }
  } catch {
    // Невалидный JSON - трактуем так же, как отсутствие ключа.
  }
  return GAME_DEFAULT_LANG;
}

export function getGameLocale(): ILocale {
  const lang = readGameLang();
  if (lang === 'ru') return 'ru';
  if (lang === GAME_DEFAULT_LANG && navigator.language.startsWith('ru')) return 'ru';
  return 'en';
}

export function t(str: ILocalizedString): string {
  return str[getGameLocale()];
}
