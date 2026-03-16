export type ILocale = 'en' | 'ru';

export interface ILocalizedString {
  en: string;
  ru: string;
}

export function getGameLocale(): ILocale {
  try {
    const raw = localStorage.getItem('settings');
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed === 'object' && parsed !== null && 'lang' in parsed) {
        if (parsed.lang === 'ru') return 'ru';
        if (parsed.lang === 'sys' && navigator.language.startsWith('ru')) return 'ru';
      }
    }
  } catch {
    // ignore parse errors
  }
  return 'en';
}

export function t(str: ILocalizedString): string {
  return str[getGameLocale()];
}
