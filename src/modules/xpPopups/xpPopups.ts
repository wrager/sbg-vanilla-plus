import { injectStyles, removeStyles } from '../../core/dom';
import type { IFeatureModule } from '../../core/moduleRegistry';
import { createXpPopupLayer, destroyXpPopupLayer, showXpPopup } from './xpPopupLayer';
import { extractXpDiff } from './xpResponse';
import styles from './styles.css?inline';

const MODULE_ID = 'xpPopups';

/*
 * Действия, за которые начисляется опыт. Все они сходятся в handleExpChange
 * игры (refs/game/script.js:2776): изучение (:827), простановка и апгрейд ядра
 * (:947), зарядка из попапа точки (:959) и из инвентаря (:3021), атака (:1728),
 * рисование линии (:1801). Других источников опыта у клиента нет: /api/use
 * опыта не даёт (:1273-1300), а /api/profile отдаёт суммарный xp числом
 * (:3305), а не прирост.
 *
 * Якорь (?|$) не даёт совпасть более длинному пути.
 */
const XP_URL_PATTERN = /\/api\/(?:discover|deploy|attack2|draw|repair)(\?|$)/;

let xpHookEnabled = false;
let xpHookInstalled = false;
let originalFetchBeforePatch: typeof window.fetch | null = null;

function extractUrl(input: RequestInfo | URL): string | null {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  // Request: у него поле `url: string` в DOM lib; null - страховка для моков
  // в тестах, где может прийти неполный объект без url.
  return typeof input.url === 'string' ? input.url : null;
}

/**
 * Метод запроса в верхнем регистре. Игра шлёт действия строчным `'post'`
 * (apiSend, refs/game/script.js:3986), а запросы на чтение - строчным `'get'`
 * (apiQuery, :3961), поэтому сравнивать значение как есть нельзя.
 */
function extractMethod(input: RequestInfo | URL, init: RequestInit | undefined): string {
  if (typeof init?.method === 'string') return init.method.toUpperCase();
  if (typeof input !== 'string' && !(input instanceof URL) && typeof input.method === 'string') {
    return input.method.toUpperCase();
  }
  return 'GET';
}

/**
 * У /api/draw два разных смысла: POST рисует линию и приносит опыт, GET отдаёт
 * список возможных целей рисования (refs/game/script.js:1005) и опыта не
 * содержит. Разделяем по методу, а не по форме тела: метод - контракт, форма
 * тела - нет.
 */
function isXpBearingRequest(input: RequestInfo | URL, init: RequestInit | undefined): boolean {
  const url = extractUrl(input);
  if (url === null || !XP_URL_PATTERN.test(url)) return false;
  return extractMethod(input, init) === 'POST';
}

/**
 * Ставит monkey-patch на window.fetch один раз за жизнь страницы; переключение
 * поведения - через флаг `xpHookEnabled`, как в refsLayerSync и refsOnMap.
 *
 * Полностью снять патч на disable нельзя: модуль включается в блоке ui, то есть
 * раньше refsLayerSync, refsOnMap и drawingRestrictions, и восстановление
 * сохранённой ссылки выкинуло бы из цепочки их обёртки.
 *
 * `response.clone()` обязателен: игра читает то же тело в apiSend
 * (refs/game/script.js:4003), а тело одноразовое. Сам ответ не подменяется -
 * наружу уходит исходный промис.
 */
export function installXpFetchHook(): void {
  if (xpHookInstalled) return;
  xpHookInstalled = true;
  const originalFetch = window.fetch;
  originalFetchBeforePatch = originalFetch;
  window.fetch = function patchedFetch(
    this: typeof window,
    ...args: Parameters<typeof window.fetch>
  ): Promise<Response> {
    const responsePromise = originalFetch.apply(this, args);
    if (!xpHookEnabled) return responsePromise;
    if (!isXpBearingRequest(args[0], args[1])) return responsePromise;
    void responsePromise.then(
      async (response) => {
        if (!response.ok) return;
        if (!xpHookEnabled) return;
        const cloned = response.clone();
        let payload: unknown;
        try {
          payload = await cloned.json();
        } catch {
          // Не-JSON или оборванное тело - показывать нечего.
          return;
        }
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- xpHookEnabled мог смениться на disable, пока ждали json()
        if (!xpHookEnabled) return;
        const diff = extractXpDiff(payload);
        // Нулевой прирост игра за событие не считает и подпись не трогает
        // (refs/game/script.js:2768) - показывать его крупнее нативного тем
        // более незачем.
        if (diff === null || diff === 0) return;
        showXpPopup(diff);
      },
      () => {
        // Сетевой сбой - игре уже сообщено через rejection основного промиса.
      },
    );
    return responsePromise;
  };
}

/** Тестовый сброс глобального fetch-патча. Только для тестов. */
export function uninstallXpFetchHookForTest(): void {
  if (!xpHookInstalled) return;
  if (originalFetchBeforePatch) window.fetch = originalFetchBeforePatch;
  originalFetchBeforePatch = null;
  xpHookInstalled = false;
}

export const xpPopups: IFeatureModule = {
  id: MODULE_ID,
  name: {
    en: 'Floating EXP popups',
    ru: 'Всплывающий опыт',
  },
  description: {
    en: 'Shows gained experience as a floating value at the top center of the screen',
    ru: 'Показывает полученный опыт всплывающим значением по центру сверху',
  },
  defaultEnabled: true,
  category: 'ui',

  init() {},

  enable(): void {
    injectStyles(styles, MODULE_ID);
    createXpPopupLayer();
    installXpFetchHook();
    xpHookEnabled = true;
  },

  disable(): void {
    xpHookEnabled = false;
    destroyXpPopupLayer();
    removeStyles(MODULE_ID);
  },
};
