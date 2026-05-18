import { buildLockedPointGuids, readInventoryCache } from '../../core/inventoryCache';
import { t } from '../../core/l10n';
import { showToast } from '../../core/toast';
import {
  applyPredicates,
  buildPredicates,
  countHiddenByDistance,
  countHiddenByLockMode,
  countHiddenByStar,
  type IDrawEntry,
} from './filterRules';
import { pluralizeLastRefs } from './lastRefsPluralize';
import { loadDrawingRestrictionsSettings, type LockProtectionMode } from './settings';
import { getStarCenterGuid } from './starCenter';

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

/**
 * Mode-aware фрагмент для бита lock в toast-сообщении. Подставляется и в
 * соло-формулировку, и в комбинации с star/distance. Английский: единая
 * терминология "locked points" для обоих режимов; русский: грамматика разная
 * (последние ключи vs N точек с замочком), поэтому возвращаем готовую пару.
 */
function lockPhrase(count: number, mode: LockProtectionMode): { ru: string; en: string } {
  if (mode === 'protectLastKey') {
    const refs = pluralizeLastRefs(count);
    return {
      ru: `${refs.ru} защищённых точек`,
      en: `${refs.en} of locked points`,
    };
  }
  // hideAllLocked: считаются все locked-точки независимо от amount.
  return {
    ru: `${count} точек с замочком`,
    en: `${count} locked points`,
  };
}

function lockMessage(hidden: number, mode: LockProtectionMode): string {
  const phrase = lockPhrase(hidden, mode);
  if (mode === 'protectLastKey' && hidden === 1) {
    return t({
      en: `Hidden ${phrase.en.replace(' of locked points', '')} from a locked point`,
      ru: `Скрыт ${phrase.ru.replace(' защищённых точек', '')} от защищённой точки`,
    });
  }
  return t({
    en: `Hidden: ${phrase.en}`,
    ru: `Скрыто: ${phrase.ru}`,
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

function starAndLockMessage(star: number, lock: number, mode: LockProtectionMode): string {
  const phrase = lockPhrase(lock, mode);
  return t({
    en: `Hidden: ${star} in star mode, ${phrase.en}`,
    ru: `Скрыто: ${star} в режиме "Звезда", ${phrase.ru}`,
  });
}

function distanceAndLockMessage(
  distance: number,
  lock: number,
  maxMeters: number,
  mode: LockProtectionMode,
): string {
  const phrase = lockPhrase(lock, mode);
  return t({
    en: `Hidden: ${distance} beyond ${maxMeters} m, ${phrase.en}`,
    ru: `Скрыто: ${distance} за ${maxMeters} м, ${phrase.ru}`,
  });
}

function allThreeMessage(totalHidden: number, mode: LockProtectionMode): string {
  if (mode === 'protectLastKey') {
    return t({
      en: `Points (${totalHidden}) hidden: star mode + distance + last-key protection`,
      ru: `Точки (${totalHidden}) скрыты: "Звезда" + дальность + защита последних ключей`,
    });
  }
  return t({
    en: `Points (${totalHidden}) hidden: star mode + distance + locked points`,
    ru: `Точки (${totalHidden}) скрыты: "Звезда" + дальность + точки с замочком`,
  });
}

interface IToastInputs {
  hiddenByStar: number;
  hiddenByDistance: number;
  hiddenByLock: number;
  totalHidden: number;
  maxDistanceMeters: number;
  lockProtectionMode: LockProtectionMode;
}

/**
 * Выбор единственного toast-сообщения по комбинации счётчиков (ровно один
 * showToast на response). Bitmask 3-битный s/d/lock: бит lock включает оба
 * режима защиты locked-точек (protectLastKey и hideAllLocked), формулировка
 * для бита lock зависит от lockProtectionMode (mode-aware wording через
 * lockPhrase / lockMessage).
 *
 * Матрица покрывает 7 ненулевых комбинаций + no-op при all-zero. Для
 * star+distance и all-three используется totalHidden (реально скрыто уникально
 * после AND-композиции предикатов); для комбинаций с lock - breakdown по
 * причинам, lock-скрытие подсчитывается отдельно от остальных.
 */
function pickToastMessage(inputs: IToastInputs): string | null {
  const s = inputs.hiddenByStar > 0 ? 1 : 0;
  const d = inputs.hiddenByDistance > 0 ? 1 : 0;
  const lock = inputs.hiddenByLock > 0 ? 1 : 0;
  const mask = (s << 2) | (d << 1) | lock;

  switch (mask) {
    case 0b000:
      return null;
    case 0b100:
      return starMessage(inputs.hiddenByStar);
    case 0b010:
      return distanceMessage(inputs.hiddenByDistance, inputs.maxDistanceMeters);
    case 0b001:
      return lockMessage(inputs.hiddenByLock, inputs.lockProtectionMode);
    case 0b110:
      return starAndDistanceMessage(inputs.totalHidden);
    case 0b101:
      return starAndLockMessage(
        inputs.hiddenByStar,
        inputs.hiddenByLock,
        inputs.lockProtectionMode,
      );
    case 0b011:
      return distanceAndLockMessage(
        inputs.hiddenByDistance,
        inputs.hiddenByLock,
        inputs.maxDistanceMeters,
        inputs.lockProtectionMode,
      );
    case 0b111:
      return allThreeMessage(inputs.totalHidden, inputs.lockProtectionMode);
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
  // Lock-флаг живёт на стопке (поле `f`, бит 0b10) в `inventory-cache`.
  // Перечитываем кэш на каждом ответе — чтобы фильтр сразу видел свежие
  // замочки/звёздочки, проставленные пользователем нативной кнопкой игры или
  // массовой миграцией из favoritesMigration.
  const lockedPoints = buildLockedPointGuids(readInventoryCache());
  const starCenterGuid = getStarCenterGuid();

  const predicates = buildPredicates({
    settings,
    lockedPoints,
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

  const message = pickToastMessage({
    hiddenByStar: countHiddenByStar(original, starCenterGuid, popupGuidAtRequest),
    hiddenByDistance: countHiddenByDistance(original, settings.maxDistanceMeters),
    hiddenByLock: countHiddenByLockMode(original, lockedPoints, settings.lockProtectionMode),
    totalHidden: original.length - parsed.data.length,
    maxDistanceMeters: settings.maxDistanceMeters,
    lockProtectionMode: settings.lockProtectionMode,
  });
  if (message !== null) showToast(message, 4000);

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
  return modified;
}

export function installDrawFilter(): void {
  drawFilterEnabled = true;
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
    return promise.then((response) => filterDrawResponse(response, popupGuidAtRequest));
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
}
