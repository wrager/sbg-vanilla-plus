import type { IFeatureModule } from '../../core/moduleRegistry';

const MODULE_ID = 'drawAlwaysAvailable';

let observer: MutationObserver | null = null;

export const drawAlwaysAvailable: IFeatureModule = {
  id: MODULE_ID,
  name: 'Draw Always Available',
  description:
    'Кнопка Draw всегда активна — исправляет баг игры, когда кнопка зависает в неактивном состоянии',
  defaultEnabled: true,
  script: 'features',
  init() {},
  enable() {
    observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'attributes' && (mutation.target as Element).id === 'draw') {
          (mutation.target as Element).removeAttribute('disabled');
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
