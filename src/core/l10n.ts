import { readGameSetting } from './gameSettings';

export type ILocale = 'en' | 'ru';

export interface ILocalizedString {
  en: string;
  ru: string;
}

/** Значение `settings.lang`, при котором игра берёт язык из системной локали. */
const SYSTEM_LANG = 'sys';

export function getGameLocale(): ILocale {
  try {
    const lang = readGameSetting('lang');
    if (lang === 'ru') return 'ru';
    if (lang === SYSTEM_LANG && navigator.language.startsWith('ru')) return 'ru';
  } catch {
    // Отказ чтения системной локали - английский. Дефолт игры 'sys' приводит
    // сюда всех, кто не менял язык в настройках, а t() зовётся при рендере
    // имён модулей, тостов и панели настроек: исключение положило бы весь
    // интерфейс SVP.
  }
  return 'en';
}

export function t(str: ILocalizedString): string {
  return str[getGameLocale()];
}
