export type ILocale = 'en' | 'ru';

export interface ILocalizedString {
  en: string;
  ru: string;
}

export function getGameLocale(): ILocale {
  try {
    const raw = localStorage.getItem('settings');
    if (raw) {
      const parsed = JSON.parse(raw) as { lang?: string };
      if (parsed.lang === 'ru') return 'ru';
    }
  } catch {
    // ignore parse errors
  }
  return 'en';
}

export function t(str: ILocalizedString): string {
  return str[getGameLocale()];
}
