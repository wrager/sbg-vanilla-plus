import { t } from '../../core/l10n';
import { showToast } from '../../core/toast';
import {
  applyPredicates,
  buildPredicates,
  countHiddenByDistance,
  countHiddenByStar,
  type IDrawEntry,
} from './filterRules';
import { MODULE_ID } from './moduleId';
import { loadDrawingRestrictionsSettings } from './settings';
import { getActiveStarCenterGuid } from './starCenter';

const POPUP_SELECTOR = '.info.popup';

const DRAW_URL_PATTERN = /\/api\/draw(?:\?|$)/;

interface IDrawResponseShape {
  data: IDrawEntry[];
}

// Persistent fetch-wrapper: ставится один раз за жизнь страницы и больше не
// снимается. uninstall переводит флаг enabled в false; сам wrapper остаётся в
// цепочке window.fetch. Иначе при последующей обёртке другого модуля (например,
// refsLayerSync, который оборачивает текущий window.fetch как originalFetch),
// наш uninstall, восстанавливающий native fetch, выкидывал бы из цепочки и
// чужие обёртки, поставленные после нашего install. Семантика "снять только
// своё, не трогать чужое" возможна только через persistent wrapper + флаг.
let fetchInstalled = false;
let drawFilterEnabled = false;
let originalFetchBeforePatch: typeof window.fetch | null = null;
let filterFailureReported = false;

function matchesDrawList(url: string, method: string | undefined): boolean {
  if (!DRAW_URL_PATTERN.test(url)) return false;
  const m = (method ?? 'GET').toUpperCase();
  return m === 'GET';
}

function getUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function getMethod(input: RequestInfo | URL, init: RequestInit | undefined): string | undefined {
  if (init?.method) return init.method;
  if (typeof input !== 'string' && !(input instanceof URL)) return input.method;
  return undefined;
}

function isDrawResponseShape(value: unknown): value is IDrawResponseShape {
  return (
    typeof value === 'object' && value !== null && 'data' in value && Array.isArray(value.data)
  );
}

function starMessage(hidden: number): string {
  return t({
    en: `Points (${hidden}) hidden: star mode`,
    ru: `Точки (${hidden}) скрыты: режим "Звезда"`,
  });
}

function distanceMessage(hidden: number, maxMeters: number): string {
  return t({
    en: `Points (${hidden}) hidden: distance limit (max ${maxMeters} m)`,
    ru: `Точки (${hidden}) скрыты: ограничение дальности (макс. ${maxMeters} м)`,
  });
}

function starAndDistanceMessage(totalHidden: number): string {
  return t({
    en: `Points (${totalHidden}) hidden: star mode + distance limit`,
    ru: `Точки (${totalHidden}) скрыты: режим "Звезда" + ограничение дальности`,
  });
}

interface IToastInputs {
  hiddenByStar: number;
  hiddenByDistance: number;
  totalHidden: number;
  maxDistanceMeters: number;
}

/**
 * Выбор единственного toast-сообщения по комбинации счётчиков (ровно один
 * showToast на response). Bitmask 2-битный s/d. Для star+distance используется
 * totalHidden (реально скрыто уникально после AND-композиции предикатов).
 */
function pickToastMessage(inputs: IToastInputs): string | null {
  const s = inputs.hiddenByStar > 0 ? 1 : 0;
  const d = inputs.hiddenByDistance > 0 ? 1 : 0;
  const mask = (s << 1) | d;

  switch (mask) {
    case 0b00:
      return null;
    case 0b10:
      return starMessage(inputs.hiddenByStar);
    case 0b01:
      return distanceMessage(inputs.hiddenByDistance, inputs.maxDistanceMeters);
    case 0b11:
      return starAndDistanceMessage(inputs.totalHidden);
    default:
      return null;
  }
}

/**
 * GUID точки в открытом попапе на момент вызова, либо null если попап
 * отсутствует / скрыт через класс `.hidden` / без `data-guid`. Используется и
 * для drawFilter (определить открытую точку в момент /api/draw), и для
 * starCenterRefresh (решить, нужно ли перезапросить /api/draw после изменения
 * центра звезды). Селектор `.info.popup` един для обоих случаев.
 */
export function getCurrentPopupGuid(): string | null {
  const popup = document.querySelector(POPUP_SELECTOR);
  if (!popup || !(popup instanceof HTMLElement)) return null;
  if (popup.classList.contains('hidden')) return null;
  const guid = popup.dataset.guid;
  return guid && guid.length > 0 ? guid : null;
}

