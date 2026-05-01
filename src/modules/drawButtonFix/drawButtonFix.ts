import type { IFeatureModule } from '../../core/moduleRegistry';
import { POINT_POPUP_SELECTOR } from '../../core/pointPopup';

const MODULE_ID = 'drawButtonFix';

// Каждый observer подписан на свой конкретный элемент (а не на document.body
// subtree), потому что:
// 1. `disabled` и `data-guid` - частые атрибуты в игре. `disabled` ставится на
//    множество кнопок (attack, deploy, repair, inventory items), `data-guid`
//    кроме .info живёт на .draw-slider-wrp, .attack-slider-wrp и в инвентаре.
//    Subtree-observer на document.body вызывал бы callback на каждый такой
//    переключение и фильтровал бы вручную - O(всех изменений).
// 2. #draw и .info присутствуют в статическом HTML игры (refs/game/index.html:
//    299, 360), к моменту bootstrap (DOMContentLoaded) уже в DOM. Прямое
//    document.querySelector найдёт их сразу, без waitForElement.
let drawDisabledObserver: MutationObserver | null = null;
let infoGuidObserver: MutationObserver | null = null;

/**
 * Сбрасывает текст счётчика #draw-count в '[...]'. Игра в showInfo
 * (refs/game/script.js:2270) пропускает refetch draw, если #draw-count уже
 * содержит `[<digits>]` - оптимизация не различает «загружено для текущей
 * точки» и «загружено для прошлой». При свайпе на следующую точку счётчик
 * остаётся от старой, и кэш `point_state.possible_lines` не обновляется -
 * пользователь видит цели предыдущей точки в Draw-карусели. Сбрасываем
 * текст в non-matching - игра переходит в else-ветку и отправляет fresh
 * apiQuery('draw', { guid: новый }).
 */
function invalidateDrawCount(): void {
  const counter = document.querySelector('#draw-count');
  if (counter) counter.textContent = '[...]';
}

export const drawButtonFix: IFeatureModule = {
  id: MODULE_ID,
  name: { en: 'Draw Button Fix', ru: 'Фикс кнопки рисования' },
  description: {
    en: 'Keeps the Draw button clickable and tied to the current point',
    ru: 'Кнопка «Рисовать» всегда активна и отражает текущую точку',
  },
  defaultEnabled: true,
  category: 'fix',
  init() {},
  enable() {
    const drawButton = document.querySelector('#draw');
    if (drawButton instanceof HTMLElement) {
      drawDisabledObserver = new MutationObserver(() => {
        drawButton.removeAttribute('disabled');
      });
      drawDisabledObserver.observe(drawButton, {
        attributes: true,
        attributeFilter: ['disabled'],
      });
    }

    const infoPopup = document.querySelector(POINT_POPUP_SELECTOR);
    if (infoPopup instanceof HTMLElement) {
      infoGuidObserver = new MutationObserver(invalidateDrawCount);
      infoGuidObserver.observe(infoPopup, {
        attributes: true,
        attributeFilter: ['data-guid'],
      });
    }
  },
  disable() {
    drawDisabledObserver?.disconnect();
    drawDisabledObserver = null;
    infoGuidObserver?.disconnect();
    infoGuidObserver = null;
  },
};
