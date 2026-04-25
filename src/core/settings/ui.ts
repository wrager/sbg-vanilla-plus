import type { IFeatureModule } from '../moduleRegistry';
import { buildBugReportUrl, buildDiagnosticClipboard } from '../bugReport';
import { injectStyles } from '../dom';
import { isModuleConflictingWithCurrentGame, isModuleNativeInCurrentGame } from '../gameVersion';
import { isModuleDisallowedInCurrentHost, isSbgScout } from '../host';
import type { ILocalizedString } from '../l10n';
import { t } from '../l10n';
import { showToast } from '../toast';
import {
  loadSettings,
  saveSettings,
  isModuleEnabled,
  setModuleEnabled,
  setModuleError,
  clearModuleError,
} from './storage';

function persistOrNotify(settings: ReturnType<typeof loadSettings>): boolean {
  if (saveSettings(settings)) return true;
  showToast(
    t({
      en: 'Failed to save settings (storage full or inaccessible)',
      ru: 'Не удалось сохранить настройки (хранилище заполнено или недоступно)',
    }),
  );
  return false;
}

declare const __SVP_VERSION__: string;

const PANEL_ID = 'svp-settings-panel';
const GAME_SETTINGS_ENTRY_ID = 'svp-game-settings-entry';

const PANEL_STYLES = `
.svp-settings-panel {
  position: fixed;
  inset: 0;
  z-index: 10000;
  background: var(--background);
  color: var(--text);
  display: none;
  flex-direction: column;
  font-size: 13px;
}

.svp-settings-panel.svp-open {
  display: flex;
}

.svp-settings-header,
.svp-settings-content,
.svp-settings-footer {
  max-width: 600px;
  margin-left: auto;
  margin-right: auto;
  width: 100%;
  box-sizing: border-box;
}

.svp-settings-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 14px;
  font-weight: bold;
  padding: 4px 8px;
  flex-shrink: 0;
  border-bottom: 1px solid var(--border-transp);
}

.svp-settings-header.svp-scroll-top {
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
}

.svp-settings-content {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.svp-settings-content.svp-scroll-bottom {
  box-shadow: inset 0 -12px 8px -8px rgba(0, 0, 0, 0.2);
}

.svp-settings-panel .svp-settings-close {
  position: fixed;
  bottom: 8px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 1;
  font-size: 1.5em;
  padding: 0 .1em;
}

.svp-settings-section {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.svp-settings-section-title {
  font-size: 10px;
  font-weight: 600;
  color: var(--text);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  padding: 6px 0 2px;
  border-bottom: 1px solid var(--border-transp);
  margin-bottom: 2px;
}

.svp-module-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 4px 0;
  border-bottom: 1px solid var(--border-transp);
}

.svp-module-info {
  flex: 1;
}

.svp-module-name-line {
  display: flex;
  align-items: baseline;
  gap: 6px;
}

.svp-module-name {
  font-size: 13px;
  font-weight: 600;
}

.svp-module-id {
  font-size: 8px;
  color: var(--text-disabled);
  font-family: monospace;
}

.svp-module-desc {
  font-size: 10px;
  color: var(--text);
  margin-top: 1px;
}

.svp-module-failed {
  color: var(--accent);
  font-size: 10px;
  overflow-wrap: break-word;
  word-break: break-word;
}

.svp-module-reload {
  font-size: 10px;
  color: var(--text);
}

.svp-module-reload-text {
  font-style: italic;
}

.svp-module-row-render-error {
  padding: 4px 0;
  color: var(--accent);
  font-size: 10px;
  font-family: monospace;
  border-bottom: 1px dashed var(--border-transp);
  overflow-wrap: break-word;
  word-break: break-word;
}

.svp-module-row-host-provided .svp-module-name,
.svp-module-row-host-provided .svp-module-desc,
.svp-module-row-native-in-game .svp-module-name,
.svp-module-row-native-in-game .svp-module-desc,
.svp-module-row-conflicting-with-game .svp-module-name,
.svp-module-row-conflicting-with-game .svp-module-desc {
  color: var(--text-disabled);
}

.svp-module-row-host-provided-label,
.svp-module-row-native-in-game-label,
.svp-module-row-conflicting-with-game-label {
  font-size: 10px;
  font-style: italic;
  color: var(--text-disabled);
  margin-top: 2px;
}

.svp-module-checkbox,
.svp-toggle-all-checkbox {
  flex-shrink: 0;
  cursor: pointer;
  width: 16px;
  height: 16px;
}

.svp-settings-footer {
  flex-shrink: 0;
  padding: 6px 8px 40px;
  border-top: 1px solid var(--border-transp);
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.svp-settings-version {
  font-size: 10px;
  color: var(--text-disabled);
  font-family: monospace;
}

.svp-toggle-all {
  display: flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
  font-weight: normal;
  font-size: 11px;
  color: var(--text);
}

.svp-report-button {
  background: none;
  border: 1px solid var(--border);
  color: var(--text);
  border-radius: 4px;
  padding: 3px 10px;
  font-size: 11px;
  cursor: pointer;
}
`;

