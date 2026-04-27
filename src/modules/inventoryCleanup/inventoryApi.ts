import type { IDeletionEntry } from './cleanupCalculator';
import { ITEM_TYPE_CORE, ITEM_TYPE_CATALYSER, ITEM_TYPE_REFERENCE } from '../../core/gameConstants';
import {
  INVENTORY_CACHE_KEY,
  buildLockedPointGuids,
  readInventoryCache,
} from '../../core/inventoryCache';
import { isInventoryReference } from '../../core/inventoryTypes';

export interface IDeleteResult {
  total: number;
}

interface IApiResponse {
  count?: { total?: number };
  error?: string;
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

  // Финальный guard для lock-флагов: перечитываем СВЕЖИЙ inventory-cache (он
  // мог обновиться между расчётом deletions и этим вызовом — пользователь
  // нажал замок прямо во время cleanup'а, или сервер вернул новые `f` в
  // ответе на discover). Если точка теперь locked — удаление её ключей
  // блокируется.
  const freshCache = hasReferences ? readInventoryCache() : [];
  const freshLockedPointGuids = hasReferences
    ? buildLockedPointGuids(freshCache)
    : new Set<string>();
  // Удаление ключей разрешено только если ВСЕ реф-стопки в свежем кэше имеют
  // поле `f`. Раньше проверялось `some` (хотя бы одна), но при mix-кэше (часть
  // стопок с `f`, часть без) стопки без `f` не попадают в `lockedPointGuids`
  // (там `if (item.f === undefined) continue`) и могли быть удалены, даже если
  // их точка по логике должна быть защищена. На 0.6.1+ сервер всегда отдаёт `f`
  // для всех refs, mix маловероятен, но `every` исключает класс ошибки целиком,
  // не полагаясь на неявные предположения о поведении сервера.
  const refStacks = freshCache.filter(isInventoryReference);
  const lockSupportAvailable =
    refStacks.length > 0 && refStacks.every((item) => item.f !== undefined);

  if (hasReferences && !lockSupportAvailable) {
    throw new Error('Удаление ключей запрещено: нативный lock недоступен (guard)');
  }

  for (const entry of deletions) {
    if (!DELETABLE_TYPES.has(entry.type)) {
      throw new Error(`Удаление предметов типа ${entry.type} запрещено`);
    }
    if (entry.type === ITEM_TYPE_REFERENCE) {
      if (entry.pointGuid === undefined) {
        throw new Error(`Ключ ${entry.guid} без pointGuid не может быть удалён (guard lock)`);
      }
      if (freshLockedPointGuids.has(entry.pointGuid)) {
        throw new Error(
          `Ключ от заблокированной точки ${entry.pointGuid} не может быть удалён (guard lock)`,
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

    let parsed: IApiResponse;
    try {
      parsed = (await response.json()) as IApiResponse;
    } catch {
      throw new Error('Invalid response from server');
    }

    if (parsed.error) {
      throw new Error(parsed.error);
    }

    if (!parsed.count || typeof parsed.count.total !== 'number') {
      throw new Error('Response missing inventory count');
    }

    lastTotal = parsed.count.total;
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
  const infoPopup = document.querySelector<HTMLElement>('.info.popup');
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

  const ref = cache.find(
    (item) =>
      typeof item === 'object' &&
      item !== null &&
      (item as Record<string, unknown>).t === ITEM_TYPE_REFERENCE &&
      (item as Record<string, unknown>).l === pointGuid,
  ) as { a: number } | undefined;

  const count = ref?.a ?? 0;

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
    parsed = JSON.parse(raw) as unknown;
  } catch {
    console.warn('[SVP inventoryCleanup] inventory-cache содержит невалидный JSON');
    return;
  }

  if (!Array.isArray(parsed)) {
    console.warn('[SVP inventoryCleanup] inventory-cache не является массивом');
    return;
  }
  // as — после Array.isArray; TS сужает до unknown[], но не до конкретного типа
  // элемента. Структура элементов (g, a) проверяется неявно: find по g, мутация a.
  let cache = parsed as { g: string; a: number; [key: string]: unknown }[];

  for (const entry of deletions) {
    const cached = cache.find((item) => item.g === entry.guid);
    if (cached) {
      cached.a -= entry.amount;
    }
  }

  cache = cache.filter((item) => item.a > 0);
  localStorage.setItem(INVENTORY_CACHE_KEY, JSON.stringify(cache));
}