async function filterDrawResponse(
  response: Response,
  popupGuidAtRequest: string | null,
): Promise<Response> {
  const settings = loadDrawingRestrictionsSettings();
  // getActiveStarCenterGuid возвращает null при выключенном режиме -
  // фильтр звезды не применяется к /api/draw, пользователь видит все цели.
  const starCenterGuid = getActiveStarCenterGuid();

  const predicates = buildPredicates({
    settings,
    starCenterGuid,
    currentPopupGuid: popupGuidAtRequest,
  });
  if (predicates.length === 0) return response;

  let parsed: unknown;
  try {
    parsed = (await response.clone().json()) as unknown;
  } catch {
    return response;
  }

  if (!isDrawResponseShape(parsed)) return response;

  const original = parsed.data;
  parsed.data = applyPredicates(original, predicates);

  // Headers оригинала копируем без content-length: после фильтрации длина body
  // меняется, и заголовок становится несоответствующим реальному размеру.
  // Игровой код по чтению refs/game/script.js его на draw-response не проверяет,
  // но формально ложный заголовок - inconsistency, и сторонние user-script'ы
  // могут на него опираться.
  const newHeaders = new Headers(response.headers);
  newHeaders.delete('content-length');
  const modified = new Response(JSON.stringify(parsed), {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders,
  });
  // Response.url - read-only, не передаётся через init. Восстанавливаем через
  // defineProperty, чтобы игровой код, проверяющий response.url, не сломался.
  Object.defineProperty(modified, 'url', { value: response.url });

  // Тост показывается последним шагом, когда отфильтрованный ответ уже собран:
  // иначе отказ на сборке оставил бы игроку сообщение о скрытых точках при
  // полном списке целей на карте.
  const message = pickToastMessage({
    hiddenByStar: countHiddenByStar(original, starCenterGuid, popupGuidAtRequest),
    hiddenByDistance: countHiddenByDistance(original, settings.maxDistanceMeters),
    totalHidden: original.length - parsed.data.length,
    maxDistanceMeters: settings.maxDistanceMeters,
  });
  if (message !== null) showToast(message, { duration: 4000 });

  return modified;
}

/**
 * Разбор ответа читает данные сервера, поэтому смена их формата отклонила бы
 * промис, который игра ждёт от своего fetch. Вместо этого игре уходит
 * неотфильтрованный ответ сервера. Запись делается один раз за включение
 * модуля: /api/draw приходит на каждое открытие попапа, и повтор вытеснил бы
 * полезные строки из core/errorLog (там хранятся последние 50).
 */
function reportFilterFailure(error: unknown): void {
  if (filterFailureReported) return;
  filterFailureReported = true;
  console.error(`[SVP ${MODULE_ID}] цели рисования не отфильтрованы:`, error);
}

export function installDrawFilter(): void {
  drawFilterEnabled = true;
  filterFailureReported = false;
  if (fetchInstalled) return;
  fetchInstalled = true;
  const native = window.fetch;
  originalFetchBeforePatch = native;
  window.fetch = function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const promise = native.call(this, input, init);
    if (!drawFilterEnabled) return promise;
    const url = getUrl(input);
    const method = getMethod(input, init);
    if (!matchesDrawList(url, method)) return promise;
    // Контекст попапа снапшотится В МОМЕНТ запроса, не на момент resolve'а
    // ответа. Иначе при быстрой смене попапа (запрос ушёл из A, ответ пришёл
    // когда уже открыт B) фильтр применит правила B к данным A, попап получит
    // отфильтрованный список для чужого контекста.
    const popupGuidAtRequest = getCurrentPopupGuid();
    return promise.then((response) =>
      // catch навешен на фильтр, а не на всю цепочку: сетевой сбой самого
      // запроса игра должна получить как есть.
      filterDrawResponse(response, popupGuidAtRequest).catch((error: unknown) => {
        reportFilterFailure(error);
        return response;
      }),
    );
  };
}

export function uninstallDrawFilter(): void {
  drawFilterEnabled = false;
}

/** Тестовый сброс persistent fetch-патча. Только для тестов. */
export function uninstallDrawFilterForTest(): void {
  if (!fetchInstalled) return;
  if (originalFetchBeforePatch) window.fetch = originalFetchBeforePatch;
  originalFetchBeforePatch = null;
  fetchInstalled = false;
  drawFilterEnabled = false;
  filterFailureReported = false;
}
