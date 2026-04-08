import type { IFeatureModule } from '../../core/moduleRegistry';
import { isModuleActive } from '../../core/moduleRegistry';
import { INVENTORY_CACHE_KEY } from '../../core/inventoryCache';
import { getFavoritedGuids, isFavoritesSnapshotReady } from '../../core/favoritesStore';
import {
  getFavoritesProtectionSnapshot,
  syncFavoritesProtection,
} from '../../core/favoritesProtection';
import { parseInventoryCache } from './inventoryParser';
import { shouldRunCleanup, calculateDeletions, formatDeletionSummary } from './cleanupCalculator';
import { loadCleanupSettings } from './cleanupSettings';
import { initCleanupSettingsUi, destroyCleanupSettingsUi } from './cleanupSettingsUi';
import {
  deleteInventoryItems,
  updateInventoryCache,
  updateDomInventoryCount,
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

  // Ключи удаляются только если модуль favoritedPoints активен (включён + готов).
  // Если модуль выключен — защита избранных не гарантирована, автоочистка ключи
  // не трогает, даже если memory cache избранных загружен (init() всегда выполняется).
  const referencesModuleActive = isModuleActive('favoritedPoints');
  const favoritedGuids = referencesModuleActive ? getFavoritedGuids() : new Set<string>();
  // Синхронизируем защитный журнал перед расчётом. Он sticky и переживает
  // частичную/полную потерю списка избранного в IDB между сессиями.
  const guardSnapshot = referencesModuleActive
    ? syncFavoritesProtection(favoritedGuids)
    : getFavoritesProtectionSnapshot(favoritedGuids);
  const referencesEnabled = referencesModuleActive && guardSnapshot.storageHealthy;
  const deletions = calculateDeletions(items, settings.limits, {
    favoritedGuids: guardSnapshot.protectedGuids,
    referencesEnabled,
    favoritesSnapshotReady: isFavoritesSnapshotReady(),
  });
  if (deletions.length === 0) return;

  const totalAmount = deletions.reduce((sum, entry) => sum + entry.amount, 0);
  const summary = formatDeletionSummary(deletions);
  console.log(
    `[SVP inventoryCleanup] Удалить ${totalAmount} предметов` +
      ` (инвентарь: ${currentCount}/${inventoryLimit})`,
    deletions,
  );

  try {
    // Финальный guard: перечитываем защищённый набор точек (избранные + backup)
    // перед отправкой DELETE, чтобы учесть изменения после calculateDeletions.
    const finalGuardSnapshot = getFavoritesProtectionSnapshot(getFavoritedGuids());
    const result = await deleteInventoryItems(deletions, {
      favoritedGuids: finalGuardSnapshot.protectedGuids,
      favoritedPointsActive: isModuleActive('favoritedPoints'),
      favoritesGuardHealthy: finalGuardSnapshot.storageHealthy,
    });
    updateInventoryCache(deletions);
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
  },

  disable() {
    document.removeEventListener('click', onClickCapture, true);
    uninstallSetItemInterceptor();
    discoverPending = false;
    destroyCleanupSettingsUi();
    uninstallSlowRefsDelete();
  },
};
