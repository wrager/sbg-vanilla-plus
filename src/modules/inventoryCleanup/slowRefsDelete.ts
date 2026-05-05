import {
  getFavoritedGuids,
  isFavoritesSnapshotReady,
  isLockMigrationDone,
} from '../../core/favoritesStore';
import { t } from '../../core/l10n';
import { ITEM_TYPE_REFERENCE } from '../../core/gameConstants';
import {
  buildLockedPointGuids,
  readInventoryCache,
  readInventoryReferences,
} from '../../core/inventoryCache';
import { isInventoryReference } from '../../core/inventoryTypes';
import { isModuleEnabledByUser } from '../../core/moduleRegistry';
import { syncRefsCountForPoints } from '../../core/refsHighlightSync';
import { showToast as showCoreToast } from '../../core/toast';
import type { IDeletionEntry } from './cleanupCalculator';
import { loadCleanupSettings } from './cleanupSettings';
import {
  deleteInventoryItems,
  updateInventoryCache,
  updateDomInventoryCount,
  updatePointRefCount,
} from './inventoryApi';

const BUTTON_CLASS = 'svp-cleanup-slow-refs-button';
const MODAL_CLASS = 'svp-cleanup-slow-modal';
// Кнопка вставляется в .inventory__controls перед нативной #inventory-delete -
// так пара "выделить / очистить ключи" живёт в одном слоте. Раньше монтировалась
// в .svp-fav-filter-bar из удалённого модуля favoritedPoints; после его удаления
// контейнер пропал. Видимость управляется CSS :has() от data-tab="3" на
// .inventory__content - кнопка показывается только на вкладке ключей.
const TARGET_SELECTOR = '#inventory-delete';
export const FETCH_CONCURRENCY = 3;
const BROOM_ICON = '\u{1F9F9}';

let bodyObserver: MutationObserver | null = null;

function getPlayerTeam(): number | null {
  const element = document.getElementById('self-info__name');
  if (!element) return null;
  const match = /var\(--team-(\d+)\)/.exec(element.style.color);
  if (!match) return null;
  const team = parseInt(match[1], 10);
  return Number.isFinite(team) ? team : null;
}

export async function fetchPointTeam(pointGuid: string): Promise<number | null> {
  try {
    const response = await fetch(`/api/point?guid=${pointGuid}&status=1`);
    if (!response.ok) return null;
    const json: unknown = await response.json();
    if (typeof json !== 'object' || json === null || !('data' in json)) return null;
    // as Record — единственный способ обратиться к свойствам после typeof+null+in guard;
    // TS сужает до `object & Record<'data', unknown>`, но не до Record<string, unknown>.
    const record = json as Record<string, unknown>;
    const data = record.data;
    if (typeof data !== 'object' || data === null) return null;
    const dataRecord = data as Record<string, unknown>;
    if (typeof dataRecord.te === 'number') return dataRecord.te;
    return null;
  } catch {
    return null;
  }
}

interface IProgress {
  update: (done: number, total: number) => void;
  close: () => void;
  setStatus: (text: string) => void;
}

function openProgressModal(): IProgress {
  const overlay = document.createElement('div');
  overlay.className = MODAL_CLASS;

  const box = document.createElement('div');
  box.className = 'svp-cleanup-slow-modal-box';

  const status = document.createElement('div');
  status.className = 'svp-cleanup-slow-modal-status';
  status.textContent = t({ en: 'Preparing…', ru: 'Подготовка…' });
  box.appendChild(status);

  const barWrap = document.createElement('div');
  barWrap.className = 'svp-cleanup-slow-progress';
  const bar = document.createElement('div');
  bar.className = 'svp-cleanup-slow-progress-bar';
  barWrap.appendChild(bar);
  box.appendChild(barWrap);

  const counter = document.createElement('div');
  counter.className = 'svp-cleanup-slow-counter';
  counter.textContent = '0 / 0';
  box.appendChild(counter);

  overlay.appendChild(box);
  document.body.appendChild(overlay);

  return {
    update(done, total) {
      const percent = total === 0 ? 0 : Math.round((done / total) * 100);
      bar.style.width = `${percent}%`;
      counter.textContent = `${done} / ${total}`;
    },
    setStatus(text) {
      status.textContent = text;
    },
    close() {
      overlay.remove();
    },
  };
}

/** Параллельно, но с ограничением concurrency. */
export async function fetchTeamsForGuids(
  guids: string[],
  onProgress: (done: number, total: number) => void,
): Promise<Map<string, number | null>> {
  const result = new Map<string, number | null>();
  let done = 0;
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < guids.length) {
      const index = cursor++;
      const guid = guids[index];
      const team = await fetchPointTeam(guid);
      result.set(guid, team);
      done++;
      onProgress(done, guids.length);
    }
  }

  const workers: Promise<void>[] = [];
  for (let i = 0; i < Math.min(FETCH_CONCURRENCY, guids.length); i++) {
    workers.push(worker());
  }
  await Promise.all(workers);
  return result;
}

