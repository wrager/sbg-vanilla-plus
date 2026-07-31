import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { installXpFetchHook, uninstallXpFetchHookForTest, xpPopups } from './xpPopups';
import { showXpPopup } from './xpPopupLayer';

/*
 * Слой рендера заменяется частично: showXpPopup нужен как шпион для проверки
 * перехвата, а createXpPopupLayer/destroyXpPopupLayer остаются настоящими -
 * блок про жизненный цикл проверяет реальные узлы в DOM.
 */
jest.mock('./xpPopupLayer', () => {
  const actual = jest.requireActual<typeof import('./xpPopupLayer')>('./xpPopupLayer');
  return { ...actual, showXpPopup: jest.fn() };
});

const mockShowXpPopup = jest.mocked(showXpPopup);

const LAYER_SELECTOR = '.svp-xp-popup-layer';
const STYLE_ID = 'svp-xpPopups';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function stubFetch(response: Response): void {
  window.fetch = () => Promise.resolve(response);
}

/** Даёт отработать then-цепочке перехватчика вместе с await cloned.json(). */
function flushAsync(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function callFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const response = await window.fetch(input, init);
  await flushAsync();
  return response;
}

let originalFetch: typeof window.fetch;

beforeEach(() => {
  originalFetch = window.fetch;
  mockShowXpPopup.mockClear();
  document.body.innerHTML = '';
});

afterEach(() => {
  void xpPopups.disable();
  uninstallXpFetchHookForTest();
  window.fetch = originalFetch;
  jest.restoreAllMocks();
});

function enableWithFetch(response: Response): void {
  stubFetch(response);
  void xpPopups.enable();
}

describe('опыт из ответов игровых действий', () => {
  test.each([
    ['изучение точки', '/api/discover', { loot: [], xp: { cur: 100, diff: 130 } }, 130],
    ['простановка ядра', '/api/deploy', { data: {}, xp: { cur: 200, diff: 24 } }, 24],
    ['апгрейд ядра', '/api/deploy', { c: {}, l: 3, xp: { cur: 300, diff: 12 } }, 12],
    ['атака', '/api/attack2', { c: [], l: [], r: [], xp: { cur: 400, diff: 305 } }, 305],
    ['рисование линии', '/api/draw', { line: { g: 1 }, xp: { cur: 500, diff: 313 } }, 313],
    // Зарядка идёт на один и тот же endpoint из двух мест игры: из попапа точки
    // (refs/game/script.js:952) и из списка ключей в инвентаре (:3013).
    [
      'зарядка из попапа точки',
      '/api/repair',
      { data: { co: [] }, xp: { cur: 600, diff: 65 } },
      65,
    ],
    ['зарядка из инвентаря', '/api/repair', { data: { co: [] }, xp: { cur: 700, diff: 40 } }, 40],
  ])('%s - попап с приростом', async (_name, url, body, expected) => {
    enableWithFetch(jsonResponse(body));

    await callFetch(url, { method: 'post' });

    expect(mockShowXpPopup).toHaveBeenCalledTimes(1);
    expect(mockShowXpPopup).toHaveBeenCalledWith(expected);
  });

  test('метод в верхнем регистре тоже распознаётся', async () => {
    enableWithFetch(jsonResponse({ xp: { cur: 1, diff: 5 } }));

    await callFetch('/api/discover', { method: 'POST' });

    expect(mockShowXpPopup).toHaveBeenCalledWith(5);
  });

  test('URL-объект вместо строки', async () => {
    enableWithFetch(jsonResponse({ xp: { cur: 1, diff: 7 } }));

    await callFetch(new URL('https://sbg-game.ru/api/repair'), { method: 'post' });

    expect(mockShowXpPopup).toHaveBeenCalledWith(7);
  });
});

describe('запросы без опыта', () => {
  test('GET /api/draw - это список целей рисования, а не начисление', async () => {
    enableWithFetch(jsonResponse({ data: [{ p: 'guid', d: 100 }] }));

    await callFetch('/api/draw?guid=point-a&position=1,2', { method: 'get' });

    expect(mockShowXpPopup).not.toHaveBeenCalled();
  });

  test('GET /api/draw отсекается по методу, а не по форме тела', async () => {
    enableWithFetch(jsonResponse({ xp: { cur: 1, diff: 9 } }));

    await callFetch('/api/draw?guid=point-a', { method: 'get' });

    expect(mockShowXpPopup).not.toHaveBeenCalled();
  });

  test('запрос без init - это GET по умолчанию', async () => {
    enableWithFetch(jsonResponse({ xp: { cur: 1, diff: 9 } }));

    await callFetch('/api/repair');

    expect(mockShowXpPopup).not.toHaveBeenCalled();
  });

  test('посторонний endpoint с похожим телом', async () => {
    enableWithFetch(jsonResponse({ xp: { cur: 1, diff: 9 } }));

    await callFetch('/api/inview', { method: 'post' });

    expect(mockShowXpPopup).not.toHaveBeenCalled();
  });

  test('POST /api/settings - его шлёт наш же inventoryCleanup', async () => {
    enableWithFetch(jsonResponse({ xp: { cur: 1, diff: 9 } }));

    await callFetch('/api/settings', { method: 'post' });

    expect(mockShowXpPopup).not.toHaveBeenCalled();
  });

  test('более длинный путь с тем же префиксом не совпадает', async () => {
    enableWithFetch(jsonResponse({ xp: { cur: 1, diff: 9 } }));

    await callFetch('/api/drawings', { method: 'post' });

    expect(mockShowXpPopup).not.toHaveBeenCalled();
  });
});

