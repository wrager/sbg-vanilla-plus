import type { IFeatureModule } from '../../core/moduleRegistry';
import { isModuleActive } from '../../core/moduleRegistry';
import { INVENTORY_CACHE_KEY } from '../../core/inventoryCache';
import { getFavoritedGuids, isFavoritesSnapshotReady } from '../../core/favoritesStore';
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

  // Защита ключей: ТОЛЬКО нативные locked точки (item.f & 0b10), без legacy
  // SVP/CUI-избранных. Однако если у пользователя есть непустой legacy список
  // и модуль миграции активен — миграция ещё не сделана, и автоочистка ключей
  // удалила бы то, что пользователь защищал в SVP/CUI. Блокируем удаление
  // ключей до завершения миграции; cores/cats удаляются как обычно.
  //
  // Дополнительный guard на snapshot: bootstrap.initModules запускает init
  // модулей параллельно — inventoryCleanup.enable() выполняется синхронно сразу,
  // а favoritesMigration.init() (где делается loadFavorites из IDB) асинхронный.
  // Если первый discover успевает до завершения loadFavorites, snapshot не
  // готов, размер легаси-списка читается как 0, и migrationPending был бы
  // false — cleanup ключей пошёл бы вслепую, удалив legacy-favorited ключи,
  // которые пользователь ещё не успел мигрировать. Поэтому пока модуль миграции
  // активен, но snapshot не загружен (init ещё в процессе, или loadFavorites
  // упал, или сработала count-seal-проверка) — удаление ключей блокируется как
  // и при настоящем pending-состоянии.
  const migrationModuleActive = isModuleActive('favoritesMigration');
  const snapshotReady = isFavoritesSnapshotReady();
  const migrationPending = migrationModuleActive && snapshotReady && getFavoritedGuids().size > 0;
  const blockReferencesUntilSnapshot = migrationModuleActive && !snapshotReady;
  const limitsForRun =
    migrationPending || blockReferencesUntilSnapshot
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
    // и проверит, что все удаляемые ключи всё ещё не locked (бит 0b10 поля f).
    const result = await deleteInventoryItems(deletions);
    updateInventoryCache(deletions);
    updatePointRefCount();
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
    en: 'Automatically removes excess items when discovering points. Slow cleanup runs manually from the references OPS tab',
    ru: 'Автоматически удаляет лишние предметы при изучении точек. Медленная очистка запускается вручную через кнопку во вкладке ключей в ОРПЦ',
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