export interface IRefByGuid {
  itemGuid: string;
  pointGuid: string;
  amount: number;
}

/** Применить лимиты союзные/несоюзные с FIFO. */
export function calculateSlowDeletions(
  refs: IRefByGuid[],
  teams: Map<string, number | null>,
  playerTeam: number,
  alliedLimit: number,
  notAlliedLimit: number,
): IDeletionEntry[] {
  const alliedRefs: IRefByGuid[] = [];
  const notAlliedRefs: IRefByGuid[] = [];
  for (const ref of refs) {
    const team = teams.get(ref.pointGuid);
    if (team === playerTeam) {
      alliedRefs.push(ref);
    } else {
      // Несоюзные: вражеские (team !== playerTeam) И нейтральные/неизвестные (null/undefined).
      // Нейтральные точки (team=null: API вернул данные, но без te) не должны
      // избегать лимита — иначе slow-режим удаляет меньше чем fast.
      notAlliedRefs.push(ref);
    }
  }

  const deletions: IDeletionEntry[] = [];
  collectOverLimit(alliedRefs, alliedLimit, deletions);
  collectOverLimit(notAlliedRefs, notAlliedLimit, deletions);
  return deletions;
}

/**
 * Лимит НА ТОЧКУ: для каждой уникальной точки оставляет не более limit ключей.
 * Аналогично fast-режиму и CUI (строка 1392: amount > itemMaxAmount).
 */
export function collectOverLimit(
  refs: IRefByGuid[],
  limit: number,
  deletions: IDeletionEntry[],
): void {
  if (limit === -1) return;

  // Группировка по pointGuid.
  const byPoint = new Map<string, IRefByGuid[]>();
  for (const ref of refs) {
    const group = byPoint.get(ref.pointGuid) ?? [];
    group.push(ref);
    byPoint.set(ref.pointGuid, group);
  }

  for (const [pointGuid, group] of byPoint) {
    const total = group.reduce((sum, ref) => sum + ref.amount, 0);
    let excess = total - limit;
    if (excess <= 0) continue;

    for (const ref of group) {
      if (excess <= 0) break;
      const toDelete = Math.min(ref.amount, excess);
      deletions.push({
        guid: ref.itemGuid,
        type: ITEM_TYPE_REFERENCE,
        level: null,
        amount: toDelete,
        pointGuid,
      });
      excess -= toDelete;
    }
  }
}

// slowRefsDelete использует длинный duration (5 сек) — пользователь должен
// успеть прочитать результат удаления. Обёртка не переименовывает showToast,
// чтобы вызовы остались читаемыми.
const SLOW_TOAST_DURATION = 5000;

function showSlowToast(message: string): void {
  showCoreToast(message, SLOW_TOAST_DURATION);
}

