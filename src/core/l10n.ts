import { readGameSetting } from './gameSettings';

export type ILocale = 'en' | 'ru';

export interface ILocalizedString {
  en: string;
  ru: string;
}

/** Значение `settings.lang`, при котором игра берёт язык из системной локали. */
const SYSTEM_LANG = 'sys';

export function getGameLocale(): ILocale {
  const lang = readGameSetting('lang');
  if (lang === 'ru') return 'ru';
  if (lang === SYSTEM_LANG && navigator.language.startsWith('ru')) return 'ru';
  return 'en';
}

export function t(str: ILocalizedString): string {
  return str[getGameLocale()];
}
