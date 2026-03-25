import type { IFeatureModule } from '../../core/moduleRegistry';
import { readInventoryReferences } from '../../core/inventoryCache';

const MODULE_ID = 'repairAtFullCharge';

let observer: MutationObserver | null = null;

/** Извлекает номер команды из inline-стиля `color: var(--team-N)`. */
function extractTeamFromStyle(element: Element | null): number | null {
  const style = element?.getAttribute('style') ?? '';
  const match = style.match(/--team-(\d+)/);
  return match ? Number(match[1]) : null;
}

function isSameTeam(): boolean {
  const playerTeam = extractTeamFromStyle(document.getElementById('self-info__name'));
  const pointTeam = extractTeamFromStyle(document.getElementById('i-stat__owner'));
  return playerTeam !== null && pointTeam !== null && playerTeam === pointTeam;
}

function hasKeysForPoint(): boolean {
  const pointGuid = document.querySelector('.info')?.getAttribute('data-guid');
  if (!pointGuid) return false;
  return readInventoryReferences().some((ref) => ref.l === pointGuid);
}

export const repairAtFullCharge: IFeatureModule = {
  id: MODULE_ID,
  name: { en: 'Repair at Full Charge', ru: 'Зарядка при полном заряде' },
  description: {
    en: 'Repair button stays enabled even at 100% charge — allows recharging immediately without waiting for status update',
    ru: 'Кнопка «Починить» активна даже при 100% заряде — позволяет зарядить точку сразу, не дожидаясь обновления статуса',
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
          if (isSameTeam() && hasKeysForPoint()) {
            mutation.target.removeAttribute('disabled');
          }
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
