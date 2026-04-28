import {
  INVENTORY_CACHE_KEY,
  buildLockedPointGuids,
  readInventoryCache,
  readInventoryReferences,
} from '../../core/inventoryCache';
import type { IInventoryReference } from '../../core/inventoryTypes';
import { isInventoryReference } from '../../core/inventoryTypes';
import {
  getFavoritedGuids,
  isLockMigrationDone,
  setLockMigrationDone,
} from '../../core/favoritesStore';

/**
 * Перевод SVP/CUI-избранных в нативные «звёздочки» / «замочки» SBG 0.6.1
 * через эндпоинт `POST /api/marks` (release-notes 1.3,
 * refs/game-beta/script.js:3416).
 */

export type MigrationFlag = 'favorite' | 'locked';

const FLAG_BIT: Record<MigrationFlag, number> = {
  favorite: 0b01,
  locked: 0b10,
};

/**
 * Запросы к `/api/marks` идут строго последовательно (по одному за раз) с
 * задержкой между каждым. Параллельность сервер выдерживает, но имеет
 * rate-limit на частоту marks-операций: при concurrency=4 без задержки
 * большая часть запросов возвращала `result: false` (отказ замаскированный
 * под toggle-off). Sequential + delay — единственный способ гарантировать
 * что все стопки получат флаг.
 */

/**
 * Задержка между запросами `/api/marks` (мс). Эмпирически проверено: 30
 * запросов с интервалом 1500мс прошли с 100% успехом (`result: true`).
 * Меньшие интервалы не тестировались — без подтверждения на твоём сервере
 * шансовать с rate-limit нельзя.
 */
const DEFAULT_REQUEST_DELAY_MS = 1500;

/**
 * Задержки перед автоматическими retry-попытками для сетевых ошибок (fetch
 * reject / HTTP не 2xx). Экспоненциальный backoff: 5с / 15с / 45с. Если
 * после третьего retry ошибка остаётся — сдаёмся, точка попадает в
 * `networkFailed`. Совокупно ~65с задержки на одну упавшую стопку — нечасто
 * стопок несколько, и пользователю проще подождать, чем выходить в confirm.
 */
const DEFAULT_NETWORK_RETRY_DELAYS_MS: readonly number[] = [5000, 15000, 45000];

/**
 * Задержка перед retry для `result: false` (сервер toggle снял флаг).
 * Меньше чем для networkFailed — это не сетевая проблема, скорее всего
 * лёгкая рассинхронизация состояния, которая решится за секунды.
 */
const DEFAULT_TOGGLE_RETRY_DELAY_MS = 3000;

export interface IMigrationItem {
  /** GUID конкретной стопки в инвентаре (item.g) — endpoint работает на уровне стопки. */
  itemGuid: string;
  /** GUID точки (item.l) — для группировки и пользовательских сообщений. */
  pointGuid: string;
}

export interface IMigrationCandidates {
  /** Точки из локального списка SVP/CUI, для которых в инвентаре есть ключи. */
  toSend: IMigrationItem[];
  /** Точки из локального списка, у которых в инвентаре нет стопок ключей. */
  withoutKeys: number;
  /** Стопки, которые УЖЕ имеют нужный флаг (предварительный фильтр по item.f). */
  alreadyApplied: number;
}

/**
 * One-time инициализация флага lock-migration-done для существующих
 * пользователей: если флаг ещё не выставлен, но в legacy IDB есть точки И в
 * `inventory-cache` есть наблюдаемое доказательство, что миграция была
 * проведена раньше - выставляем флаг, чтобы inventoryCleanup перестал
 * блокировать удаление ключей.
 *
 * Доказательством миграции считается legacy-точка, у которой ОДНОВРЕМЕННО
 * есть хотя бы одна стопка ключей в инвентаре И эта точка помечена нативным
 * lock-битом (`f & 0b10`). Только такая точка позволяет проверить факт, что
 * пользователь действительно прошёл миграцию в прошлой версии скрипта (или
 * руками через DevTools): мы видим стопку, она помечена замочком, значит
 * `POST /api/marks` отрабатывал.
 *
 * Сценарий, который раньше открывал дыру: пользователь установил скрипт
 * впервые на 0.6.1+, добавил точку в legacy через CUI или старую установку
 * SVP, ключей этой точки в инвентаре сейчас нет. Старая логика ставила
 * флаг, потому что `hasStacks=false` для всех legacy-точек "не противоречит
 * миграции". Когда пользователь набирал ключи этой точки, автоочистка
 * удаляла их без защиты, потому что флаг снимал блок, а нативный lock у
 * точки не выставлен. Новая логика не ставит флаг без позитивного
 * подтверждения.
 *
 * Если хоть одна legacy-точка имеет стопки И НЕ помечена lock - миграция
 * заведомо не завершена, флаг не выставляем; пользователь увидит UI
 * миграции и пройдёт её через кнопку. Если есть legacy-точки без стопок и
 * без lock - сами по себе они не доказывают и не опровергают факт миграции,
 * считаем нейтральными.
 *
 * Вызывается один раз из favoritesMigration.init() после loadFavorites().
 * Когда флаг уже выставлен (или legacy-список пуст) - no-op.
 */