type Category = IFeatureModule['category'];

const CATEGORY_ORDER: readonly Category[] = ['ui', 'feature', 'map', 'utility', 'fix'];

const SETTINGS_TITLE: ILocalizedString = {
  en: 'SBG Vanilla+ Settings',
  ru: 'Настройки SBG Vanilla+',
};

const SETTINGS_GAME_ENTRY_LABEL: ILocalizedString = {
  en: 'SBG Vanilla+ settings',
  ru: 'Настройки SBG Vanilla+',
};

const RELOAD_LABEL: ILocalizedString = {
  en: 'Page will reload on toggle',
  ru: 'При переключении происходит перезагрузка',
};

const OPEN_LABEL: ILocalizedString = {
  en: 'Open',
  ru: 'Открыть',
};

const TOGGLE_ALL_LABEL: ILocalizedString = {
  en: 'Toggle all',
  ru: 'Переключить все',
};

const CATEGORY_LABELS: Record<Category, ILocalizedString> = {
  ui: { en: 'Interface', ru: 'Интерфейс' },
  map: { en: 'Map', ru: 'Карта' },
  feature: { en: 'Features', ru: 'Фичи' },
  utility: { en: 'Utilities', ru: 'Утилиты' },
  fix: { en: 'Bugfixes', ru: 'Багфиксы' },
};

const UNAVAILABLE_SECTION_LABEL: ILocalizedString = {
  en: 'Unavailable',
  ru: 'Недоступные',
};

/**
 * Модуль «недоступен» = его функциональность даёт хост (keepScreenOn в
 * Scout), либо перекрыта нативом текущей версии игры, либо конфликтует
 * с игрой. Такие модули собираются в отдельную секцию в конце экрана
 * настроек, чтобы не засорять основную часть, с которой пользователь
 * реально работает. Слово «недоступен» — собирательное: причины разные,
 * не все из них «устаревание».
 */
function isModuleUnavailable(moduleId: string): boolean {
  return (
    isModuleDisallowedInCurrentHost(moduleId) ||
    isModuleNativeInCurrentGame(moduleId) ||
    isModuleConflictingWithCurrentGame(moduleId)
  );
}

/**
 * Возвращает row-рендер для недоступного модуля — выбор зависит от того,
 * ПОЧЕМУ он недоступен. Для обычных (доступных) модулей возвращает null:
 * у них чекбокс-строка, которую строит createModuleRow.
 */
