import { shortenRegionsText } from './regionsLine';

/**
 * Шаблоны взяты дословно из переводов игры (refs/game/i18n/{ru,en}.json,
 * ключи popups.new-regions и info.regions). Плюральных форм у ключа нет,
 * поэтому на язык приходится ровно один шаблон.
 */
const GAME_RESOURCES: Record<string, Record<string, string> | undefined> = {
  ru: {
    'popups.new-regions':
      'Новые регионы: {{count}}<br>Общая площадь: {{area}}<br>Макс. площадь: {{max}}',
    'info.regions': 'Регионы',
  },
  en: {
    'popups.new-regions': 'New regions: {{count}}<br>Total area: {{area}}<br>Max area: {{max}}',
    'info.regions': 'Regions',
  },
};

function setupGameI18n(language: string): void {
  const globals = window as unknown as Record<string, unknown>;
  globals['i18next'] = {
    language,
    resolvedLanguage: language,
    t: (key: string) => GAME_RESOURCES[language]?.[key] ?? key,
    getResource: (lng: string, _namespace: string, key: string) => GAME_RESOURCES[lng]?.[key],
  };
}

function removeGameI18n(): void {
  const globals = window as unknown as Record<string, unknown>;
  delete globals['i18next'];
}

describe('shortenRegionsText', () => {
  afterEach(() => {
    removeGameI18n();
  });

  test('сворачивает русский тост про регионы в одну строку', () => {
    setupGameI18n('ru');

    const result = shortenRegionsText(
      'Новые регионы: 3<br>Общая площадь: 1.4 км²<br>Макс. площадь: 0.7 км²',
    );

    expect(result).toBe('Регионы: +3 (1.4 км²)');
  });

  test('сворачивает английский тост словами игры', () => {
    setupGameI18n('en');

    const result = shortenRegionsText('New regions: 3<br>Total area: 1.4 km²<br>Max area: 0.7 km²');

    expect(result).toBe('Regions: +3 (1.4 km²)');
  });

  test('один регион не требует особой формы: у ключа нет плюрализации', () => {
    setupGameI18n('ru');

    const result = shortenRegionsText(
      'Новые регионы: 1<br>Общая площадь: 120 м²<br>Макс. площадь: 120 м²',
    );

    expect(result).toBe('Регионы: +1 (120 м²)');
  });

  test('площадь подставляется как есть, без пересчёта единиц', () => {
    setupGameI18n('ru');

    const result = shortenRegionsText(
      'Новые регионы: 2<br>Общая площадь: 940.5 м²<br>Макс. площадь: 600 м²',
    );

    expect(result).toBe('Регионы: +2 (940.5 м²)');
  });

  test('чужой текст возвращается целиком, а не обрезается', () => {
    setupGameI18n('ru');

    const text = 'Недостаточно ключей для рисования линии от этой точки к выбранной цели';

    expect(shortenRegionsText(text)).toBe(text);
  });

  test('без i18next игры текст не трогается', () => {
    removeGameI18n();

    const text = 'Новые регионы: 3<br>Общая площадь: 1.4 км²<br>Макс. площадь: 0.7 км²';

    expect(shortenRegionsText(text)).toBe(text);
  });

  test('смена языка игры перестраивает шаблон', () => {
    setupGameI18n('ru');
    expect(
      shortenRegionsText('Новые регионы: 3<br>Общая площадь: 1.4 км²<br>Макс. площадь: 0.7 км²'),
    ).toBe('Регионы: +3 (1.4 км²)');

    setupGameI18n('en');
    expect(shortenRegionsText('New regions: 2<br>Total area: 1 km²<br>Max area: 1 km²')).toBe(
      'Regions: +2 (1 km²)',
    );
  });

  test('текст на другом языке под текущий шаблон не подходит', () => {
    setupGameI18n('ru');

    const text = 'New regions: 3<br>Total area: 1.4 km²<br>Max area: 0.7 km²';

    expect(shortenRegionsText(text)).toBe(text);
  });

  test('неизвестный игре ключ подписи оставляет текст как есть', () => {
    const globals = window as unknown as Record<string, unknown>;
    globals['i18next'] = {
      language: 'ru',
      resolvedLanguage: 'ru',
      // i18next на отсутствующем ключе возвращает сам ключ - подставлять его
      // игроку в подпись нельзя.
      t: (key: string) => key,
      getResource: (lng: string, _namespace: string, key: string) => GAME_RESOURCES[lng]?.[key],
    };

    const text = 'Новые регионы: 3<br>Общая площадь: 1.4 км²<br>Макс. площадь: 0.7 км²';

    expect(shortenRegionsText(text)).toBe(text);
  });
});