export function inferAndPersistLockMigrationDone(): void {
  if (isLockMigrationDone()) return;
  const legacyGuids = getFavoritedGuids();
  if (legacyGuids.size === 0) return;
  const cache = readInventoryCache();
  const lockedGuids = buildLockedPointGuids(cache);
  let hasMigrationEvidence = false;
  for (const guid of legacyGuids) {
    const isLocked = lockedGuids.has(guid);
    const hasStacks = cache.some(
      (item) => isInventoryReference(item) && item.l === guid && item.a > 0,
    );
    if (!isLocked && hasStacks) return;
    if (isLocked && hasStacks) hasMigrationEvidence = true;
  }
  if (!hasMigrationEvidence) return;
  setLockMigrationDone();
}

/**
 * Собирает кандидатов на миграцию из текущего `inventory-cache`.
 *
 * Стопки уже помеченные нужным битом флага отбрасываются: `POST /api/marks`
 * — toggle-эндпоинт, повторный вызов снимет нашу пометку.
 */
export function buildCandidates(flag: MigrationFlag): IMigrationCandidates {
  const favoritedGuids = getFavoritedGuids();
  const refs = readInventoryReferences();

  const refsByPoint = new Map<string, IInventoryReference[]>();
  for (const ref of refs) {
    if (!favoritedGuids.has(ref.l)) continue;
    const stacks = refsByPoint.get(ref.l) ?? [];
    stacks.push(ref);
    refsByPoint.set(ref.l, stacks);
  }

  const bit = FLAG_BIT[flag];
  const toSend: IMigrationItem[] = [];
  let alreadyApplied = 0;
  for (const [pointGuid, stacks] of refsByPoint) {
    for (const stack of stacks) {
      if (stack.f !== undefined && (stack.f & bit) !== 0) {
        alreadyApplied++;
        continue;
      }
      toSend.push({ itemGuid: stack.g, pointGuid });
    }
  }

  let withoutKeys = 0;
  for (const guid of favoritedGuids) {
    if (!refsByPoint.has(guid)) withoutKeys++;
  }

  return { toSend, withoutKeys, alreadyApplied };
}

/**
 * Сервер отдаёт ответ напрямую, без вложения в `response` (несмотря на запись
 * в release-notes 4.A - там приведён формат, который было предположен,
 * фактический подтверждён ручным fetch'ем в DevTools). `result === true`
 * означает, что флаг УСТАНОВЛЕН после toggle, `false` - снят.
 *
 * Любой другой формат ответа трактуется как `result: false` - безопасный
 * дефолт: серверный флаг не считается установленным, кэш не обновляется,
 * стопка пойдёт в retry-toggle. Лучше лишний retry, чем подмена смысла.
 */
function parseMarksResult(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  if (!('result' in value)) return false;
  return value.result === true;
}

export interface IMarkOutcome {
  /** Сетевой запрос завершился без исключения и `response.ok === true`. */
  networkOk: boolean;
  /** `result === true` означает, что флаг УСТАНОВЛЕН (поставлен) после toggle. */
  result: boolean;
}

/**
 * Обновляет бит флага у стопки в `localStorage['inventory-cache']`. Повторяет
 * логику игры (refs/game-beta/script.js:1820-1827): после успешного marks-запроса
 * через нативную кнопку игра локально пересобирает поле `f` через Bitfield.put.
 * Без нашего собственного обновления при reload игра прочитает устаревший кэш
 * без бита 0b10 — замочек не появится в инвентаре.
 *
 * `on === true` устанавливает бит, `false` — снимает. Безопасно к запуску, если
 * стопка с таким `g` отсутствует в кэше: просто no-op.
 */