function createUnavailableRow(
  mod: IFeatureModule,
  errorMessage: string | null,
): HostProvidedRowResult | null {
  if (isModuleDisallowedInCurrentHost(mod.id)) {
    return createHostProvidedRow(mod, errorMessage);
  }
  if (isModuleNativeInCurrentGame(mod.id)) {
    return createNativeInGameRow(mod, errorMessage);
  }
  if (isModuleConflictingWithCurrentGame(mod.id)) {
    return createConflictingWithGameRow(mod, errorMessage);
  }
  return null;
}

function createCheckbox(checked: boolean, onChange: (enabled: boolean) => void): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.className = 'svp-module-checkbox';
  input.checked = checked;
  input.addEventListener('change', () => {
    onChange(input.checked);
  });
  return input;
}

interface ModuleRowResult {
  row: HTMLElement;
  checkbox: HTMLInputElement;
  setError: (message: string | null) => void;
}

interface HostProvidedRowResult {
  row: HTMLElement;
  setError: (message: string | null) => void;
}

const HOST_PROVIDED_LABEL: ILocalizedString = {
  en: 'Implemented in SBG Scout',
  ru: 'Реализовано в SBG Scout',
};

const NATIVE_IN_GAME_LABEL: ILocalizedString = {
  en: 'Implemented natively in the game',
  ru: 'Реализовано в игре',
};

const CONFLICTING_WITH_GAME_LABEL: ILocalizedString = {
  en: 'Conflicts with the new version of the game',
  ru: 'Конфликтует с новой версией игры',
};

/**
 * Строка для модуля, функциональность которого даёт сам хост (например,
 * keepScreenOn в SBG Scout управляется нативно Android). Чекбокса нет,
 * текст серый, есть подпись с указанием хоста.
 */
function createHostProvidedRow(
  mod: IFeatureModule,
  errorMessage: string | null,
): HostProvidedRowResult {
  const row = document.createElement('div');
  row.className = 'svp-module-row svp-module-row-host-provided';

  const info = document.createElement('div');
  info.className = 'svp-module-info';

  const nameLine = document.createElement('div');
  nameLine.className = 'svp-module-name-line';

  const name = document.createElement('div');
  name.className = 'svp-module-name';
  name.textContent = t(mod.name);

  const modId = document.createElement('div');
  modId.className = 'svp-module-id';
  modId.textContent = mod.id;

  nameLine.appendChild(name);
  nameLine.appendChild(modId);

  const desc = document.createElement('div');
  desc.className = 'svp-module-desc';
  desc.textContent = t(mod.description);

  const hostLabel = document.createElement('div');
  hostLabel.className = 'svp-module-row-host-provided-label';
  hostLabel.textContent = t(HOST_PROVIDED_LABEL);

  info.appendChild(nameLine);
  info.appendChild(desc);
  info.appendChild(hostLabel);

  const failed = document.createElement('div');
  failed.className = 'svp-module-failed';

  function setError(message: string | null): void {
    if (message) {
      failed.textContent = message;
      failed.style.display = '';
    } else {
      failed.textContent = '';
      failed.style.display = 'none';
    }
  }

  setError(errorMessage);
  info.appendChild(failed);

  row.appendChild(info);
  return { row, setError };
}

/**
 * Строка для модуля, который конфликтует с новой версией игры:
 * нативного аналога у игры нет, но её новый жест/обработчик перехватил
 * тот же DOM-элемент, что слушает наш модуль. Структурно идентична
 * native-in-game-строке, но с другой подписью — чтобы пользователь
 * различал «игра заменила» и «игра несовместима».
 */
