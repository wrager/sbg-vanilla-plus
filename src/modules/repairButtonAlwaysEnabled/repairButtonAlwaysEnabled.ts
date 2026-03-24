import type { IFeatureModule } from '../../core/moduleRegistry';

const MODULE_ID = 'repairButtonAlwaysEnabled';

let observer: MutationObserver | null = null;

export const repairButtonAlwaysEnabled: IFeatureModule = {
  id: MODULE_ID,
  name: { en: 'Repair Always Enabled', ru: 'Зарядка всегда доступна' },
  description: {
    en: 'Repair button is always enabled — allows recharging a point immediately without waiting for status update',
    ru: 'Кнопка «Починить» всегда активна — позволяет зарядить точку сразу, не дожидаясь обновления статуса',
  },
  defaultEnabled: true,
  category: 'feature',
  init() {},
  enable() {
    observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (
          mutation.type === 'attributes' &&
          mutation.target instanceof Element &&
          mutation.target.id === 'repair'
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