describe('ответ, из которого нечего показать', () => {
  test('ответ с ошибкой HTTP', async () => {
    enableWithFetch(jsonResponse({ xp: { cur: 1, diff: 9 } }, 500));

    await callFetch('/api/discover', { method: 'post' });

    expect(mockShowXpPopup).not.toHaveBeenCalled();
  });

  test('тело не разбирается как JSON', async () => {
    stubFetch(new Response('<html>gateway timeout</html>'));
    void xpPopups.enable();

    await callFetch('/api/discover', { method: 'post' });

    expect(mockShowXpPopup).not.toHaveBeenCalled();
  });

  test('в теле нет поля xp', async () => {
    enableWithFetch(jsonResponse({}));

    await callFetch('/api/discover', { method: 'post' });

    expect(mockShowXpPopup).not.toHaveBeenCalled();
  });

  test('игра вернула ошибку вместо данных', async () => {
    enableWithFetch(jsonResponse({ error: 'Точка вне зоны действия' }));

    await callFetch('/api/discover', { method: 'post' });

    expect(mockShowXpPopup).not.toHaveBeenCalled();
  });

  test('нулевой прирост', async () => {
    enableWithFetch(jsonResponse({ xp: { cur: 10, diff: 0 } }));

    await callFetch('/api/discover', { method: 'post' });

    expect(mockShowXpPopup).not.toHaveBeenCalled();
  });

  test('сетевой сбой - отказ уходит вызывающему, попапа нет', async () => {
    window.fetch = () => Promise.reject(new Error('network down'));
    void xpPopups.enable();

    await expect(window.fetch('/api/discover', { method: 'post' })).rejects.toThrow('network down');
    await flushAsync();

    expect(mockShowXpPopup).not.toHaveBeenCalled();
  });
});

describe('ответ игре не портится', () => {
  test('наружу уходит тот же объект, тело читается ровно одним клоном', async () => {
    const response = jsonResponse({ xp: { cur: 1, diff: 42 } });
    const cloneSpy = jest.spyOn(response, 'clone');
    enableWithFetch(response);

    const returned = await callFetch('/api/discover', { method: 'post' });

    expect(returned).toBe(response);
    expect(cloneSpy).toHaveBeenCalledTimes(1);
    expect(mockShowXpPopup).toHaveBeenCalledWith(42);
  });
});

describe('выключение во время запроса', () => {
  test('disable до того, как пришёл ответ', async () => {
    enableWithFetch(jsonResponse({ xp: { cur: 1, diff: 9 } }));

    const pending = window.fetch('/api/discover', { method: 'post' });
    void xpPopups.disable();
    await pending;
    await flushAsync();

    expect(mockShowXpPopup).not.toHaveBeenCalled();
  });

  test('disable, пока читается тело ответа', async () => {
    const response = jsonResponse({ xp: { cur: 1, diff: 9 } });
    const cloned = jsonResponse({ xp: { cur: 1, diff: 9 } });
    let releaseBody: () => void = () => undefined;
    const bodyRead = new Promise<unknown>((resolve) => {
      releaseBody = () => {
        resolve({ xp: { cur: 1, diff: 9 } });
      };
    });
    jest.spyOn(cloned, 'json').mockReturnValue(bodyRead);
    jest.spyOn(response, 'clone').mockReturnValue(cloned);
    enableWithFetch(response);

    await window.fetch('/api/discover', { method: 'post' });
    await flushAsync();
    // Ответ уже пришёл, тело ещё читается - игрок выключает модуль.
    void xpPopups.disable();
    releaseBody();
    await flushAsync();

    expect(mockShowXpPopup).not.toHaveBeenCalled();
  });

  test('перехват стоит, но модуль не включён', async () => {
    stubFetch(jsonResponse({ xp: { cur: 1, diff: 9 } }));
    installXpFetchHook();

    await callFetch('/api/discover', { method: 'post' });

    expect(mockShowXpPopup).not.toHaveBeenCalled();
  });
});