async function runSlowDelete(): Promise<void> {
  const settings = loadCleanupSettings();
  if (settings.limits.referencesMode !== 'slow') {
    showSlowToast(
      t({ en: 'Key cleanup mode is not "Slow"', ru: 'Режим очистки ключей не «Медленно»' }),
    );
    return;
  }
  // Fail-safe на случай если кнопка показана во время гонки snapshot-неготов.
  // shouldShowButton уже прячет её, но прямой вызов функции (тест, будущая
  // подмена обработчика) не должен обойти блокировку. См. комментарий в
  // shouldShowButton и в inventoryCleanup.runCleanupImpl.
  if (
    !isLockMigrationDone() &&
    isModuleEnabledByUser('favoritesMigration') &&
    !isFavoritesSnapshotReady()
  ) {
    showSlowToast(
      t({
        en: 'Favorites snapshot not loaded yet — wait a moment and try again',
        ru: 'Снимок избранного ещё не загружен — подожди немного и попробуй снова',
      }),
    );
    return;
  }
  const { referencesAlliedLimit, referencesNotAlliedLimit } = settings.limits;
  if (referencesAlliedLimit === -1 && referencesNotAlliedLimit === -1) {
    showSlowToast(t({ en: 'Limits not set', ru: 'Лимиты не заданы' }));
    return;
  }

  const playerTeam = getPlayerTeam();
  if (playerTeam === null) {
    showSlowToast(
      t({ en: 'Could not determine player team', ru: 'Не удалось определить команду игрока' }),
    );
    return;
  }

  // Защитный слой: только нативные lock-флаги в `inventory-cache` (0.6.1+).
  // Legacy SVP/CUI-список в логике защиты не участвует - он только источник
  // миграции. Если у пользователя есть непустой legacy список и миграция не
  // сделана - кнопка slow cleanup скрыта (см. shouldShowButton).
  //
  // lockSupportAvailable проверяется через every: ВСЕ реф-стопки должны иметь
  // поле `f`. При mix-кэше (часть с `f`, часть без) стопки без `f` не попадают
  // в lockedPointGuids и могли бы быть удалены даже у фактически защищённой
  // точки. Симметрично с финальным guard в inventoryApi.deleteInventoryItems.
  const cache = readInventoryCache();
  const lockedPointGuids = buildLockedPointGuids(cache);
  const refStacks = cache.filter(isInventoryReference);
  const lockSupportAvailable =
    refStacks.length > 0 && refStacks.every((item) => item.f !== undefined);
  if (!lockSupportAvailable) {
    showSlowToast(
      t({
        en: 'Native lock support unavailable: server returned no f-flags. Cleanup blocked.',
        ru: 'Нативный lock недоступен (сервер не отдал поле f). Очистка заблокирована.',
      }),
    );
    return;
  }
  const invRefs = readInventoryReferences();
  const protectedRefs: IRefByGuid[] = invRefs
    .filter((ref) => ref.a > 0 && !lockedPointGuids.has(ref.l))
    .map((ref) => ({ itemGuid: ref.g, pointGuid: ref.l, amount: ref.a }));

  if (protectedRefs.length === 0) {
    showSlowToast(
      t({
        en: 'No unprotected keys to process',
        ru: 'Нет незащищённых ключей для обработки',
      }),
    );
    return;
  }

  const uniquePointGuids = Array.from(new Set(protectedRefs.map((ref) => ref.pointGuid)));

  const confirmed = confirm(
    t({
      en: `Fetch data for ${uniquePointGuids.length} points to determine faction? This may take a while.`,
      ru: `Запросить данные по ${uniquePointGuids.length} точкам для определения фракции? Это может занять время.`,
    }),
  );
  if (!confirmed) return;

  const progress = openProgressModal();
  progress.setStatus(t({ en: 'Fetching point data…', ru: 'Запрос данных точек…' }));
  progress.update(0, uniquePointGuids.length);

  let teams: Map<string, number | null>;
  try {
    teams = await fetchTeamsForGuids(uniquePointGuids, (done, total) => {
      progress.update(done, total);
    });
  } catch (error) {
    progress.close();
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    showSlowToast(t({ en: 'Request error: ', ru: 'Ошибка запроса: ' }) + message);
    return;
  }

  progress.setStatus(t({ en: 'Calculating deletions…', ru: 'Расчёт удаления…' }));

  const deletions = calculateSlowDeletions(
    protectedRefs,
    teams,
    playerTeam,
    referencesAlliedLimit,
    referencesNotAlliedLimit,
  );

  if (deletions.length === 0) {
    progress.close();
    showSlowToast(
      t({
        en: 'No keys to delete with current limits',
        ru: 'Нет ключей для удаления по заданным лимитам',
      }),
    );
    return;
  }

  const totalAmount = deletions.reduce((sum, entry) => sum + entry.amount, 0);
  const alliedDeletions = deletions.filter((entry) => {
    const team = teams.get(entry.pointGuid ?? '');
    return team === playerTeam;
  });
  const notAlliedDeletions = deletions.filter((entry) => {
    const team = teams.get(entry.pointGuid ?? '');
    return team !== playerTeam;
  });
  const alliedAmount = alliedDeletions.reduce((sum, entry) => sum + entry.amount, 0);
  const notAlliedAmount = notAlliedDeletions.reduce((sum, entry) => sum + entry.amount, 0);

  const alliedLabel = t({ en: 'allied', ru: 'союзные' });
  const notAlliedLabel = t({ en: 'not allied', ru: 'несоюзные' });
  const keysLabel = t({ en: 'keys', ru: 'ключей' });
  const summaryText = `${totalAmount} ${keysLabel} (${alliedLabel} ${alliedAmount} + ${notAlliedLabel} ${notAlliedAmount})`;

  progress.setStatus(t({ en: 'Deleting: ', ru: 'Удаление: ' }) + summaryText);

  try {
    const result = await deleteInventoryItems(deletions);
    updateInventoryCache(deletions);
    updatePointRefCount();
    // Sync счётчика ключей на подписи затронутых точек на карте. Slow удаляет
    // только ключи (по lock-проверке выше), все pointGuid у удалений заданы.
    const refPointGuids = Array.from(
      new Set(
        deletions
          .map((d) => d.pointGuid)
          .filter((guid): guid is string => typeof guid === 'string'),
      ),
    );
    if (refPointGuids.length > 0) {
      void syncRefsCountForPoints(refPointGuids);
    }
    if (result.total > 0) {
      updateDomInventoryCount(result.total);
    }
    progress.close();
    showSlowToast(t({ en: 'Deleted: ', ru: 'Удалено: ' }) + summaryText);
  } catch (error) {
    progress.close();
    const message =
      error instanceof Error ? error.message : t({ en: 'Unknown error', ru: 'Неизвестная ошибка' });
    showSlowToast(t({ en: 'Deletion error: ', ru: 'Ошибка удаления: ' }) + message);
  }
}

