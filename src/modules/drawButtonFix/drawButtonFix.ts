import type { IFeatureModule } from '../../core/moduleRegistry';

const MODULE_ID = 'drawButtonFix';

let observer: MutationObserver | null = null;

export const drawButtonFix: IFeatureModule = {
  id: MODULE_ID,
  name: { en: 'Draw Button Fix', ru: 'Фикс кнопки рисования' },
  description: {
    en: 'Draw button is always active — fixes a game bug where the button gets stuck in disabled state',
    ru: 'Кнопка Draw всегда активна — исправляет баг игры, когда кнопка зависает в неактивном состоянии',
  },
  defaultEnabled: true,
  script: 'features',
  init() {},
  enable() {
    observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (
          mutation.type === 'attributes' &&
          mutation.target instanceof Element &&
          mutation.target.id === 'draw'
        ) {
          mutation.target.removeAttribute('disabled');
        }
      }
    });
    observer.observe(document.body, {
      subtree: true,
      attributes: true,
      attributeFilter: ['disabled'],
    });
  },
  disable() {
    observer?.disconnect();
    observer = null;
  },
};
