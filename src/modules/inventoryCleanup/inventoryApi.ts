import type { IDeletionEntry } from './cleanupCalculator';
import { ITEM_TYPE_CORE, ITEM_TYPE_CATALYSER, ITEM_TYPE_REFERENCE } from '../../core/gameConstants';
import { INVENTORY_CACHE_KEY } from '../../core/inventoryCache';

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

export interface IDeleteInventoryOptions {
  /**
   * Снимок GUID всех ЗАЩИЩЁННЫХ точек (актуальные избранные + safety-backup)
   * на момент вызова — финальный guard перед DELETE. Даже если ключ прошёл
   * фильтрацию выше, перед отправкой запроса мы ещё раз проверяем pointGuid.
   */
  favoritedGuids: ReadonlySet<string>;
  /**
   * true, если модуль favoritedPoints включён И готов. Передаётся вызывающим кодом
   * (inventoryCleanup, slowRefsDelete) через isModuleActive('favoritedPoints').
   * Если false и в батче есть ключи — бросается ошибка, удаление не происходит.
   */
  favoritedPointsActive: boolean;
  /**
   * false, если guard-хранилище избранных повреждено/недоступно. В таком
   * состоянии удаление ключей запрещено (fail-closed).
   */
  favoritesGuardHealthy: boolean;
}

export async function deleteInventoryItems(
  deletions: readonly IDeletionEntry[],
  options: IDeleteInventoryOptions,
): Promise<IDeleteResult> {
  // Финальный guard: ключи могут удаляться ТОЛЬКО если модуль favoritedPoints
  // активен (включён + готов). Проверяем непосредственно перед DELETE, чтобы
  // ни один баг в цепочке выше не мог обойти эту защиту.
  const hasReferences = deletions.some((entry) => entry.type === ITEM_TYPE_REFERENCE);
  if (hasReferences && !options.favoritesGuardHealthy) {
    throw new Error('Удаление ключей запрещено: guard избранных недоступен');
  }
  if (hasReferences && !options.favoritedPointsActive) {
    throw new Error('Удаление ключей запрещено: модуль favoritedPoints не активен (guard)');
  }

  for (const entry of deletions) {
    if (!DELETABLE_TYPES.has(entry.type)) {
      throw new Error(`Удаление предметов типа ${entry.type} запрещено`);
    }
    if (entry.type === ITEM_TYPE_REFERENCE) {
      if (entry.pointGuid === undefined) {
        throw new Error(`Ключ ${entry.guid} без pointGuid не может быть удалён (guard избранных)`);
      }
      if (options.favoritedGuids.has(entry.pointGuid)) {
        throw new Error(
          `Ключ от избранной точки ${entry.pointGuid} не может быть удалён (guard избранных)`,
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
