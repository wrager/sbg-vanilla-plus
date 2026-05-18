import { getCurrentPopupGuid } from './drawFilter';

const POPUP_CLOSE_SELECTOR = '.info .popup-close';

/**
 * Закрывает попап точки и переоткрывает его через window.showInfo(guid),
 * чтобы заставить игру сделать свежий /api/draw и обновить #draw-count с
 * point_state.possible_lines под актуальные правила drawFilter.
 *
 * Триггеры: изменение настроек drawingRestrictions при открытом попапе
 * (новые правила не применяются к уже полученному списку целей, игра держит
 * stale possible_lines в closure'е), runtime enable модуля при открытом
 * попапе (список собран без фильтра), сброс центра звезды с открытым попапом
 * другой точки.
 *
 * No-op в трёх случаях: попап не открыт или скрыт через .hidden;
 * .popup-close недоступен; window.showInfo не экспонирован
 * gameScriptPatcher'ом (фолбэк - оставляем попап открытым, иначе пользователь
 * потеряет контекст без возможности переоткрытия).
 */
export function refreshOpenPopup(): void {
  const popupGuid = getCurrentPopupGuid();
  if (popupGuid === null) return;

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
