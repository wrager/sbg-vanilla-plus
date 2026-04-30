import type { IFeatureModule } from '../../core/moduleRegistry';
import { findLayerByName, getOlMap } from '../../core/olMap';
import type { IOlFeature, IOlVectorSource } from '../../core/olMap';

const MODULE_ID = 'fixRedrawRefsOnDiscover';

// Канал references в маске Text-слоя. Совпадает с option value="7" в
// refs/game/index.html:289 и case 7 в FeatureStyles.LIGHT renderer
// (refs/game/script.js:374-377). Сервер кладёт сюда количество ключей
// игрока на эту точку в момент /api/inview ответа; игра не обновляет
// значение при последующих изменениях инвентаря (discover, удаление,
// recycle), поэтому подпись остаётся stale до следующего drawEntities
// (move >30 м или 5-минутный таймер).
const REFS_CHANNEL_INDEX = 7;
const DISCOVER_URL_PATTERN = /\/api\/discover(\?|$)/;
const REF_ITEM_TYPE = 3;
// Задержка перед применением нашего gain. За это время игра (или другой
// скрипт) успевает отработать свой continuation после `await fetch`.
// Если highlight[REFS_CHANNEL_INDEX] изменился между response и проверкой,
// кто-то уже обновил значение - наш fix не нужен и не должен дублировать
// gain. Когда разработчик игры исправит баг (обновит highlight[7] и
// вызовет feature.changed() после discover), наш модуль автоматически
// станет no-op.
const DETECTION_DELAY_MS = 100;

let pointsSource: IOlVectorSource | null = null;
// installGeneration защищает от race условий между async enable и быстрым
// disable. enable содержит await getOlMap() - если disable отработал во время
// await, выходим из enable до записи pointsSource, иначе ссылка на удалённый
// слой осталась бы вечно.
let installGeneration = 0;
let discoverHookEnabled = false;

let discoverFetchInstalled = false;
let originalFetchBeforePatch: typeof window.fetch | null = null;

interface IDiscoverLootItem {
  t?: number;
  l?: string;
  a?: number;
}

interface IDiscoverResponseShape {
  loot?: IDiscoverLootItem[];
}

function isDiscoverResponseShape(value: unknown): value is IDiscoverResponseShape {
  return typeof value === 'object' && value !== null;
}

/**
 * Считает суммарный прирост ключей конкретной точки из массива loot ответа
 * `/api/discover`. Server возвращает body напрямую `{loot, remaining, next, xp}`
 * без обёртки `{response: {...}}` (apiSend в refs/game/script.js:3675-3711
 * парсит body через `request.json()` и присваивает в локальную response,
 * но это уже обёртка apiSend для consumers - на уровне fetch.json() body
 * имеет ключи loot/remaining/next/xp).
 *
 * Refs - элементы с `t === 3` и `l === guid дискаверенной точки`. Тот же
 * предикат, что игра в refs/game/script.js:816 при обновлении inventory-cache.
 */
export function computeRefsGainFromDiscover(body: unknown, targetGuid: string): number {
  if (!isDiscoverResponseShape(body)) return 0;
  const loot = body.loot;
  if (!Array.isArray(loot)) return 0;
  let gain = 0;
  for (const item of loot) {
    if (item.t !== REF_ITEM_TYPE) continue;
    if (item.l !== targetGuid) continue;
    if (typeof item.a !== 'number') continue;
    gain += item.a;
  }
  return gain;
}

/**
 * Извлекает guid целевой точки из RequestInit body. /api/discover - POST
 * с JSON-payload `{position, guid, wish}` (refs/game/script.js:797-801).
 * Возвращает null, если body отсутствует, не строка, не парсится или не
 * содержит guid.
 */
function extractDiscoverGuidFromInit(init: RequestInit | undefined): string | null {
  const body = init?.body;
  if (typeof body !== 'string') return null;
  try {
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed === 'object' && parsed !== null && 'guid' in parsed) {
      const guid = (parsed as { guid: unknown }).guid;
      if (typeof guid === 'string') return guid;
    }
  } catch {
    // невалидный JSON - не наш случай.
  }
  return null;
}

function extractUrl(input: RequestInfo | URL): string | null {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  // Request: у него поле `url: string` в DOM lib; null - страховка для моков
  // в тестах, где может прийти неполный объект без url.
  return typeof input.url === 'string' ? input.url : null;
}

function readRefsChannelValue(feature: IOlFeature): number | null {
  if (typeof feature.get !== 'function') return null;
  const highlight = feature.get('highlight');
  if (!Array.isArray(highlight)) return null;
  const value: unknown = highlight[REFS_CHANNEL_INDEX];
  return typeof value === 'number' ? value : 0;
}

/**
 * Применяет refsGain к feature: in-place мутация массива highlight по
 * индексу REFS_CHANNEL_INDEX. LIGHT-стиль закрыт closure'ом над тем же
 * массивом (refs/game/script.js:269-270, 303), поэтому изменение по reference
 * читается следующим вызовом renderer'а (как нативного 32px, так и нашего
 * wrapped в improvedPointText - оба читают values[7] из той же ссылки).
 * feature.changed() инвалидирует execution plan layer'а и запускает ререндер.
 *
 * Если highlight отсутствует или не массив - игнорируем: точка нарисована
 * без LIGHT-стиля (или ещё не получила prop через setProperties).
 */
