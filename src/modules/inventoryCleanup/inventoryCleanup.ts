import type { IFeatureModule } from '../../core/moduleRegistry';
import { isModuleEnabledByUser } from '../../core/moduleRegistry';
import { INVENTORY_CACHE_KEY } from '../../core/inventoryCache';
import {
  getFavoritedGuids,
  isFavoritesSnapshotReady,
  isLockMigrationDone,
} from '../../core/favoritesStore';
// favoritesStore импортируется только для определения migrationPending — сам
// legacy список SVP/CUI участвует только в favoritesMigration. inventoryCleanup
// здесь использует список только как сигнал «миграция ещё не сделана».
import { parseInventoryCache } from './inventoryParser';
import { shouldRunCleanup, calculateDeletions, formatDeletionSummary } from './cleanupCalculator';
import { loadCleanupSettings } from './cleanupSettings';
import { initCleanupSettingsUi, destroyCleanupSettingsUi } from './cleanupSettingsUi';
import { installNativeGarbageGuard, uninstallNativeGarbageGuard } from './nativeGarbageGuard';
import {
  deleteInventoryItems,
  updateInventoryCache,
  updateDomInventoryCount,
  updatePointRefCount,
} from './inventoryApi';
import { installSlowRefsDelete, uninstallSlowRefsDelete } from './slowRefsDelete';
import { syncRefsCountForPoints } from '../../core/refsHighlightSync';
import { ITEM_TYPE_REFERENCE } from '../../core/gameConstants';
import { showToast } from '../../core/toast';

const MODULE_ID = 'inventoryCleanup';

const ACTION_SELECTORS = '#discover, .discover-mod';
const DEBUG_INV_KEY = 'svp_debug_inv';

let cleanupInProgress = false;
let discoverPending = false;
let originalSetItem: typeof Storage.prototype.setItem | null = null;
let setItemPatchTarget: 'instance' | 'prototype' | null = null;

