import { isModuleNativeInCurrentGame } from './gameVersion';
import { isModuleDisallowedInCurrentHost } from './host';
import type { IFeatureModule } from './moduleRegistry';
import { initModules, registerModules } from './moduleRegistry';
import {
  loadSettings,
  saveSettings,
  persistModuleDefaults,
  isModuleEnabled,
  setModuleError,
  clearModuleError,
} from './settings/storage';
import { initSettingsUI } from './settings/ui';
import { injectStyles } from './dom';
import toastStyles from './toast.css?inline';

// Guard от повторного вызова bootstrap(). Повторный init/enable уже
// инициализированных модулей привёл бы к двойным side-effects (например,
// двойной выдаче dragPanControl или двойному оборачиванию view.calculateExtent
// при регрессе в модулях) и к созданию дубликата settings panel в DOM.
// Сценарий повторного вызова в проде: SPA-перенавигация, которая заново
// триггерит DOMContentLoaded; нештатные перезапуски entry.ts.
let bootstrapped = false;

/** Сбрасывает guard. Только для тестов. */
export function resetBootstrapForTest(): void {
  bootstrapped = false;
}

export function bootstrap(modules: IFeatureModule[]): void {
  if (bootstrapped) {
    console.warn('[SVP] bootstrap() вызван повторно — игнорирую. Модули уже инициализированы.');
    return;
  }
  bootstrapped = true;

  injectStyles(toastStyles, 'svp-toast');
  registerModules(modules);
  let settings = loadSettings();
  settings = persistModuleDefaults(settings, modules);

  const errorDisplay = new Map<string, (message: string | null) => void>();

  initModules(
    modules,
    (id) => {
      // Модули, несовместимые с текущим хостом (например, keepScreenOn в
      // SBG Scout), подавляются на уровне runtime — persisted settings не
      // трогаем, иначе при возврате в обычный браузер пользовательский
      // выбор (или defaultEnabled) оказался бы затёрт записью false.
      if (isModuleDisallowedInCurrentHost(id)) return false;
      // Модули, чья функциональность реализована нативно в текущей версии
      // игры (SBG 0.6.1+ — избранное ключей, серверная garbage-чистка,
      // нативные жесты карты и т. д.), тоже подавляются на уровне runtime.
      // Persisted settings не трогаем по той же причине, что и для host.
      if (isModuleNativeInCurrentGame(id)) return false;
      const mod = modules.find((m) => m.id === id);
      return isModuleEnabled(settings, id, mod?.defaultEnabled ?? true);
    },
    (id, message) => {
      settings = setModuleError(settings, id, message);
      saveSettings(settings);
      errorDisplay.get(id)?.(message);
    },
    (id) => {
      if (settings.errors[id]) {
        settings = clearModuleError(settings, id);
        saveSettings(settings);
        errorDisplay.get(id)?.(null);
      }
    },
  );

  saveSettings(settings);
  initSettingsUI(modules, errorDisplay);
}