function applyFlagToCache(stackGuid: string, flag: MigrationFlag, on: boolean): void {
  const raw = localStorage.getItem(INVENTORY_CACHE_KEY);
  if (raw === null) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return;
  }
  if (!Array.isArray(parsed)) return;

  const bit = FLAG_BIT[flag];
  let mutated = false;
  for (const item of parsed) {
    if (!isInventoryReference(item)) continue;
    if (item.g !== stackGuid) continue;
    const current = item.f ?? 0;
    const next = on ? current | bit : current & ~bit;
    if (next !== current) {
      item.f = next;
      mutated = true;
    }
    break;
  }
  if (mutated) localStorage.setItem(INVENTORY_CACHE_KEY, JSON.stringify(parsed));
}

/**
 * Отправляет один `POST /api/marks` с `{ guid, flag }`. Игровая `apiSend` —
 * IIFE-внутренняя функция, недоступна юзерскрипту: используем прямой fetch
 * с auth-токеном, как в `inventoryApi.deleteInventoryItems`.
 *
 * После успешного ответа синхронизирует `inventory-cache` локально, чтобы
 * замочек/звёздочка появились без перезагрузки и сохранились при reload.
 */
export async function postMark(itemGuid: string, flag: MigrationFlag): Promise<IMarkOutcome> {
  const token = localStorage.getItem('auth');
  if (!token) return { networkOk: false, result: false };

  try {
    const response = await fetch('/api/marks', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ guid: itemGuid, flag }),
    });
    if (!response.ok) return { networkOk: false, result: false };
    const json: unknown = await response.json();
    const result = parseMarksResult(json);
    // Сервер сообщил итоговое состояние флага после toggle: true = поставлен,
    // false = снят. В обоих случаях обновляем кэш под актуальный сервером state.
    applyFlagToCache(itemGuid, flag, result);
    return { networkOk: true, result };
  } catch {
    return { networkOk: false, result: false };
  }
}

export interface IMigrationProgress {
  /** Уже завершённые попытки (включая retry). */
  done: number;
  /** Всего попыток в текущем проходе. */
  total: number;
  /** Сколько успешных к этому моменту. */
  succeeded: number;
}

export interface IMigrationResult {
  /** Стопки с применённым флагом после всех проходов. */
  succeeded: IMigrationItem[];
  /** Стопки, для которых после всех auto-retry сетевая ошибка не ушла. */
  networkFailed: IMigrationItem[];
  /** Стопки, для которых сервер дважды подряд вернул `result: false`. */
  toggleStuck: IMigrationItem[];
}

export type MigrationPhaseName = 'initial' | 'retry-toggle' | 'retry-network';

export interface IMigrationPhase {
  /** Какая фаза начинается. */
  name: MigrationPhaseName;
  /** Сколько стопок будет обработано в этой фазе. */
  total: number;
}