function formatLimit(value: number): string {
  return value === -1 ? '∞' : String(value);
}

function updateButtonLabel(button: HTMLButtonElement): void {
  const settings = loadCleanupSettings();
  const allied = formatLimit(settings.limits.referencesAlliedLimit);
  const notAllied = formatLimit(settings.limits.referencesNotAlliedLimit);
  // Иконка веника + лимиты allied/notAllied. Без слова "Очистить" / "Cleanup":
  // иконка считывается как "очистка" самостоятельно, текст оставлен только
  // для лимитов как машиночитаемого статуса кнопки. Title не выставляем -
  // им управляет syncDisabledState (объясняет причину disabled).
  const label = `${BROOM_ICON} ${allied}/${notAllied}`;
  // Не записывать textContent если текст не изменился — иначе DOM-мутация
  // тригерит body MutationObserver → checkAndInject → updateButtonLabel → цикл.
  if (button.textContent !== label) {
    button.textContent = label;
  }
}

function shouldShowButton(): boolean {
  const settings = loadCleanupSettings();
  if (settings.limits.referencesMode !== 'slow') return false;
  // Кнопка скрыта, пока пользователь не подтвердил миграцию SVP/CUI-избранных
  // в native lock и в IDB остаются legacy-точки. Подтверждение - флаг
  // isLockMigrationDone, выставляемый при success миграции в locked. Когда
  // флаг есть, legacy становится архивом, защиту берёт нативный lock - кнопка
  // показывается. Подробный разбор в inventoryCleanup.runCleanupImpl.
  if (isLockMigrationDone()) return true;
  if (!isModuleEnabledByUser('favoritesMigration')) return true;
  if (!isFavoritesSnapshotReady()) return false;
  return getFavoritedGuids().size === 0;
}

/**
 * Кнопка disabled, если оба лимита -1 (allied/notAllied) — slow-режим в этом
 * случае ничего не удалит, клик бессмысленен. Пользователь видит причину через
 * tooltip.
 */
function shouldDisableButton(): boolean {
  const { referencesAlliedLimit, referencesNotAlliedLimit } = loadCleanupSettings().limits;
  return referencesAlliedLimit === -1 && referencesNotAlliedLimit === -1;
}

function syncDisabledState(button: HTMLButtonElement): void {
  const disabled = shouldDisableButton();
  if (button.disabled !== disabled) button.disabled = disabled;
  const title = disabled
    ? t({
        en: 'Both limits are -1 (allied/not allied) — set at least one limit to enable cleanup',
        ru: 'Оба лимита -1 (союзные/несоюзные) — задайте хотя бы один лимит, чтобы включить очистку',
      })
    : '';
  if (button.title !== title) button.title = title;
}

function ensureButton(deleteSibling: Element): void {
  const parent = deleteSibling.parentElement;
  if (!parent) return;
  const existing = parent.querySelector<HTMLButtonElement>(`.${BUTTON_CLASS}`);
  if (!shouldShowButton()) {
    existing?.remove();
    return;
  }
  if (existing) {
    updateButtonLabel(existing);
    syncDisabledState(existing);
    return;
  }

  const button = document.createElement('button');
  button.type = 'button';
  button.className = BUTTON_CLASS;
  updateButtonLabel(button);
  syncDisabledState(button);
  button.addEventListener('click', (event) => {
    event.preventDefault();
    if (button.disabled) return;
    void runSlowDelete();
  });
  parent.insertBefore(button, deleteSibling);
}

function removeButton(): void {
  document.querySelector(`.${BUTTON_CLASS}`)?.remove();
}

function checkAndInject(): void {
  const target = document.querySelector(TARGET_SELECTOR);
  if (!target) {
    removeButton();
    return;
  }
  ensureButton(target);
}

let rafId: number | null = null;

export function installSlowRefsDelete(): void {
  if (bodyObserver) return;
  checkAndInject();
  bodyObserver = new MutationObserver(() => {
    if (rafId !== null) return;
    rafId = requestAnimationFrame(() => {
      rafId = null;
      checkAndInject();
    });
  });
  bodyObserver.observe(document.body, { childList: true, subtree: true });
}

export function uninstallSlowRefsDelete(): void {
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  bodyObserver?.disconnect();
  bodyObserver = null;
  removeButton();
}
