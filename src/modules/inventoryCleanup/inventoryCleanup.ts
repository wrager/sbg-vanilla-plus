import type { IFeatureModule } from '../../core/moduleRegistry';
import { getModuleById } from '../../core/moduleRegistry';
import { INVENTORY_CACHE_KEY } from '../../core/inventoryCache';
import { getFavoritedGuids } from '../../core/favoritesStore';
import { parseInventoryCache } from './inventoryParser';
import { shouldRunCleanup, calculateDeletions, formatDeletionSummary } from './cleanupCalculator';
import { loadCleanupSettings } from './cleanupSettings';
import { initCleanupSettingsUi, destroyCleanupSettingsUi } from './cleanupSettingsUi';
import { deleteInventoryItems, updateInventoryCache } from './inventoryApi';

const MODULE_ID = 'inventoryCleanup';

const ACTION_SELECTORS = '#discover, .discover-mod';
const TOAST_DURATION = 3000;
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

function showCleanupToast(message: string): void {
  const toast = document.createElement('div');
  toast.className = 'svp-cleanup-toast';
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('svp-cleanup-toast-hide');
    toast.addEventListener('transitionend', () => {
      toast.remove();
    });
  }, TOAST_DURATION);
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

function updateDomInventoryCount(total: number): void {
  const element = document.getElementById('self-info__inv');
  if (element) {
    element.textContent = String(total);
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

  // Ключи удаляются только если модуль favoritedPoints готов — иначе у нас нет
  // гарантии, что избранные загружены в memory cache. Защита от потери ключей
  // от избранных точек при любых сбоях инициализации favoritedPoints.
  const favoritedPointsStatus = getModuleById('favoritedPoints')?.status ?? null;
  const referencesEnabled = favoritedPointsStatus === 'ready';
  const favoritedGuids = referencesEnabled ? getFavoritedGuids() : new Set<string>();
  const deletions = calculateDeletions(items, settings.limits, {
    favoritedGuids,
    referencesEnabled,
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
    // Финальный guard: перечитываем избранные из memory cache ПЕРЕД отправкой
    // DELETE-запроса, чтобы учесть изменения с момента calculateDeletions.
    const result = await deleteInventoryItems(deletions, {
      favoritedGuids: getFavoritedGuids(),
    });
    updateInventoryCache(deletions);
    updateDomInventoryCount(result.total);
    showCleanupToast(`Очистка (${totalAmount}): ${summary}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    console.error('[SVP inventoryCleanup] Ошибка удаления:', message);
    showCleanupToast(`Ошибка очистки: ${message}`);
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
    en: 'Automatically removes excess items when discovering points',
    ru: 'Автоматически удаляет лишние предметы при изучении точек',
  },
  defaultEnabled: true,
  category: 'utility',

  init() {},

  enable() {
    document.addEventListener('click', onClickCapture, true);
    installSetItemInterceptor();
    initCleanupSettingsUi();
  },

  disable() {
    document.removeEventListener('click', onClickCapture, true);
    uninstallSetItemInterceptor();
    discoverPending = false;
    destroyCleanupSettingsUi();
  },
};