describe('жизненный цикл', () => {
  test('init ничего не ставит', () => {
    const fetchBefore = window.fetch;

    void xpPopups.init();

    expect(window.fetch).toBe(fetchBefore);
    expect(document.querySelector(LAYER_SELECTOR)).toBeNull();
  });

  test('enable ставит перехват, стиль и слой', () => {
    const fetchBefore = window.fetch;

    void xpPopups.enable();

    expect(window.fetch).not.toBe(fetchBefore);
    expect(document.getElementById(STYLE_ID)).not.toBeNull();
    expect(document.querySelector(LAYER_SELECTOR)).not.toBeNull();
  });

  test('повторный enable не пересобирает обёртку fetch', () => {
    void xpPopups.enable();
    const patchedFetch = window.fetch;

    void xpPopups.disable();
    void xpPopups.enable();

    expect(window.fetch).toBe(patchedFetch);
  });

  test('disable убирает стиль и слой', () => {
    void xpPopups.enable();

    void xpPopups.disable();

    expect(document.getElementById(STYLE_ID)).toBeNull();
    expect(document.querySelector(LAYER_SELECTOR)).toBeNull();
  });

  test('три цикла enable/disable не плодят стили и слои', () => {
    for (let cycle = 0; cycle < 3; cycle++) {
      void xpPopups.enable();
      expect(document.querySelectorAll(LAYER_SELECTOR)).toHaveLength(1);
      expect(document.querySelectorAll(`#${STYLE_ID}`)).toHaveLength(1);
      void xpPopups.disable();
    }

    expect(document.querySelectorAll(LAYER_SELECTOR)).toHaveLength(0);
    expect(document.querySelectorAll(`#${STYLE_ID}`)).toHaveLength(0);
  });
});

/*
 * Инжект стилей проверить нельзя: jest подменяет `*.css?inline` пустой строкой
 * (src/__mocks__/cssMock.ts), поэтому файл читается с диска и разбирается
 * браузерным парсером - как в enhancedPointPopupUi.test.ts.
 */
describe('styles.css', () => {
  function cssRules(): CSSRule[] {
    const style = document.createElement('style');
    style.textContent = readFileSync(join(__dirname, 'styles.css'), 'utf8');
    document.head.appendChild(style);
    const sheet = style.sheet;
    if (!sheet) throw new Error('styles.css не разобрался в CSSOM');
    return Array.from(sheet.cssRules);
  }

  function styleRules(): CSSStyleRule[] {
    return cssRules().filter((rule): rule is CSSStyleRule => 'selectorText' in rule);
  }

  function ruleFor(selector: string): CSSStyleRule {
    const rule = styleRules().find((candidate) => candidate.selectorText === selector);
    if (!rule) throw new Error(`Правило ${selector} не найдено в styles.css`);
    return rule;
  }

  test('нативная подпись прироста скрыта и переживает любую специфичность игры', () => {
    const rule = ruleFor('.xp-diff');

    expect(rule.style.getPropertyValue('visibility')).toBe('hidden');
    expect(rule.style.getPropertyPriority('visibility')).toBe('important');
  });

  test('слой не перехватывает тапы и не участвует в раскладке игры', () => {
    const rule = ruleFor('.svp-xp-popup-layer');

    expect(rule.style.getPropertyValue('pointer-events')).toBe('none');
    expect(rule.style.getPropertyValue('position')).toBe('fixed');
  });

  test('длительность анимации приходит из кода, второго числа в CSS нет', () => {
    const rule = ruleFor('.svp-xp-popup');

    expect(rule.style.getPropertyValue('animation')).toContain('var(--svp-xp-popup-duration');
  });

  // Анимировать что-то кроме transform и opacity значит вернуть layout и paint
  // в каждый кадр всплытия - ровно ту цену, ради ухода от которой слой сделан
  // непотоковым.
  test('кадры трогают только composited-свойства', () => {
    const isKeyframesRule = (rule: CSSRule): rule is CSSKeyframesRule =>
      'name' in rule && 'cssRules' in rule;
    const isKeyframeRule = (rule: CSSRule): rule is CSSKeyframeRule =>
      'keyText' in rule && 'style' in rule;

    const keyframes = cssRules().find(isKeyframesRule);
    if (!keyframes) throw new Error('@keyframes не найден в styles.css');

    const animated = new Set<string>();
    for (const frame of Array.from(keyframes.cssRules).filter(isKeyframeRule)) {
      for (let index = 0; index < frame.style.length; index++) animated.add(frame.style[index]);
    }

    expect(animated).toEqual(new Set(['transform', 'opacity']));
  });
});

describe('метаданные', () => {
  test('id, категория, дефолт и локализованные тексты', () => {
    expect(xpPopups.id).toBe('xpPopups');
    expect(xpPopups.category).toBe('ui');
    expect(xpPopups.defaultEnabled).toBe(true);
    expect(xpPopups.name.ru).toBeTruthy();
    expect(xpPopups.name.en).toBeTruthy();
    expect(xpPopups.description.ru).toBeTruthy();
    expect(xpPopups.description.en).toBeTruthy();
  });
});
