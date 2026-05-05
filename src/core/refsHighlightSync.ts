// Утилита синхронизации счётчика ключей точки на карте (`highlight['7']` в
// feature.properties OL) с актуальным `inventory-cache`. Источник истины -
// кэш: для каждой переданной точки считаем суммарный amount её ref-стопок и
// записываем в `highlight['7']` через Reflect.set. Если значение совпадает -
// no-op. После любого изменения вызываем `feature.changed()` - это
// инвалидирует execution plan layer'а и запускает перерисовку.
//
// Подход симметричен для discover (gain), cleanup (loss), refsOnMap-delete
// (loss) и любого будущего пути изменения inventory-cache: caller просто
// передаёт список pointGuid, у которых количество ключей могло измениться.
//
// SBG 0.6.1+ хранит highlight как sparse object {"4":false,"7":N}, не массив.
// Доступ через числовой ключ (как строка) работает одинаково для obj и array.
//
// pointsSource находится lazy при первом вызове через getOlMap. Один await
// на жизнь страницы; последующие вызовы синхронны.

import { readInventoryReferences } from './inventoryCache';
import { isModuleEnabledByUser } from './moduleRegistry';
import { findLayerByName, getOlMap } from './olMap';
import type { IOlVectorSource } from './olMap';

// Модуль-владелец синхронизации. Если пользователь выключил его в настройках,
// все вызовы syncRefsCountForPoints из любых модулей-каллеров (refsLayerSync
// после discover, inventoryCleanup после fast-cleanup, slowRefsDelete после
// slow-cleanup, refsOnMap после viewer-DELETE) silent-return. Один тумблер
// контролирует весь sync, не разные тумблеры на каждом пути.
const OWNER_MODULE_ID = 'refsLayerSync';

const REFS_CHANNEL_INDEX = 7;
const REFS_CHANNEL_KEY = String(REFS_CHANNEL_INDEX);

let pointsSource: IOlVectorSource | null = null;
let initPromise: Promise<void> | null = null;

async function ensurePointsSource(): Promise<void> {
  if (pointsSource) return;
  initPromise ??= getOlMap().then((map) => {
    const layer = findLayerByName(map, 'points');
    pointsSource = layer?.getSource() ?? null;
  });
  await initPromise;
}

/**
 * Считает amount ключей по точкам из текущего inventory-cache. Возвращает
 * Map pointGuid -> sum(item.a) для всех ref-стопок этой точки. Если у точки
 * нет стопок в кэше - её нет в map (caller интерпретирует отсутствие как 0).
 */
function buildAmountByPoint(): Map<string, number> {
  const refs = readInventoryReferences();
  const amountByPoint = new Map<string, number>();
  for (const ref of refs) {
    amountByPoint.set(ref.l, (amountByPoint.get(ref.l) ?? 0) + ref.a);
  }
  return amountByPoint;
}

/**
 * Синхронизирует `highlight['7']` на features указанных точек с amount в
 * inventory-cache. Для каждой точки:
 *
 * - feature не найдена в pointsSource (точка не загружена на карте) - silent skip.
 * - highlight не object (отсутствует или неверного типа) - silent skip.
 * - значение уже совпадает с target - silent skip (no-op, без feature.changed()).
 * - значение отличается - in-place мутация + feature.changed().
 *
 * Безопасна к вызову с пустым массивом: silent return.
 */
export async function syncRefsCountForPoints(pointGuids: readonly string[]): Promise<void> {
  if (pointGuids.length === 0) return;
  // Owner-модуль выключен пользователем - silent no-op для всех каллеров.
  // Это единая точка контроля sync, не отдельные тумблеры на каждом пути.
  if (!isModuleEnabledByUser(OWNER_MODULE_ID)) return;
  await ensurePointsSource();
  if (!pointsSource) return;

  const amountByPoint = buildAmountByPoint();

  for (const guid of pointGuids) {
    const feature = pointsSource.getFeatureById?.(guid);
    if (!feature) continue;
    if (typeof feature.get !== 'function') continue;
    const highlight = feature.get('highlight');
    if (typeof highlight !== 'object' || highlight === null) continue;
    const existing: unknown = Reflect.get(highlight, REFS_CHANNEL_KEY);
    const current = typeof existing === 'number' ? existing : 0;
    const target = amountByPoint.get(guid) ?? 0;
    if (current === target) continue;
    Reflect.set(highlight, REFS_CHANNEL_KEY, target);
    if (typeof feature.changed === 'function') feature.changed();
  }
}

/** Только для тестов: сбрасывает кеш pointsSource и initPromise. */
export function resetRefsHighlightSyncForTest(): void {
  pointsSource = null;
  initPromise = null;
}
