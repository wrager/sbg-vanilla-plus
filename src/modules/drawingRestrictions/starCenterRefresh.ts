import { getCurrentPopupGuid } from './drawFilter';

const POPUP_CLOSE_SELECTOR = '.info .popup-close';

/**
 * Закрывает попап точки и переоткрывает его через `window.showInfo(guid)`,
 * чтобы заставить игру сделать свежий `/api/draw` и обновить `#draw-count`
 * с `point_state.possible_lines` под актуальные правила drawFilter.
 *
 * Триггер: изменение центра звезды (назначение/переназначение/сброс) когда
 * открыт попап точки, отличной от прежнего центра. Без перезапроса closure
 * игры держит старый список целей - `#draw-count` показывает stale-значение,
 * клик "Рисовать" использует stale-список.
 *
 * No-op в трёх случаях: (1) центра не было до изменения (фильтр звезды не
 * был активен, count корректен сразу); (2) попап не открыт или скрыт через
 * `.hidden`; (3) открыт попап самого прежнего центра (для попапа центра
 * keepByStar отдаёт null - фильтр не применяется, count тоже корректен).
 *
 * `window.showInfo` экспонируется патчем `src/core/gameScriptPatcher.ts`.
 * Если patch не применился (game-скрипт обновлён), warn в консоль и
 * пропускаем закрытие - иначе пользователь потеряет контекст без
 * возможности переоткрытия.
 */
export function refreshPopupIfStarFilterWasActive(centerBeforeChange: string | null): void {
  if (centerBeforeChange === null) return;
  const popupGuid = getCurrentPopupGuid();
  if (popupGuid === null) return;
  if (popupGuid === centerBeforeChange) return;

  const popupClose = document.querySelector<HTMLButtonElement>(POPUP_CLOSE_SELECTOR);
  if (!popupClose) return;
  if (typeof window.showInfo !== 'function') {
    console.warn(
      '[SVP drawingRestrictions] window.showInfo недоступен (gameScriptPatcher не применился) - #draw-count останется stale до следующего движения игрока',
    );
    return;
  }

  popupClose.click();
  window.showInfo(popupGuid);
}