function createConflictingWithGameRow(
  mod: IFeatureModule,
  errorMessage: string | null,
): HostProvidedRowResult {
  const row = document.createElement('div');
  row.className = 'svp-module-row svp-module-row-conflicting-with-game';

  const info = document.createElement('div');
  info.className = 'svp-module-info';

  const nameLine = document.createElement('div');
  nameLine.className = 'svp-module-name-line';

  const name = document.createElement('div');
  name.className = 'svp-module-name';
  name.textContent = t(mod.name);

  const modId = document.createElement('div');
  modId.className = 'svp-module-id';
  modId.textContent = mod.id;

  nameLine.appendChild(name);
  nameLine.appendChild(modId);

  const desc = document.createElement('div');
  desc.className = 'svp-module-desc';
  desc.textContent = t(mod.description);

  const conflictLabel = document.createElement('div');
  conflictLabel.className = 'svp-module-row-conflicting-with-game-label';
  conflictLabel.textContent = t(CONFLICTING_WITH_GAME_LABEL);

  info.appendChild(nameLine);
  info.appendChild(desc);
  info.appendChild(conflictLabel);

  const failed = document.createElement('div');
  failed.className = 'svp-module-failed';

  function setError(message: string | null): void {
    if (message) {
      failed.textContent = message;
      failed.style.display = '';
    } else {
      failed.textContent = '';
      failed.style.display = 'none';
    }
  }

  setError(errorMessage);
  info.appendChild(failed);

  row.appendChild(info);
  return { row, setError };
}

/**
 * Строка для модуля, чья функциональность реализована нативно в текущей
 * версии игры (SBG 0.6.1+). Структурно идентична host-provided-строке,
 * но с другим CSS-классом и подписью — чтобы пользователь различал
 * «сделал хост» и «сделала игра».
 */
function createNativeInGameRow(
  mod: IFeatureModule,
  errorMessage: string | null,
): HostProvidedRowResult {
  const row = document.createElement('div');
  row.className = 'svp-module-row svp-module-row-native-in-game';

  const info = document.createElement('div');
  info.className = 'svp-module-info';

  const nameLine = document.createElement('div');
  nameLine.className = 'svp-module-name-line';

  const name = document.createElement('div');
  name.className = 'svp-module-name';
  name.textContent = t(mod.name);

  const modId = document.createElement('div');
  modId.className = 'svp-module-id';
  modId.textContent = mod.id;

  nameLine.appendChild(name);
  nameLine.appendChild(modId);

  const desc = document.createElement('div');
  desc.className = 'svp-module-desc';
  desc.textContent = t(mod.description);

  const gameLabel = document.createElement('div');
  gameLabel.className = 'svp-module-row-native-in-game-label';
  gameLabel.textContent = t(NATIVE_IN_GAME_LABEL);

  info.appendChild(nameLine);
  info.appendChild(desc);
  info.appendChild(gameLabel);

  const failed = document.createElement('div');
  failed.className = 'svp-module-failed';

  function setError(message: string | null): void {
    if (message) {
      failed.textContent = message;
      failed.style.display = '';
    } else {
      failed.textContent = '';
      failed.style.display = 'none';
    }
  }

  setError(errorMessage);
  info.appendChild(failed);

  row.appendChild(info);
  return { row, setError };
}

function createModuleRow(
  mod: IFeatureModule,
  enabled: boolean,
  onChange: (enabled: boolean) => void,
  errorMessage: string | null,
): ModuleRowResult {
  const row = document.createElement('div');
  row.className = 'svp-module-row';

  const info = document.createElement('div');
  info.className = 'svp-module-info';

  const nameLine = document.createElement('div');
  nameLine.className = 'svp-module-name-line';

  const name = document.createElement('div');
  name.className = 'svp-module-name';
  name.textContent = t(mod.name);

  const modId = document.createElement('div');
  modId.className = 'svp-module-id';
  modId.textContent = mod.id;

  nameLine.appendChild(name);
  nameLine.appendChild(modId);

  const desc = document.createElement('div');
  desc.className = 'svp-module-desc';
  desc.textContent = t(mod.description);

  info.appendChild(nameLine);
  info.appendChild(desc);

  if (mod.requiresReload) {
    const reloadIndicator = document.createElement('div');
    reloadIndicator.className = 'svp-module-reload';
    reloadIndicator.textContent = '↻ ';
    const reloadText = document.createElement('span');
    reloadText.className = 'svp-module-reload-text';
    reloadText.textContent = t(RELOAD_LABEL);
    reloadIndicator.appendChild(reloadText);
    info.appendChild(reloadIndicator);
  }

  const failed = document.createElement('div');
  failed.className = 'svp-module-failed';

  row.appendChild(info);
  const checkbox = createCheckbox(enabled, onChange);
  row.appendChild(checkbox);

  function setError(message: string | null): void {
    if (message) {
      failed.textContent = message;
      failed.style.display = '';
    } else {
      failed.textContent = '';
      failed.style.display = 'none';
    }
  }

  setError(errorMessage);
  info.appendChild(failed);

  return { row, checkbox, setError };
}

