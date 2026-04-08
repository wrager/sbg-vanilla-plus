import { getFavoritedGuids } from '../../core/favoritesStore';
import { t } from '../../core/l10n';
import { ITEM_TYPE_REFERENCE } from '../../core/gameConstants';
import { readInventoryReferences } from '../../core/inventoryCache';
import { isModuleActive } from '../../core/moduleRegistry';
import type { IDeletionEntry } from './cleanupCalculator';
import { loadCleanupSettings } from './cleanupSettings';
import {
  deleteInventoryItems,
  updateInventoryCache,
  updateDomInventoryCount,
} from './inventoryApi';

const BUTTON_CLASS = 'svp-cleanup-slow-refs-button';
const MODAL_CLASS = 'svp-cleanup-slow-modal';
// Кнопка монтируется внутрь .svp-fav-filter-bar (создаётся модулем favoritedPoints),
// чтобы чекбокс «Только избранные» и кнопка «Очистить ключи» были в одной строке.
// Это DOM-зависимость от элемента другого модуля, но не TS-импорт.
const FILTER_BAR_SELECTOR = '.svp-fav-filter-bar';
export const FETCH_CONCURRENCY = 3;

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
  return null;
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
import { showToast as showCoreToast } from '../../core/toast';

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

  const favoritedGuids = getFavoritedGuids();
  if (favoritedGuids.size === 0) {
    showSlowToast(
      t({
        en: 'Add at least one favorited point before cleaning keys',
        ru: 'Добавьте хотя бы одну избранную точку перед очисткой ключей',
      }),
    );
    return;
  }
  const invRefs = readInventoryReferences();
  const nonFavRefs: IRefByGuid[] = invRefs
    .filter((ref) => ref.a > 0 && !favoritedGuids.has(ref.l))
    .map((ref) => ({ itemGuid: ref.g, pointGuid: ref.l, amount: ref.a }));

  if (nonFavRefs.length === 0) {
    showSlowToast(
      t({ en: 'No non-favorited keys to process', ru: 'Нет не-избранных ключей для обработки' }),
    );
    return;
  }

  const uniquePointGuids = Array.from(new Set(nonFavRefs.map((ref) => ref.pointGuid)));

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
    nonFavRefs,
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
    const result = await deleteInventoryItems(deletions, {
      favoritedGuids: getFavoritedGuids(),
      favoritedPointsActive: isModuleActive('favoritedPoints'),
    });
    updateInventoryCache(deletions);
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
  const label = t({
    en: `Clean (limits: ${allied}/${notAllied})`,
    ru: `Очистить (лимиты: ${allied}/${notAllied})`,
  });
  // Не записывать textContent если текст не изменился — иначе DOM-мутация
  // тригерит body MutationObserver → checkAndInject → updateButtonLabel → цикл.
  if (button.textContent !== label) {
    button.textContent = label;
  }
}

function shouldShowButton(): boolean {
  const settings = loadCleanupSettings();
  return settings.limits.referencesMode === 'slow' && isModuleActive('favoritedPoints');
}

function ensureButton(bar: Element): void {
  if (!shouldShowButton()) {
    bar.querySelector(`.${BUTTON_CLASS}`)?.remove();
    return;
  }
  const existing = bar.querySelector<HTMLButtonElement>(`.${BUTTON_CLASS}`);
  if (existing) {
    updateButtonLabel(existing);
    return;
  }

  const button = document.createElement('button');
  button.type = 'button';
  button.className = BUTTON_CLASS;
  updateButtonLabel(button);
  button.addEventListener('click', (event) => {
    event.preventDefault();
    void runSlowDelete();
  });
  bar.appendChild(button);
}

function removeButton(): void {
  document.querySelector(`.${BUTTON_CLASS}`)?.remove();
}

function checkAndInject(): void {
  const bar = document.querySelector(FILTER_BAR_SELECTOR);
  if (!bar) {
    removeButton();
    return;
  }
  ensureButton(bar);
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
