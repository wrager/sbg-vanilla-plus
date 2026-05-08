import {
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
import { MARK_FLAG_BIT, postMark, type MarkFlag } from '../../core/marksApi';

/**
 * Перевод SVP/CUI-избранных в нативные «звёздочки» / «замочки» SBG 0.6.1
 * через эндпоинт `POST /api/marks` (release-notes 1.3,
 * refs/game/script.js:3416).
 */

/** Алиас для совместимости с migrationUi: семантически идентичен MarkFlag из core. */
export type MigrationFlag = MarkFlag;

export { postMark };

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
  /**
   * GUIDы точек из локального списка, у которых в инвентаре нет стопок ключей.
   * Lock-флаг в SBG живёт на стопке (бит в `item.f`), не на точке как
   * сущности: пометить точку без стопок физически нельзя - сервер не на чем
   * ставить бит. Когда пользователь позже наберёт ключи такой точки, новая
   * стопка придёт с `f=0` (без lock); защитить эти ключи можно только руками
   * через нативную кнопку игры.
   *
   * runFlow в migrationUi показывает modal alert со списком этих GUIDов,
   * чтобы пользователь явно знал, какие точки остались без защиты.
   */
  withoutKeysGuids: string[];
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

  const bit = MARK_FLAG_BIT[flag];
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

  const withoutKeysGuids: string[] = [];
  for (const guid of favoritedGuids) {
    if (!refsByPoint.has(guid)) withoutKeysGuids.push(guid);
  }

  return { toSend, withoutKeysGuids, alreadyApplied };
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