function fillSection(
  section: HTMLElement,
  modules: readonly IFeatureModule[],
  category: Category,
  errorDisplay: Map<string, (message: string | null) => void>,
  checkboxMap: Map<string, HTMLInputElement>,
  onAnyToggle: () => void,
): void {
  const title = document.createElement('div');
  title.className = 'svp-settings-section-title';
  title.textContent = t(CATEGORY_LABELS[category]);
  section.appendChild(title);

  // Читаем settings один раз только для начального построения строк. Все
  // последующие мутации (клик чекбокса, запись ошибки модуля) идут через свежий
  // loadSettings() — иначе onChange перетёр бы любые изменения, произошедшие
  // в storage между построением панели и кликом (ошибки других модулей от
  // async-enable, внешняя правка, etc.).
  const initialSettings = loadSettings();

  for (const mod of modules) {
    try {
      const errorMessage = initialSettings.errors[mod.id] ?? null;
      const enabled = isModuleEnabled(initialSettings, mod.id, mod.defaultEnabled);

      // checkboxRef — late-bound ссылка на чекбокс, которую получаем СРАЗУ
      // после destructuring. Нужна чтобы onChange мог откатить checkbox.checked
      // при провале enable/disable — handleModuleToggle вызывается только при
      // change event, к этому моменту checkboxRef уже присвоен.
      let checkboxRef: HTMLInputElement | null = null;
      const { row, checkbox, setError } = createModuleRow(
        mod,
        enabled,
        (newEnabled) => {
          void handleModuleToggle(
            mod,
            newEnabled,
            (checked) => {
              if (checkboxRef) checkboxRef.checked = checked;
            },
            setError,
            onAnyToggle,
          );
        },
        errorMessage,
      );
      checkboxRef = checkbox;
      checkboxMap.set(mod.id, checkbox);
      errorDisplay.set(mod.id, setError);
      section.appendChild(row);
    } catch (error) {
      // Error boundary: падение рендера одного модуля не должно срывать рендер
      // остальных модулей и всей панели. Ставим в секцию плейсхолдер с id и
      // текстом ошибки, пишем в консоль и продолжаем цикл.
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[SVP] Ошибка рендера настроек модуля "${mod.id}":`, error);
      section.appendChild(createRenderErrorRow(mod.id, message));
    }
  }
}

async function handleModuleToggle(
  mod: IFeatureModule,
  newEnabled: boolean,
  setChecked: (checked: boolean) => void,
  setError: (message: string | null) => void,
  onAnyToggle: () => void,
): Promise<void> {
  // Каждая операция начинается со свежего loadSettings() — мы не знаем, что
  // изменилось в storage с момента построения панели (ошибки других модулей,
  // добавленные через onError в initModules, правки через иные вкладки, и т.п.).
  if (!persistOrNotify(setModuleEnabled(loadSettings(), mod.id, newEnabled))) {
    // Storage отказал — откатываем чекбокс и не трогаем модуль: пользователь
    // увидел toast и понимает, почему переключение не произошло.
    setChecked(!newEnabled);
    onAnyToggle();
    return;
  }
  if (mod.requiresReload) {
    location.hash = 'svp-settings';
    location.reload();
    return;
  }
  const phaseLabel = newEnabled ? 'включении' : 'выключении';
  const toggleAction = newEnabled ? mod.enable.bind(mod) : mod.disable.bind(mod);

  try {
    const result = toggleAction();
    if (result instanceof Promise) {
      await result;
    }
    mod.status = 'ready';
    persistOrNotify(clearModuleError(loadSettings(), mod.id));
    setError(null);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[SVP] Ошибка при ${phaseLabel} модуля "${t(mod.name)}":`, error);
    mod.status = 'failed';
    // Откат: возвращаем чекбокс и settings.modules[id] к значению ДО клика,
    // чтобы на перезагрузке SVP не пытался снова запустить упавший модуль
    // (и не зацикливался на одной и той же ошибке). Ошибку сохраняем в
    // settings.errors для отображения в UI.
    const previousEnabled = !newEnabled;
    setChecked(previousEnabled);
    persistOrNotify(setModuleEnabled(loadSettings(), mod.id, previousEnabled));
    persistOrNotify(setModuleError(loadSettings(), mod.id, message));
    setError(message);
  }
  onAnyToggle();
}

