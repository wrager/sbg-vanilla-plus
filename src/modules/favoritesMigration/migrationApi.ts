import { INVENTORY_CACHE_KEY, readInventoryReferences } from '../../core/inventoryCache';
import type { IInventoryReference } from '../../core/inventoryTypes';
import { isInventoryReference } from '../../core/inventoryTypes';
import { getFavoritedGuids } from '../../core/favoritesStore';

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

/** Параллельные запросы — паттерн из старого `inventoryFilter.scheduleLimitedPointFetch`. */
const CONCURRENCY = 4;

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

interface IApiMarksResponse {
  response?: { result?: boolean };
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
    const json = (await response.json()) as IApiMarksResponse;
    const result = json.response?.result === true;
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
  /** Сетевые ошибки, которые пользователь не захотел повторять. */
  networkFailed: IMigrationItem[];
  /** Стопки, которые toggle переключил OFF и retry не помог. */
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
   * Позволяет UI сбросить прогресс-бар в 0/N для новой фазы и обновить статус —
   * пользователь видит независимый прогресс retry, а не «скачок» суммарного total.
   */
  onPhaseChange?: (phase: IMigrationPhase) => void;
  /**
   * Спрашивает у пользователя, повторять ли запросы для упавших стопок. Возвращает
   * true → ещё проход, false → остановить. Передаётся как зависимость, чтобы
   * тесты могли подменить confirm на стаб без window.alert.
   */
  confirmRetry: (failedCount: number) => boolean;
}

/**
 * Прогон одного «пакета» вызовов с concurrency-лимитом. Возвращает три категории
 * результатов на каждый item.
 */
async function runBatch(
  items: IMigrationItem[],
  flag: MigrationFlag,
  startProgress: { done: number; succeeded: number; total: number },
  onProgress?: (progress: IMigrationProgress) => void,
): Promise<{
  succeeded: IMigrationItem[];
  networkFailed: IMigrationItem[];
  toggleOff: IMigrationItem[];
}> {
  const succeeded: IMigrationItem[] = [];
  const networkFailed: IMigrationItem[] = [];
  const toggleOff: IMigrationItem[] = [];

  let cursor = 0;
  let { done, succeeded: succeededCount } = startProgress;
  const { total } = startProgress;

  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor++;
      const item = items[index];
      const outcome = await postMark(item.itemGuid, flag);
      done++;
      if (!outcome.networkOk) {
        networkFailed.push(item);
      } else if (!outcome.result) {
        // Сетевой OK, но результат false — значит сервер toggle'нул OFF.
        // Кандидат на отдельный retry: повторный POST вернёт ON.
        toggleOff.push(item);
      } else {
        succeeded.push(item);
        succeededCount++;
      }
      onProgress?.({ done, total, succeeded: succeededCount });
    }
  }

  const workerCount = Math.min(CONCURRENCY, items.length);
  const promises: Promise<void>[] = [];
  for (let i = 0; i < workerCount; i++) promises.push(worker());
  await Promise.all(promises);

  return { succeeded, networkFailed, toggleOff };
}

/**
 * Прогоняет полный цикл миграции с retry-механизмом:
 * 1. Первый проход по `items`.
 * 2. `toggleOff` — повторно (один раз): если предварительный фильтр устарел,
 *    повторный вызов вернёт флаг в ON.
 * 3. `networkFailed` — спрашиваем пользователя через `confirmRetry`. На «ОК»
 *    повторяем; новые ошибки снова через confirm. Цикл до пустого набора
 *    или отказа пользователя.
 */
export async function runMigration(
  items: IMigrationItem[],
  options: IMigrationOptions,
): Promise<IMigrationResult> {
  const totalSucceeded: IMigrationItem[] = [];
  const totalToggleStuck: IMigrationItem[] = [];

  options.onPhaseChange?.({ name: 'initial', total: items.length });
  const initial = await runBatch(
    items,
    options.flag,
    { done: 0, succeeded: 0, total: items.length },
    options.onProgress,
  );
  totalSucceeded.push(...initial.succeeded);

  // Retry для toggleOff — один проход. Прогресс начинается с 0/N (свой бар фазы),
  // succeeded не накапливается с предыдущей фазы — UI видит чистый счётчик retry.
  if (initial.toggleOff.length > 0) {
    options.onPhaseChange?.({ name: 'retry-toggle', total: initial.toggleOff.length });
    const toggleResult = await runBatch(
      initial.toggleOff,
      options.flag,
      { done: 0, succeeded: 0, total: initial.toggleOff.length },
      options.onProgress,
    );
    totalSucceeded.push(...toggleResult.succeeded);
    // Если вторая попытка снова toggle'нула OFF — стопка «застряла» в неустойчивом состоянии.
    totalToggleStuck.push(...toggleResult.toggleOff);
    // Сетевые ошибки на retry заталкиваем в общий networkFailed для следующего цикла.
    initial.networkFailed.push(...toggleResult.networkFailed);
  }

  // Retry для networkFailed — через confirm цикл. Каждый круг retry — отдельная фаза.
  let pendingNetwork = initial.networkFailed;
  while (pendingNetwork.length > 0) {
    const wantsRetry = options.confirmRetry(pendingNetwork.length);
    if (!wantsRetry) break;

    options.onPhaseChange?.({ name: 'retry-network', total: pendingNetwork.length });
    const retry = await runBatch(
      pendingNetwork,
      options.flag,
      { done: 0, succeeded: 0, total: pendingNetwork.length },
      options.onProgress,
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
