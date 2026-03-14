import type { FeatureModule } from '../../core/moduleRegistry';

const MODULE_ID = 'keepScreenOn';

let wakeLock: WakeLockSentinel | null = null;

async function requestWakeLock(): Promise<void> {
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => {
      wakeLock = null;
    });
  } catch (e) {
    console.warn('[SVP] Wake Lock недоступен:', e);
  }
}

function onVisibilityChange(): void {
  if (document.visibilityState === 'visible' && wakeLock === null) {
    void requestWakeLock();
  }
}

export const keepScreenOn: FeatureModule = {
  id: MODULE_ID,
  name: 'Keep Screen On',
  description: 'Экран не гаснет во время игры (Wake Lock API)',
  defaultEnabled: true,
  script: 'features',
  init() {},
  enable() {
    void requestWakeLock();
    document.addEventListener('visibilitychange', onVisibilityChange);
  },
  disable() {
    void wakeLock?.release();
    wakeLock = null;
    document.removeEventListener('visibilitychange', onVisibilityChange);
  },
};
