import type { IFeatureModule } from '../../core/moduleRegistry';

const MODULE_ID = 'drawButtonFix';

let observer: MutationObserver | null = null;

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
    observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type !== 'attributes') continue;
        if (!(mutation.target instanceof HTMLElement)) continue;
        if (mutation.attributeName === 'disabled' && mutation.target.id === 'draw') {
          mutation.target.removeAttribute('disabled');
        } else if (
          mutation.attributeName === 'data-guid' &&
          mutation.target.classList.contains('info')
        ) {
          invalidateDrawCount();
        }
      }
    });
    observer.observe(document.body, {
      subtree: true,
      attributes: true,
      attributeFilter: ['disabled', 'data-guid'],
    });
  },
  disable() {
    observer?.disconnect();
    observer = null;
  },
};
