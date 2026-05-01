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

import { diagAlert } from './diagAlert';
import { readInventoryReferences } from './inventoryCache';
import { findLayerByName, getOlMap } from './olMap';
import type { IOlVectorSource } from './olMap';

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

interface ISyncUpdate {
  guid: string;
  before: number;
  after: number;
}

interface ISyncSkip {
  guid: string;
  reason: 'no-feature' | 'no-highlight';
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
 * - highlight не object (отсутствует или неверного типа) - skip + diagnostic alert.
 * - значение уже совпадает с target - silent skip (no-op, без feature.changed()).
 * - значение отличается - in-place мутация + feature.changed() + diagnostic alert.
 *
 * Aggregate diagnostic alert: один alert на весь вызов с краткой сводкой,
 * не по одному на точку (cleanup может затрагивать десятки точек).
 *
 * Безопасна к вызову с пустым массивом: silent return.
 */
export async function syncRefsCountForPoints(pointGuids: readonly string[]): Promise<void> {
  if (pointGuids.length === 0) return;
  await ensurePointsSource();
  if (!pointsSource) return;

  const amountByPoint = buildAmountByPoint();
  const updates: ISyncUpdate[] = [];
  const skips: ISyncSkip[] = [];

  for (const guid of pointGuids) {
    const feature = pointsSource.getFeatureById?.(guid);
    if (!feature) continue;
    if (typeof feature.get !== 'function') continue;
    const highlight = feature.get('highlight');
    if (typeof highlight !== 'object' || highlight === null) {
      skips.push({ guid, reason: 'no-highlight' });
      continue;
    }
    const existing: unknown = Reflect.get(highlight, REFS_CHANNEL_KEY);
    const current = typeof existing === 'number' ? existing : 0;
    const target = amountByPoint.get(guid) ?? 0;
    if (current === target) continue;
    Reflect.set(highlight, REFS_CHANNEL_KEY, target);
    if (typeof feature.changed === 'function') feature.changed();
    updates.push({ guid, before: current, after: target });
  }

  emitDiagnostic(pointGuids.length, updates, skips);
}

function emitDiagnostic(
  requestedCount: number,
  updates: readonly ISyncUpdate[],
  skips: readonly ISyncSkip[],
): void {
  // Безусловный alert на каждый цикл: пользователь не имеет DevTools на
  // мобильном устройстве, диагностика нужна для подтверждения работы.
  // Удалим, когда фикс синхронизации стабилизируется.
  if (updates.length === 0 && skips.length === 0) return;

  const updatesPart =
    updates.length > 0
      ? updates
          .slice(0, 3)
          .map((u) => `${u.guid.slice(0, 8)}:${String(u.before)}->${String(u.after)}`)
          .join(', ') + (updates.length > 3 ? `,+${String(updates.length - 3)}` : '')
      : '-';

  const skipsPart =
    skips.length > 0
      ? skips
          .slice(0, 3)
          .map((s) => `${s.guid.slice(0, 8)}:${s.reason}`)
          .join(', ') + (skips.length > 3 ? `,+${String(skips.length - 3)}` : '')
      : '-';

  diagAlert(
    `SVP refsSync\n` +
      `req: ${String(requestedCount)}\n` +
      `upd: ${String(updates.length)} ${updatesPart}\n` +
      `skip: ${String(skips.length)} ${skipsPart}`,
  );
}

/** Только для тестов: сбрасывает кеш pointsSource и initPromise. */
export function resetRefsHighlightSyncForTest(): void {
  pointsSource = null;
  initPromise = null;
}
