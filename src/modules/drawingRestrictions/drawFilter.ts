import { buildLockedPointGuids, readInventoryCache } from '../../core/inventoryCache';
import { t } from '../../core/l10n';
import { showToast } from '../../core/toast';
import {
  applyPredicates,
  buildPredicates,
  countHiddenByDistance,
  countHiddenByLastKey,
  countHiddenByStar,
  type IDrawEntry,
} from './filterRules';
import { pluralizeLastRefs } from './lastRefsPluralize';
import { loadDrawingRestrictionsSettings } from './settings';
import { getStarCenterGuid } from './starCenter';

const POPUP_SELECTOR = '.info.popup';

const DRAW_URL_PATTERN = /\/api\/draw(?:\?|$)/;

interface IDrawResponseShape {
  data: IDrawEntry[];
}

let originalFetch: typeof window.fetch | null = null;

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

function lastKeyMessage(hidden: number): string {
  const phrase = pluralizeLastRefs(hidden);
  if (hidden === 1) {
    return t({
      en: `Hidden ${phrase.en} from a locked point`,
      ru: `Скрыт ${phrase.ru} от защищённой точки`,
    });
  }
  return t({
    en: `Hidden ${phrase.en} from locked points`,
    ru: `Скрыты ${phrase.ru} от защищённых точек`,
  });
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

function starAndLastKeyMessage(star: number, lastKey: number): string {
  const phrase = pluralizeLastRefs(lastKey);
  return t({
    en: `Hidden: ${star} in star mode, ${phrase.en} of locked points`,
    ru: `Скрыто: ${star} в режиме "Звезда", ${phrase.ru} защищённых точек`,
  });
}

function distanceAndLastKeyMessage(distance: number, lastKey: number, maxMeters: number): string {
  const phrase = pluralizeLastRefs(lastKey);
  return t({
    en: `Hidden: ${distance} beyond ${maxMeters} m, ${phrase.en} of locked points`,
    ru: `Скрыто: ${distance} за ${maxMeters} м, ${phrase.ru} защищённых точек`,
  });
}

function allThreeMessage(totalHidden: number): string {
  return t({
    en: `Points (${totalHidden}) hidden: star mode + distance + last-key protection`,
    ru: `Точки (${totalHidden}) скрыты: "Звезда" + дальность + защита последних ключей`,
  });
}

interface IToastInputs {
  hiddenByStar: number;
  hiddenByDistance: number;
  hiddenByLastKey: number;
  totalHidden: number;
  maxDistanceMeters: number;
}

/**
 * Выбор единственного toast-сообщения по комбинации счётчиков (ровно один
 * showToast на response). Матрица покрывает 7 ненулевых комбинаций + no-op
 * при all-zero. Логика: каждый counter > 0 — отдельная причина, мы объединяем
 * названия активных причин; для star+distance и all-three используется
 * totalHidden (реально скрыто уникально после AND-композиции предикатов),
 * для комбинаций с lastKey — breakdown по причинам (lastKey-скрытие всегда
 * отдельно подсчитывается и не пересекается семантически с остальными).
 */
function pickToastMessage(inputs: IToastInputs): string | null {
  const s = inputs.hiddenByStar > 0 ? 1 : 0;
  const d = inputs.hiddenByDistance > 0 ? 1 : 0;
  const k = inputs.hiddenByLastKey > 0 ? 1 : 0;
  const mask = (s << 2) | (d << 1) | k;

  switch (mask) {
    case 0b000:
      return null;
    case 0b100:
      return starMessage(inputs.hiddenByStar);
    case 0b010:
      return distanceMessage(inputs.hiddenByDistance, inputs.maxDistanceMeters);
    case 0b001:
      return lastKeyMessage(inputs.hiddenByLastKey);
    case 0b110:
      return starAndDistanceMessage(inputs.totalHidden);
    case 0b101:
      return starAndLastKeyMessage(inputs.hiddenByStar, inputs.hiddenByLastKey);
    case 0b011:
      return distanceAndLastKeyMessage(
        inputs.hiddenByDistance,
        inputs.hiddenByLastKey,
        inputs.maxDistanceMeters,
      );
    case 0b111:
      return allThreeMessage(inputs.totalHidden);
    default:
      return null;
  }
}

function getCurrentPopupGuid(): string | null {
  const popup = document.querySelector(POPUP_SELECTOR);
  if (!popup || !(popup instanceof HTMLElement)) return null;
  if (popup.classList.contains('hidden')) return null;
  const guid = popup.dataset.guid;
  return guid && guid.length > 0 ? guid : null;
}

async function filterDrawResponse(response: Response): Promise<Response> {
  const settings = loadDrawingRestrictionsSettings();
  // Lock-флаг живёт на стопке (поле `f`, бит 0b10) в `inventory-cache`.
  // Перечитываем кэш на каждом ответе — чтобы фильтр сразу видел свежие
  // замочки/звёздочки, проставленные пользователем нативной кнопкой игры или
  // массовой миграцией из favoritesMigration.
  const lockedPoints = buildLockedPointGuids(readInventoryCache());
  const starCenterGuid = getStarCenterGuid();
  const currentPopupGuid = getCurrentPopupGuid();

  const predicates = buildPredicates({
    settings,
    lockedPoints,
    starCenterGuid,
    currentPopupGuid,
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

  const message = pickToastMessage({
    hiddenByStar: countHiddenByStar(original, starCenterGuid, currentPopupGuid),
    hiddenByDistance: countHiddenByDistance(original, settings.maxDistanceMeters),
    hiddenByLastKey: countHiddenByLastKey(original, lockedPoints, settings.favProtectionMode),
    totalHidden: original.length - parsed.data.length,
    maxDistanceMeters: settings.maxDistanceMeters,
  });
  if (message !== null) showToast(message, 4000);

  const modified = new Response(JSON.stringify(parsed), {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
  // Response.url — read-only, не передаётся через init. Восстанавливаем через
  // defineProperty, чтобы игровой код, проверяющий response.url, не сломался.
  Object.defineProperty(modified, 'url', { value: response.url });
  return modified;
}

export function installDrawFilter(): void {
  if (originalFetch) return;
  originalFetch = window.fetch;
  const native = originalFetch;
  window.fetch = function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url = getUrl(input);
    const method = getMethod(input, init);
    const promise = native.call(this, input, init);
    if (!matchesDrawList(url, method)) return promise;
    return promise.then((response) => filterDrawResponse(response));
  };
}

export function uninstallDrawFilter(): void {
  if (!originalFetch) return;
  window.fetch = originalFetch;
  originalFetch = null;
}
