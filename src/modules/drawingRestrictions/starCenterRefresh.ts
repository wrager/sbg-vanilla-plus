import { getCurrentPopupGuid } from './drawFilter';
import { refreshOpenPopup } from './refreshOpenPopup';

/**
 * Wrapper над refreshOpenPopup со специфичной для звезды отсечкой по
 * centerBeforeChange.
 *
 * No-op в трёх случаях: (1) центра не было до изменения (фильтр звезды не
 * был активен, count корректен сразу); (2) попап не открыт или скрыт через
 * `.hidden`; (3) открыт попап самого прежнего центра (для попапа центра
 * keepByStar отдаёт null - фильтр не применяется, count тоже корректен).
 *
 * Остальные сценарии - изменение центра при открытом попапе другой точки -
 * требуют закрытия и переоткрытия попапа через window.showInfo, иначе closure
 * игры держит старый список целей и #draw-count показывает stale-значение.
 */
export function refreshPopupIfStarFilterWasActive(centerBeforeChange: string | null): void {
  if (centerBeforeChange === null) return;
  const popupGuid = getCurrentPopupGuid();
  if (popupGuid === null) return;
  if (popupGuid === centerBeforeChange) return;
  refreshOpenPopup();
}
