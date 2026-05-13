import type { IDeletionEntry } from './cleanupCalculator';
import { ITEM_TYPE_CORE, ITEM_TYPE_CATALYSER, ITEM_TYPE_REFERENCE } from '../../core/gameConstants';
import {
  INVENTORY_CACHE_KEY,
  buildProtectedPointGuids,
  isProtectionFlagSupportAvailable,
  readInventoryCache,
} from '../../core/inventoryCache';
import { isInventoryItem, isInventoryReference } from '../../core/inventoryTypes';
import { POINT_POPUP_SELECTOR } from '../../core/pointPopup';

export interface IDeleteResult {
  total: number;
}

/**
 * Сервер возвращает либо `{ error: string }`, либо `{ count: { total: number } }`.
 * Парсер игнорирует посторонние поля и валидирует структуру в runtime - тип
 * хранения в `unknown` плюс проверки `in`/`typeof` дешевле чем кастовать в
 * интерфейс без проверки и узнавать о расхождении в проде.
 */
function readApiError(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return null;
  if (!('error' in value) || typeof value.error !== 'string') return null;
  return value.error;
}

function readApiCountTotal(value: unknown): number | null {
  if (typeof value !== 'object' || value === null) return null;
  if (!('count' in value)) return null;
  const count = value.count;
  if (typeof count !== 'object' || count === null) return null;
  if (!('total' in count) || typeof count.total !== 'number') return null;
  return count.total;
}

function buildAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem('auth');
  if (!token) {
    throw new Error('Auth token not found');
  }
  return {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
  };
}

function groupByType(deletions: readonly IDeletionEntry[]): Map<number, Record<string, number>> {
  const grouped = new Map<number, Record<string, number>>();
  for (const entry of deletions) {
    let selection = grouped.get(entry.type);
    if (!selection) {
      selection = {};
      grouped.set(entry.type, selection);
    }
    selection[entry.guid] = (selection[entry.guid] ?? 0) + entry.amount;
  }
  return grouped;
}

/** Типы предметов, удаление которых разрешено. Спецпредметы (вёники) защищены. */
const DELETABLE_TYPES = new Set([ITEM_TYPE_CORE, ITEM_TYPE_CATALYSER, ITEM_TYPE_REFERENCE]);

