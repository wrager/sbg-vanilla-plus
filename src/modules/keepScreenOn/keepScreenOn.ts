import type { IFeatureModule } from '../../core/moduleRegistry';

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
    void requestWakeLock();
    document.addEventListener('visibilitychange', onVisibilityChange);
  },
  disable() {
    void wakeLock?.release();
    wakeLock = null;
    document.removeEventListener('visibilitychange', onVisibilityChange);
  },
};
