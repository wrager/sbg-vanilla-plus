import type { IFeatureModule } from '../../core/moduleRegistry';

const MODULE_ID = 'keepScreenOn';

let wakeLock: WakeLockSentinel | null = null;

async function requestWakeLock(): Promise<void> {
  wakeLock = await navigator.wakeLock.request('screen');
  wakeLock.addEventListener('release', () => {
    wakeLock = null;
  });
}

function onVisibilityChange(): void {
  if (document.visibilityState === 'visible' && wakeLock === null) {
    void requestWakeLock().catch(() => {});
  }
}

export const keepScreenOn: IFeatureModule = {
  id: MODULE_ID,
  name: { en: 'Keep Screen On', ru: 'Экран не гаснет' },
  description: {
    en: 'Keeps screen awake during gameplay (Wake Lock API)',
    ru: 'Экран не гаснет во время игры (Wake Lock API)',
  },
  defaultEnabled: true,
  category: 'feature',
  init() {},
  enable() {
    document.addEventListener('visibilitychange', onVisibilityChange);
    return requestWakeLock();
  },
  disable() {
    document.removeEventListener('visibilitychange', onVisibilityChange);
    const released = wakeLock?.release();
    wakeLock = null;
    return released;
  },
};