function readDebugInvCount(): number | null {
  const match = /[#&]svp-inv=(\d+)/.exec(location.hash);
  if (match) {
    sessionStorage.setItem(DEBUG_INV_KEY, match[1]);
  }
  const stored = sessionStorage.getItem(DEBUG_INV_KEY);
  if (stored === null) return null;
  const value = parseInt(stored, 10);
  return Number.isFinite(value) ? value : null;
}

function readDomNumber(id: string): number | null {
  const element = document.getElementById(id);
  if (!element) return null;
  const value = parseInt(element.textContent, 10);
  return Number.isFinite(value) ? value : null;
}

async function runCleanup(): Promise<void> {
  if (cleanupInProgress) return;
  cleanupInProgress = true;

  try {
    await runCleanupImpl();
  } finally {
    cleanupInProgress = false;
  }
}

async function runCleanupImpl(): Promise<void> {
  const settings = loadCleanupSettings();

  const currentCount = readDebugInvCount() ?? readDomNumber('self-info__inv');
  const inventoryLimit = readDomNumber('self-info__inv-lim');

  if (currentCount === null || inventoryLimit === null) {
    console.warn('[SVP inventoryCleanup] Не удалось прочитать инвентарь из DOM');
    return;
  }

  if (!shouldRunCleanup(currentCount, inventoryLimit, settings.minFreeSlots)) {
    return;
  }

  const items = parseInventoryCache();
  if (items.length === 0) return;

  // Защита ключей: защищённые точки (lock 0b10 или favorite 0b01 поля
  // item.f) защищены calculateDeletions/inventoryApi-guard'ами безусловно. Дополнительная
  // блокировка удаления ключей нужна, пока пользователь не подтвердил
  // миграцию SVP/CUI-избранных в native lock - иначе автоочистка удалила бы
  // legacy-favorited ключи, которые ещё не помечены замочком в игре.
  //
  // Подтверждение - флаг isLockMigrationDone, выставляемый при success
  // миграции в locked (в migrationUi.runFlow) или ретроактивно для
  // существующих пользователей (inferAndPersistLockMigrationDone в init).
  // Когда флаг выставлен, legacy-список становится архивом: защиту берёт на
  // себя нативный lock, наш блок не нужен.
  //
  // Когда флаг НЕ выставлен:
  // - модуль миграции отключён пользователем - блок снимаем, его выбор;
  // - модуль активен, snapshot не готов (init ещё крутит loadFavorites или
  //   loadFavorites упал) - блок ставим, мы не знаем содержимое legacy и не
  //   рискуем удалять ключи вслепую;
  // - модуль активен, snapshot готов, legacy непустой - блок ставим, есть что
  //   мигрировать;
  // - модуль активен, snapshot готов, legacy пустой - блок снимаем, нечего
  //   защищать.
  const migrationModuleEnabled = isModuleEnabledByUser('favoritesMigration');
  const snapshotReady = isFavoritesSnapshotReady();
  const blockReferences =
    !isLockMigrationDone() &&
    migrationModuleEnabled &&
    (!snapshotReady || getFavoritedGuids().size > 0);
  const limitsForRun = blockReferences
    ? { ...settings.limits, referencesMode: 'off' as const }
    : settings.limits;
  const deletions = calculateDeletions(items, limitsForRun);
  if (deletions.length === 0) return;

  const totalAmount = deletions.reduce((sum, entry) => sum + entry.amount, 0);
  const summary = formatDeletionSummary(deletions);
  console.log(
    `[SVP inventoryCleanup] Удалить ${totalAmount} предметов` +
      ` (инвентарь: ${currentCount}/${inventoryLimit})`,
    deletions,
  );

  try {
    // Финальный guard: deleteInventoryItems перечитает свежий inventory-cache
    // и проверит, что все удаляемые ключи всё ещё не относятся к защищённым
    // точкам (lock 0b10 или favorite 0b01 поля f).
    const result = await deleteInventoryItems(deletions);
    updateInventoryCache(deletions);
    updatePointRefCount();
    // Синхронизация счётчика ключей на подписи точек на карте: после удаления
    // ключей `highlight['7']` на feature остаётся stale (как и после discover -
    // см. refsLayerSync). Один вызов с уникальными pointGuid из
    // удалений - агрегатно для всех затронутых точек.
    const refPointGuids = collectRefPointGuids(deletions);
    if (refPointGuids.length > 0) {
      void syncRefsCountForPoints(refPointGuids);
    }
    if (result.total > 0) {
      updateDomInventoryCount(result.total);
    }
    showToast(`Очистка (${totalAmount}): ${summary}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    console.error('[SVP inventoryCleanup] Ошибка удаления:', message);
    showToast(`Ошибка очистки: ${message}`);
  }
}

function collectRefPointGuids(
  deletions: readonly { type: number; pointGuid?: string }[],
): string[] {
  const set = new Set<string>();
  for (const entry of deletions) {
    if (entry.type !== ITEM_TYPE_REFERENCE) continue;
    if (typeof entry.pointGuid !== 'string') continue;
    set.add(entry.pointGuid);
  }
  return Array.from(set);
}

function isDiscoverButton(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  const button = target.closest(ACTION_SELECTORS);
  if (!(button instanceof HTMLButtonElement)) return false;
  return !button.disabled;
}

function onClickCapture(event: Event): void {
  if (!isDiscoverButton(event.target)) return;
  discoverPending = true;
}

function onInventoryCacheUpdated(): void {
  discoverPending = false;
  void runCleanup();
}

function installSetItemInterceptor(): void {
  // Идемпотентность: если wrapper уже установлен (originalSetItem заполнен),
  // повторный enable() без disable() обернул бы wrapper в новый wrapper,
  // искажая цепочку восстановления в disable(). Это бы повредило localStorage
  // при последующем disable — восстанавливался бы предыдущий wrapper, а не нативная функция.
  if (originalSetItem !== null) return;

  // eslint-disable-next-line @typescript-eslint/unbound-method
  const nativeSetItem = localStorage.setItem;
  originalSetItem = nativeSetItem;

  const wrapper = function (key: string, value: string): void {
    nativeSetItem.call(localStorage, key, value);
    if (key === INVENTORY_CACHE_KEY && discoverPending) {
      // Запустить очистку в следующей микротаске, чтобы игра завершила
      // обработку ответа discover (обновление DOM-счётчика и т.д.)
      void Promise.resolve().then(onInventoryCacheUpdated);
    }
  };

  // В некоторых WebView (Android 16+ / Chrome 146+) localStorage.setItem —
  // собственное свойство объекта, а не унаследованное от Storage.prototype.
  // Патч прототипа в этом случае не перехватывает вызовы localStorage.setItem().
  // Пробуем патчить localStorage напрямую; если среда не позволяет (jsdom),
  // откатываемся на прототип.
  localStorage.setItem = wrapper;
  if (localStorage.setItem === wrapper) {
    setItemPatchTarget = 'instance';
  } else {
    Storage.prototype.setItem = wrapper;
    setItemPatchTarget = 'prototype';
  }
}

function uninstallSetItemInterceptor(): void {
  if (originalSetItem && setItemPatchTarget) {
    if (setItemPatchTarget === 'instance') {
      localStorage.setItem = originalSetItem;
    } else {
      Storage.prototype.setItem = originalSetItem;
    }
    originalSetItem = null;
    setItemPatchTarget = null;
  }
}

export const inventoryCleanup: IFeatureModule = {
  id: MODULE_ID,
  name: {
    en: 'Inventory auto-cleanup',
    ru: 'Автоочистка инвентаря',
  },
  description: {
    en: 'Automatically removes excess items when discovering points. Protects keys of points marked with native lock or favorite.',
    ru: 'Автоматически удаляет лишние предметы при изучении точек. Защищает ключи точек, помеченных нативным замочком или звёздочкой.',
  },
  defaultEnabled: true,
  category: 'feature',

  init() {},

  enable() {
    document.addEventListener('click', onClickCapture, true);
    installSetItemInterceptor();
    initCleanupSettingsUi();
    installSlowRefsDelete();
    installNativeGarbageGuard();
  },

  disable() {
    document.removeEventListener('click', onClickCapture, true);
    uninstallSetItemInterceptor();
    discoverPending = false;
    destroyCleanupSettingsUi();
    uninstallSlowRefsDelete();
    uninstallNativeGarbageGuard();
  },
};
