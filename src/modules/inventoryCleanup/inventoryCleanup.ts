import type { IFeatureModule } from '../../core/moduleRegistry';
import { isModuleActive } from '../../core/moduleRegistry';
import { INVENTORY_CACHE_KEY } from '../../core/inventoryCache';
import { getFavoritedGuids, isFavoritesSnapshotReady } from '../../core/favoritesStore';
import { parseInventoryCache } from './inventoryParser';
import { shouldRunCleanup, calculateDeletions, formatDeletionSummary } from './cleanupCalculator';
import { loadCleanupSettings } from './cleanupSettings';
import { initCleanupSettingsUi, destroyCleanupSettingsUi } from './cleanupSettingsUi';
import { deleteInventoryItems, updateInventoryCache } from './inventoryApi';
import { installSlowRefsDelete, uninstallSlowRefsDelete } from './slowRefsDelete';
import { showToast } from '../../core/toast';

const MODULE_ID = 'inventoryCleanup';

const ACTION_SELECTORS = '#discover, .discover-mod';
const DEBUG_INV_KEY = 'svp_debug_inv';
// Отладка: true = появляется кнопка «TEST CLEANUP» поверх игры, запускающая
// автоочистку напрямую (runCleanup) в обход discover. Кнопка НЕ обходит
// shouldRunCleanup — обычный авто-поток всегда проверяет порог.
const DEBUG_SHOW_CLEANUP_BUTTON = true;

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

  // Ключи удаляются только если модуль favoritedPoints активен (включён + готов).
  // Если модуль выключен — защита избранных не гарантирована, автоочистка ключи
  // не трогает, даже если memory cache избранных загружен (init() всегда выполняется).
  const referencesEnabled = isModuleActive('favoritedPoints');
  const favoritedGuids = referencesEnabled ? getFavoritedGuids() : new Set<string>();
  const deletions = calculateDeletions(items, settings.limits, {
    favoritedGuids,
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
    // Финальный guard: перечитываем избранные из memory cache ПЕРЕД отправкой
    // DELETE-запроса, чтобы учесть изменения с момента calculateDeletions.
    const result = await deleteInventoryItems(deletions, {
      favoritedGuids: getFavoritedGuids(),
      favoritedPointsActive: isModuleActive('favoritedPoints'),
    });
    // Симулированные записи (ключи в альфе) на сервере не удалились — не трогаем
    // ни inventory-cache, ни DOM-счётчик для этих записей.
    const simulatedGuids = new Set(result.simulatedReferenceDeletions.map((entry) => entry.guid));
    const realDeletions = deletions.filter((entry) => !simulatedGuids.has(entry.guid));
    updateInventoryCache(realDeletions);
    if (result.total > 0) {
      updateDomInventoryCount(result.total);
    }

    const simulatedAmount = result.simulatedReferenceDeletions.reduce(
      (sum, entry) => sum + entry.amount,
      0,
    );
    if (simulatedAmount > 0 && realDeletions.length === 0) {
      showToast(`Симуляция: удалилось бы ${simulatedAmount} ключей`);
    } else if (simulatedAmount > 0) {
      showToast(
        `Очистка (${totalAmount - simulatedAmount}): ${summary}; симуляция ${simulatedAmount} ключей`,
      );
    } else {
      showToast(`Очистка (${totalAmount}): ${summary}`);
    }
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

let debugButton: HTMLButtonElement | null = null;

function installDebugButton(): void {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- DEBUG_SHOW_CLEANUP_BUTTON будет снят после отладки
  if (!DEBUG_SHOW_CLEANUP_BUTTON) return;
  debugButton = document.createElement('button');
  debugButton.textContent = 'TEST CLEANUP';
  debugButton.style.cssText =
    'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);z-index:99999;' +
    'padding:6px 14px;background:#ffcc33;color:#000;font-weight:bold;font-size:11px;' +
    'border:1px solid #000;border-radius:6px;cursor:pointer;opacity:0.8;';
  debugButton.addEventListener('click', () => {
    void runCleanup();
  });
  document.body.appendChild(debugButton);
}

function uninstallDebugButton(): void {
  debugButton?.remove();
  debugButton = null;
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
    installSlowRefsDelete();
    installDebugButton();
  },

  disable() {
    document.removeEventListener('click', onClickCapture, true);
    uninstallSetItemInterceptor();
    discoverPending = false;
    destroyCleanupSettingsUi();
    uninstallSlowRefsDelete();
    uninstallDebugButton();
  },
};
