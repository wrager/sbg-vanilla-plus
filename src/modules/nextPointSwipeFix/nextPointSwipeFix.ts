import type { IFeatureModule } from '../../core/moduleRegistry';
import { installClickFallback } from '../../core/clickSynthesis';

const MODULE_ID = 'nextPointSwipeFix';

// Кнопки попапа точки, на которые WebView/Chrome probabilistically не
// синтезирует click event после массивного DOM mutation burst в showInfo.
// Этот burst происходит каждый раз при переключении на следующую точку -
// неважно, через свайп (нативный или наш) или через openPointPopup.
// Подробности механизма в src/core/clickSynthesis.ts.
const TARGET_BUTTON_SELECTORS = ['#draw', '#discover'];

const installedFallbacks = new Map<HTMLElement, () => void>();

export const nextPointSwipeFix: IFeatureModule = {
  id: MODULE_ID,
  name: {
    en: 'Next point swipe fix',
    ru: 'Фикс кнопок после переключения точки',
  },
  description: {
    en: 'Restores click events on Draw and Discover buttons that browser probabilistically suppresses after switching to the next point',
    ru: 'Восстанавливает срабатывание кнопок «Рисовать» и «Изучить» после переключения на следующую точку, которые браузер иногда подавляет',
  },
  defaultEnabled: true,
  category: 'fix',
  init() {},
  enable() {
    for (const selector of TARGET_BUTTON_SELECTORS) {
      const element = document.querySelector(selector);
      if (!(element instanceof HTMLElement)) continue;
      if (installedFallbacks.has(element)) continue;
      installedFallbacks.set(element, installClickFallback(element));
    }
  },
  disable() {
    for (const uninstall of installedFallbacks.values()) {
      uninstall();
    }
    installedFallbacks.clear();
  },
};
