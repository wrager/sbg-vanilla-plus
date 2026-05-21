import { getCurrentPopupGuid } from './drawFilter';
import { refreshOpenPopup } from './refreshOpenPopup';
import type { IStarCenter } from './starCenter';

/**
 * Эффективный star-guid, применяемый фильтром к draw-запросу из попапа
 * заданной точки. null означает "фильтр звезды не накладывает ограничений":
 * центра нет, центр выключен (active=false), или открыт попап самого центра
 * (для попапа центра все линии звёздные, keepByStar отдаёт null). Используется
 * для сравнения состояний до/после изменения.
 */
function effectiveStarGuidForPopup(state: IStarCenter | null, popupGuid: string): string | null {
  if (state === null || !state.active) return null;
  if (state.guid === popupGuid) return null;
  return state.guid;
}

/**
 * Переоткрыть попап через window.showInfo, если изменение состояния звезды
 * меняет фильтрацию /api/draw для открытого попапа. Открытый попап удерживает
 * в closure'е игры список целей и possible_lines, полученные на момент
 * предыдущего /api/draw; без переоткрытия #draw-count и поведение кнопки
 * "Рисовать" остаются stale.
 *
 * No-op в трёх случаях:
 * (1) попап не открыт или скрыт через `.hidden`;
 * (2) effective-guid для popup'а не изменился (фильтр применялся одинаково
 *     или не применялся в обоих состояниях - например, попап на центре, где
 *     keepByStar отдаёт null независимо от guid/active);
 * (3) попап остался на центре и в prev, и в next (effective-guid для него
 *     в обоих случаях null - покрывается условием 2).
 *
 * prev/next - снимки состояния `IStarCenter | null` ДО и ПОСЛЕ изменения.
 * Caller передаёт оба явно, чтобы избежать гонок (между вызовом и
 * сравнением состояние не должно перечитываться из localStorage).
 */
export function refreshPopupIfStarFilterStateChanged(
  prev: IStarCenter | null,
  next: IStarCenter | null,
): void {
  const popupGuid = getCurrentPopupGuid();
  if (popupGuid === null) return;
  const prevEffective = effectiveStarGuidForPopup(prev, popupGuid);
  const nextEffective = effectiveStarGuidForPopup(next, popupGuid);
  if (prevEffective === nextEffective) return;
  refreshOpenPopup();
}