export async function deleteInventoryItems(
  deletions: readonly IDeletionEntry[],
): Promise<IDeleteResult> {
  const hasReferences = deletions.some((entry) => entry.type === ITEM_TYPE_REFERENCE);

  // Финальный guard для lock/favorite-флагов: перечитываем СВЕЖИЙ
  // inventory-cache (он мог обновиться между расчётом deletions и этим
  // вызовом — пользователь нажал замок или звёздочку прямо во время
  // cleanup'а, или сервер вернул новые `f` в ответе на discover). Если точка
  // теперь защищена (lock или favorite) — удаление её ключей блокируется.
  const freshCache = hasReferences ? readInventoryCache() : [];
  const freshProtectedPointGuids = hasReferences
    ? buildProtectedPointGuids(freshCache)
    : new Set<string>();
  // Удаление ключей разрешено только если ВСЕ реф-стопки в свежем кэше имеют
  // поле `f` (см. `isProtectionFlagSupportAvailable`). Симметрично с
  // cleanupCalculator, slowRefsDelete и refsOnMap.handleDeleteClick.
  if (hasReferences && !isProtectionFlagSupportAvailable(freshCache)) {
    throw new Error(
      'Удаление ключей запрещено: нативная защита (lock/favorite) недоступна (guard)',
    );
  }

  for (const entry of deletions) {
    if (!DELETABLE_TYPES.has(entry.type)) {
      throw new Error(`Удаление предметов типа ${entry.type} запрещено`);
    }
    if (entry.type === ITEM_TYPE_REFERENCE) {
      if (entry.pointGuid === undefined) {
        throw new Error(
          `Ключ ${entry.guid} без pointGuid не может быть удалён (guard lock/favorite)`,
        );
      }
      if (freshProtectedPointGuids.has(entry.pointGuid)) {
        throw new Error(
          `Ключ от защищённой точки ${entry.pointGuid} не может быть удалён (guard lock/favorite)`,
        );
      }
    }
  }

  const grouped = groupByType(deletions);
  let lastTotal = 0;

  for (const [type, selection] of grouped) {
    const response = await fetch('/api/inventory', {
      method: 'DELETE',
      headers: buildAuthHeaders(),
      body: JSON.stringify({ selection, tab: type }),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    let parsed: unknown;
    try {
      parsed = await response.json();
    } catch {
      throw new Error('Invalid response from server');
    }

    const errorMessage = readApiError(parsed);
    if (errorMessage !== null) {
      throw new Error(errorMessage);
    }

    const total = readApiCountTotal(parsed);
    if (total === null) {
      throw new Error('Response missing inventory count');
    }

    lastTotal = total;
  }

  return { total: lastTotal };
}

export function updateDomInventoryCount(total: number): void {
  const element = document.getElementById('self-info__inv');
  if (element) {
    element.textContent = String(total);
  }
}

/**
 * Обновляет счётчик ключей #i-ref в открытом попапе точки.
 * Игра обновляет #i-ref при discover'е ДО нашей автоочистки.
 * После удаления ключей нужно пересчитать #i-ref по актуальному inventory-cache.
 */
export function updatePointRefCount(): void {
  const infoPopup = document.querySelector<HTMLElement>(POINT_POPUP_SELECTOR);
  if (!infoPopup || infoPopup.classList.contains('hidden')) return;

  const pointGuid = infoPopup.dataset.guid;
  if (!pointGuid) return;

  const refElement = document.getElementById('i-ref');
  if (!refElement) return;

  const raw = localStorage.getItem(INVENTORY_CACHE_KEY);
  if (!raw) return;

  let cache: unknown[];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return;
    cache = parsed;
  } catch {
    return;
  }

  const ref = cache.find((item) => isInventoryReference(item) && item.l === pointGuid);
  const count = isInventoryReference(ref) ? ref.a : 0;

  // Формат #i-ref: "КЛЮЧ N/100" (ru) или "REF N/100" (en) — число перед "/" всегда
  // совпадает с количеством. Заменяем через regex, чтобы не зависеть от i18next.
  const currentText = refElement.textContent;
  const updatedText = currentText.replace(/\d+(?=\/)/, String(count));
  if (updatedText !== currentText) {
    refElement.textContent = updatedText;
  }
  refElement.setAttribute('data-has', count > 0 ? '1' : '0');
}

export function updateInventoryCache(deletions: readonly IDeletionEntry[]): void {
  const raw = localStorage.getItem(INVENTORY_CACHE_KEY);
  if (!raw) {
    console.warn('[SVP inventoryCleanup] inventory-cache отсутствует, пропуск обновления');
    return;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.warn('[SVP inventoryCleanup] inventory-cache содержит невалидный JSON');
    return;
  }

  if (!Array.isArray(parsed)) {
    console.warn('[SVP inventoryCleanup] inventory-cache не является массивом');
    return;
  }

  // Фильтруем валидные предметы через тайпгард - даёт типизированный массив
  // без cast'а. Потенциально не-IInventoryItem записи (которых в реальном
  // кэше игры быть не должно) дропаются здесь же; прежняя реализация дропала
  // их позже, через item.a > 0 на undefined - результат тот же, путь чище.
  const items = parsed.filter(isInventoryItem);

  for (const entry of deletions) {
    const cached = items.find((item) => item.g === entry.guid);
    if (cached) {
      cached.a -= entry.amount;
    }
  }

  const remaining = items.filter((item) => item.a > 0);
  localStorage.setItem(INVENTORY_CACHE_KEY, JSON.stringify(remaining));
}