function fillUnavailableSection(
  section: HTMLElement,
  modules: readonly IFeatureModule[],
  errorDisplay: Map<string, (message: string | null) => void>,
): void {
  const title = document.createElement('div');
  title.className = 'svp-settings-section-title';
  title.textContent = t(UNAVAILABLE_SECTION_LABEL);
  section.appendChild(title);

  const initialSettings = loadSettings();

  for (const mod of modules) {
    try {
      const errorMessage = initialSettings.errors[mod.id] ?? null;
      const unavailableRow = createUnavailableRow(mod, errorMessage);
      // Фильтр в initSettingsUI гарантирует, что сюда попадают только
      // недоступные — null здесь означал бы баг фильтрации. Обрабатываем
      // через error boundary ниже.
      if (!unavailableRow) {
        throw new Error(`module "${mod.id}" classified as unavailable but no row renderer matched`);
      }
      errorDisplay.set(mod.id, unavailableRow.setError);
      section.appendChild(unavailableRow.row);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[SVP] Ошибка рендера настроек модуля "${mod.id}":`, error);
      section.appendChild(createRenderErrorRow(mod.id, message));
    }
  }
}

function createRenderErrorRow(moduleId: string, message: string): HTMLElement {
  const row = document.createElement('div');
  row.className = 'svp-module-row-render-error';
  row.dataset['svpModuleId'] = moduleId;
  row.textContent = `${moduleId}: render error — ${message}`;
  return row;
}

async function handleToggleAll(
  modules: readonly IFeatureModule[],
  enableAll: boolean,
  checkboxMap: Map<string, HTMLInputElement>,
  errorDisplay: Map<string, (message: string | null) => void>,
): Promise<void> {
  let needsReload = false;

  for (const mod of modules) {
    const checkbox = checkboxMap.get(mod.id);
    if (!checkbox || checkbox.checked === enableAll) continue;

    // Оптимистично переключаем чекбокс и storage. При провале enable/disable
    // откатимся обратно к previousEnabled (ниже в catch).
    const previousEnabled = !enableAll;
    checkbox.checked = enableAll;
    if (!persistOrNotify(setModuleEnabled(loadSettings(), mod.id, enableAll))) {
      // Storage отказал: откатываем чекбокс, для остальных модулей в батче
      // смысла продолжать нет — последующие saveSettings тоже упадут.
      checkbox.checked = previousEnabled;
      return;
    }

    if (mod.requiresReload) {
      needsReload = true;
      continue;
    }

    const phaseLabel = enableAll ? 'включении' : 'выключении';
    const toggleAction = enableAll ? mod.enable.bind(mod) : mod.disable.bind(mod);
    const setError = errorDisplay.get(mod.id);

    try {
      const result = toggleAction();
      if (result instanceof Promise) {
        await result;
      }
      mod.status = 'ready';
      persistOrNotify(clearModuleError(loadSettings(), mod.id));
      setError?.(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[SVP] Ошибка при ${phaseLabel} модуля "${t(mod.name)}":`, error);
      mod.status = 'failed';
      // Откат: возвращаем чекбокс и settings в прежнее состояние, чтобы на
      // перезагрузке SVP не зацикливался на одном и том же упавшем модуле.
      // Другие успешно обработанные модули в том же toggle-all остаются
      // в новом положении — их saveSettings уже выполнен выше.
      checkbox.checked = previousEnabled;
      persistOrNotify(setModuleEnabled(loadSettings(), mod.id, previousEnabled));
      persistOrNotify(setModuleError(loadSettings(), mod.id, message));
      setError?.(message);
    }
  }

  if (needsReload) {
    location.hash = 'svp-settings';
    location.reload();
  }
}

