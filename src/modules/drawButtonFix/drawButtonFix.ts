import type { IFeatureModule } from '../../core/moduleRegistry';

const MODULE_ID = 'drawButtonFix';

// Observer подписан на конкретный элемент #draw, не на document.body subtree:
// `disabled` - частый атрибут в игре, выставляется на множество кнопок (attack,
// deploy, repair, inventory items). Subtree-observer вызывал бы callback на
// каждое такое переключение и фильтровал бы вручную - O(всех изменений).
// #draw присутствует в статическом HTML игры (refs/game/index.html:299), к
// моменту bootstrap (DOMContentLoaded) уже в DOM. Прямое document.querySelector
// найдёт его сразу, без waitForElement.
let drawDisabledObserver: MutationObserver | null = null;

export const drawButtonFix: IFeatureModule = {
  id: MODULE_ID,
  name: { en: 'Draw Button Fix', ru: 'Фикс кнопки рисования' },
  description: {
    en: 'Keeps the Draw button clickable',
    ru: 'Кнопка «Рисовать» всегда активна',
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
  },
  disable() {
    drawDisabledObserver?.disconnect();
    drawDisabledObserver = null;
  },
};