export interface IMigrationOptions {
  flag: MigrationFlag;
  onProgress?: (progress: IMigrationProgress) => void;
  /**
   * Вызывается перед началом каждой фазы (initial / retry-toggle / retry-network).
   * Позволяет UI сбросить прогресс-бар в 0/N для новой фазы и обновить статус.
   */
  onPhaseChange?: (phase: IMigrationPhase) => void;
  /**
   * Задержка между запросами в `runBatch` (мс). По умолчанию
   * `DEFAULT_REQUEST_DELAY_MS=1500` — обходит серверный rate-limit. В тестах
   * передавать 0, чтобы прогон был мгновенным.
   */
  requestDelayMs?: number;
  /**
   * Задержки перед каждой попыткой retry-network (мс). Длина массива = число
   * попыток (по умолчанию 3). В тестах передавать `[0]` или `[]` для скорости.
   */
  networkRetryDelaysMs?: readonly number[];
  /**
   * Задержка перед retry-toggle (мс). По умолчанию
   * `DEFAULT_TOGGLE_RETRY_DELAY_MS=3000`. В тестах передавать 0.
   */
  toggleRetryDelayMs?: number;
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Прогон одного «пакета» вызовов: последовательно (CONCURRENCY=1), с задержкой
 * `requestDelayMs` между запросами для обхода серверного rate-limit. Возвращает
 * три категории результатов на каждый item.
 *
 * Задержка ставится ПЕРЕД каждым запросом кроме первого: первый летит сразу,
 * следующий ждёт `requestDelayMs`. Так минимизируется задержка для ситуаций
 * с одним кандидатом (типичный retry-сценарий), но соблюдается лимит для
 * длинных серий (initial-фаза с десятками точек).
 */
async function runBatch(
  items: IMigrationItem[],
  flag: MigrationFlag,
  total: number,
  onProgress: ((progress: IMigrationProgress) => void) | undefined,
  requestDelayMs: number,
): Promise<{
  succeeded: IMigrationItem[];
  networkFailed: IMigrationItem[];
  toggleOff: IMigrationItem[];
}> {
  const succeeded: IMigrationItem[] = [];
  const networkFailed: IMigrationItem[] = [];
  const toggleOff: IMigrationItem[] = [];

  let done = 0;
  let succeededCount = 0;

  for (let index = 0; index < items.length; index++) {
    if (index > 0) await sleep(requestDelayMs);
    const item = items[index];
    const outcome = await postMark(item.itemGuid, flag);
    done++;
    if (!outcome.networkOk) {
      networkFailed.push(item);
    } else if (!outcome.result) {
      toggleOff.push(item);
    } else {
      succeeded.push(item);
      succeededCount++;
    }
    onProgress?.({ done, total, succeeded: succeededCount });
  }

  return { succeeded, networkFailed, toggleOff };
}

/**
 * Прогоняет полный цикл миграции с автоматическим retry:
 * 1. Initial-фаза — все `items` последовательно с `requestDelayMs` между запросами.
 * 2. Retry-toggle — один проход для стопок с `result: false`, после паузы
 *    `toggleRetryDelayMs`. Если опять `false` — стопка идёт в `toggleStuck`.
 * 3. Retry-network — для сетевых ошибок: до `networkRetryDelaysMs.length`
 *    автоматических попыток с возрастающим backoff (5с / 15с / 45с по умолчанию).
 *    Никаких confirm-диалогов — пользователь нажал кнопку и ждёт результат.
 */
export async function runMigration(
  items: IMigrationItem[],
  options: IMigrationOptions,
): Promise<IMigrationResult> {
  const requestDelayMs = options.requestDelayMs ?? DEFAULT_REQUEST_DELAY_MS;
  const networkRetryDelays = options.networkRetryDelaysMs ?? DEFAULT_NETWORK_RETRY_DELAYS_MS;
  const toggleRetryDelay = options.toggleRetryDelayMs ?? DEFAULT_TOGGLE_RETRY_DELAY_MS;

  const totalSucceeded: IMigrationItem[] = [];
  const totalToggleStuck: IMigrationItem[] = [];

  options.onPhaseChange?.({ name: 'initial', total: items.length });
  const initial = await runBatch(
    items,
    options.flag,
    items.length,
    options.onProgress,
    requestDelayMs,
  );
  totalSucceeded.push(...initial.succeeded);

  // Retry для toggleOff — один проход после паузы. Прогресс начинается с 0/N
  // (свой бар фазы), succeeded не накапливается с предыдущей фазы — UI видит
  // чистый счётчик retry.
  if (initial.toggleOff.length > 0) {
    options.onPhaseChange?.({ name: 'retry-toggle', total: initial.toggleOff.length });
    await sleep(toggleRetryDelay);
    const toggleResult = await runBatch(
      initial.toggleOff,
      options.flag,
      initial.toggleOff.length,
      options.onProgress,
      requestDelayMs,
    );
    totalSucceeded.push(...toggleResult.succeeded);
    totalToggleStuck.push(...toggleResult.toggleOff);
    initial.networkFailed.push(...toggleResult.networkFailed);
  }

  // Retry для networkFailed — автоматический backoff. Без confirm-диалогов:
  // пользователь нажал кнопку → миграция сама борется с сетью. Финальные
  // оставшиеся стопки уйдут в `networkFailed` итогового результата.
  let pendingNetwork = initial.networkFailed;
  for (const delayMs of networkRetryDelays) {
    if (pendingNetwork.length === 0) break;

    options.onPhaseChange?.({ name: 'retry-network', total: pendingNetwork.length });
    await sleep(delayMs);
    const retry = await runBatch(
      pendingNetwork,
      options.flag,
      pendingNetwork.length,
      options.onProgress,
      requestDelayMs,
    );
    totalSucceeded.push(...retry.succeeded);
    totalToggleStuck.push(...retry.toggleOff);
    pendingNetwork = retry.networkFailed;
  }

  return {
    succeeded: totalSucceeded,
    networkFailed: pendingNetwork,
    toggleStuck: totalToggleStuck,
  };
}