export function initSettingsUI(
  modules: readonly IFeatureModule[],
  errorDisplay: Map<string, (message: string | null) => void>,
): void {
  injectStyles(PANEL_STYLES, 'settings');

  const panel = document.createElement('div');
  panel.className = 'svp-settings-panel';
  panel.id = PANEL_ID;

  const header = document.createElement('div');
  header.className = 'svp-settings-header';

  const toggleAllLabel = document.createElement('label');
  toggleAllLabel.className = 'svp-toggle-all';
  const toggleAllCheckbox = document.createElement('input');
  toggleAllCheckbox.type = 'checkbox';
  toggleAllCheckbox.className = 'svp-toggle-all-checkbox';
  const toggleAllText = document.createElement('span');
  toggleAllText.textContent = t(TOGGLE_ALL_LABEL);
  toggleAllLabel.appendChild(toggleAllCheckbox);
  toggleAllLabel.appendChild(toggleAllText);
  header.appendChild(toggleAllLabel);

  const titleSpan = document.createElement('span');
  titleSpan.textContent = t(SETTINGS_TITLE);
  header.appendChild(titleSpan);

  panel.appendChild(header);

  const content = document.createElement('div');
  content.className = 'svp-settings-content';

  const checkboxMap = new Map<string, HTMLInputElement>();

  function updateMasterState(): void {
    const checkboxes = [...checkboxMap.values()];
    const checkedCount = checkboxes.filter((cb) => cb.checked).length;
    if (checkedCount === 0) {
      toggleAllCheckbox.checked = false;
      toggleAllCheckbox.indeterminate = false;
    } else if (checkedCount === checkboxes.length) {
      toggleAllCheckbox.checked = true;
      toggleAllCheckbox.indeterminate = false;
    } else {
      toggleAllCheckbox.checked = false;
      toggleAllCheckbox.indeterminate = true;
    }
  }

  // Разделяем доступные и недоступные модули: первые идут по категориям,
  // вторые собираются в отдельную секцию в конце (чтобы не мешать списку
  // модулей, с которыми пользователь реально работает). Недоступность
  // имеет разные причины — нативная реализация в игре, конфликт с игрой,
  // покрытие хостом — все они попадают в секцию недоступных.
  const regular: IFeatureModule[] = [];
  const unavailable: IFeatureModule[] = [];
  for (const mod of modules) {
    if (isModuleUnavailable(mod.id)) {
      unavailable.push(mod);
    } else {
      regular.push(mod);
    }
  }

  const grouped = new Map<Category, IFeatureModule[]>();
  for (const mod of regular) {
    const list = grouped.get(mod.category) ?? [];
    list.push(mod);
    grouped.set(mod.category, list);
  }

  for (const category of CATEGORY_ORDER) {
    const categoryModules = grouped.get(category);
    if (!categoryModules?.length) continue;

    const section = document.createElement('div');
    section.className = 'svp-settings-section';
    fillSection(section, categoryModules, category, errorDisplay, checkboxMap, updateMasterState);
    content.appendChild(section);
  }

  if (unavailable.length > 0) {
    const section = document.createElement('div');
    section.className = 'svp-settings-section svp-settings-section-unavailable';
    fillUnavailableSection(section, unavailable, errorDisplay);
    content.appendChild(section);
  }

  updateMasterState();

  toggleAllCheckbox.addEventListener('change', () => {
    void handleToggleAll(modules, toggleAllCheckbox.checked, checkboxMap, errorDisplay).then(() => {
      updateMasterState();
    });
  });

  panel.appendChild(content);

  const footer = document.createElement('div');
  footer.className = 'svp-settings-footer';

  const version = document.createElement('span');
  version.className = 'svp-settings-version';
  version.textContent = `SBG Vanilla+ v${__SVP_VERSION__}`;
  const reportButton = document.createElement('button');
  reportButton.className = 'svp-report-button';
  const reportLabel = { en: 'Report a bug', ru: 'Сообщить об ошибке' };
  reportButton.textContent = t(reportLabel);
  reportButton.addEventListener('click', () => {
    const clipboard = buildDiagnosticClipboard(modules);
    const url = buildBugReportUrl(modules);
    const copiedLabel = { en: 'Copied! Opening...', ru: 'Скопировано! Открываю...' };
    void navigator.clipboard.writeText(clipboard).then(() => {
      reportButton.textContent = t(copiedLabel);
      setTimeout(() => {
        reportButton.textContent = t(reportLabel);
      }, 2000);
    });
    window.open(url, '_blank');
  });
  footer.appendChild(reportButton);

  footer.appendChild(version);

  panel.appendChild(footer);

  const closeButton = document.createElement('button');
  closeButton.className = 'svp-settings-close';
  closeButton.textContent = '[x]';
  closeButton.addEventListener('click', (event) => {
    event.stopPropagation();
    panel.classList.remove('svp-open');
  });
  panel.appendChild(closeButton);

  function updateScrollIndicators(): void {
    const hasTop = content.scrollTop > 0;
    const hasBottom = content.scrollTop + content.clientHeight < content.scrollHeight - 1;
    header.classList.toggle('svp-scroll-top', hasTop);
    content.classList.toggle('svp-scroll-bottom', hasBottom);
  }

  content.addEventListener('scroll', updateScrollIndicators);
  const observer = new MutationObserver(updateScrollIndicators);
  observer.observe(content, { childList: true, subtree: true });

  document.body.appendChild(panel);

  // Инжектируем строку настроек SVP в игровой popup настроек
  const gameSettingsContent = document.querySelector('.settings-content');
  if (gameSettingsContent) {
    const item = document.createElement('div');
    item.className = 'settings-section__item';
    item.id = GAME_SETTINGS_ENTRY_ID;

    const label = document.createElement('span');
    label.textContent = t(SETTINGS_GAME_ENTRY_LABEL);

    const openButton = document.createElement('button');
    openButton.className = 'settings-section__button';
    openButton.textContent = t(OPEN_LABEL);
    openButton.addEventListener('click', () => {
      panel.classList.add('svp-open');
      requestAnimationFrame(updateScrollIndicators);
    });

    item.appendChild(label);
    item.appendChild(openButton);

    // В SBG Scout добавляется строка с «SBG Scout» — вставляем после неё
    let inserted = false;
    if (isSbgScout()) {
      for (const child of gameSettingsContent.querySelectorAll('.settings-section__item')) {
        if (child.textContent.includes('SBG Scout')) {
          child.after(item);
          inserted = true;
          break;
        }
      }
    }
    if (!inserted) {
      gameSettingsContent.prepend(item);
    }
  }

  if (location.hash.includes('svp-settings')) {
    panel.classList.add('svp-open');
    history.replaceState(null, '', location.pathname + location.search);
    requestAnimationFrame(updateScrollIndicators);
  }
}