export function applyRefsGainToFeature(feature: IOlFeature, gain: number): void {
  if (gain <= 0) return;
  if (typeof feature.get !== 'function') return;
  const highlight = feature.get('highlight');
  if (!Array.isArray(highlight)) return;
  const current =
    typeof highlight[REFS_CHANNEL_INDEX] === 'number' ? highlight[REFS_CHANNEL_INDEX] : 0;
  highlight[REFS_CHANNEL_INDEX] = current + gain;
  if (typeof feature.changed === 'function') feature.changed();
}

function scheduleApplyRefsGain(targetGuid: string, gain: number, beforeValue: number): void {
  setTimeout(() => {
    if (!discoverHookEnabled) return;
    if (!pointsSource) return;
    const feature =
      typeof pointsSource.getFeatureById === 'function'
        ? pointsSource.getFeatureById(targetGuid)
        : null;
    if (!feature) return;
    const currentValue = readRefsChannelValue(feature);
    if (currentValue === null) return;
    // Forward-compat защита: если за DETECTION_DELAY_MS значение
    // highlight[REFS_CHANNEL_INDEX] изменилось, его уже обновил кто-то
    // другой - сама игра (когда исправит баг), другой скрипт-фиксер,
    // или вызов feature.changed() с новой prop.highlight ссылкой через
    // showInfo/attack-response. Дублировать gain нельзя - игрок увидит
    // удвоенное значение на карте. Skip и доверяем внешнему обновлению.
    if (currentValue !== beforeValue) return;
    applyRefsGainToFeature(feature, gain);
  }, DETECTION_DELAY_MS);
}

function handleDiscoverResponse(response: Response, targetGuid: string): void {
  if (!response.ok) return;
  if (!pointsSource) return;
  response
    .clone()
    .json()
    .then((body: unknown) => {
      if (!discoverHookEnabled) return;
      if (!pointsSource) return;
      const gain = computeRefsGainFromDiscover(body, targetGuid);
      if (gain <= 0) return;
      const feature =
        typeof pointsSource.getFeatureById === 'function'
          ? pointsSource.getFeatureById(targetGuid)
          : null;
      if (!feature) return;
      const beforeValue = readRefsChannelValue(feature);
      if (beforeValue === null) return;
      scheduleApplyRefsGain(targetGuid, gain, beforeValue);
    })
    .catch(() => {
      // Парсинг JSON упал - игра сама обработает ответ; мы пропускаем
      // обновление подписи. Подпись обновится при следующем drawEntities.
    });
}

/**
 * Ставит monkey-patch на window.fetch один раз за жизнь страницы. Перехват
 * пропускает все запросы кроме /api/discover; для них клонирует Response
 * (чтобы не блокировать игру), парсит loot и через DETECTION_DELAY_MS
 * проверяет: если highlight[REFS_CHANNEL_INDEX] изменился сторонним кодом -
 * skip; иначе применяет gain. Срабатывает только пока модуль enabled - флаг
 * проверяется внутри обработчика.
 */
export function installDiscoverFetchHook(): void {
  if (discoverFetchInstalled) return;
  discoverFetchInstalled = true;
  const originalFetch = window.fetch;
  originalFetchBeforePatch = originalFetch;
  window.fetch = function patchedFetch(
    this: typeof window,
    ...args: Parameters<typeof window.fetch>
  ): Promise<Response> {
    const responsePromise = originalFetch.apply(this, args);
    if (!discoverHookEnabled) return responsePromise;
    const url = extractUrl(args[0]);
    if (!url || !DISCOVER_URL_PATTERN.test(url)) return responsePromise;
    const targetGuid = extractDiscoverGuidFromInit(args[1]);
    if (!targetGuid) return responsePromise;
    void responsePromise.then(
      (response) => {
        handleDiscoverResponse(response, targetGuid);
      },
      () => {
        // Сетевой сбой - игре уже сообщено через rejection основного промиса.
      },
    );
    return responsePromise;
  };
}

/** Тестовый сброс глобального fetch-патча. Только для тестов. */
export function uninstallDiscoverFetchHookForTest(): void {
  if (!discoverFetchInstalled) return;
  if (originalFetchBeforePatch) window.fetch = originalFetchBeforePatch;
  originalFetchBeforePatch = null;
  discoverFetchInstalled = false;
}

export const fixRedrawRefsOnDiscover: IFeatureModule = {
  id: MODULE_ID,
  name: {
    en: 'Refs counter redraw on discover fix',
    ru: 'Фикс обновления счётчика ключей после изучения',
  },
  description: {
    en: 'Updates the references counter on the point map label immediately after discover.',
    ru: 'Обновляет счётчик ключей на подписи точки на карте сразу после изучения.',
  },
  defaultEnabled: true,
  category: 'fix',

  init() {},

  async enable(): Promise<void> {
    installGeneration++;
    const myGeneration = installGeneration;
    const olMap = await getOlMap();
    if (myGeneration !== installGeneration) return;
    const pointsLayer = findLayerByName(olMap, 'points');
    if (!pointsLayer) return;
    const source = pointsLayer.getSource();
    if (!source) return;
    pointsSource = source;
    installDiscoverFetchHook();
    discoverHookEnabled = true;
  },

  disable(): void {
    installGeneration++;
    discoverHookEnabled = false;
    pointsSource = null;
  },
};
