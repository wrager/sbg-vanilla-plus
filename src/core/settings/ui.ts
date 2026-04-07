import type { IFeatureModule } from '../moduleRegistry';
import { runModuleAction } from '../moduleRegistry';
import { buildBugReportUrl, buildDiagnosticClipboard } from '../bugReport';
import { injectStyles } from '../dom';
import type { ILocalizedString } from '../l10n';
import { t } from '../l10n';
import {
  loadSettings,
  saveSettings,
  isModuleEnabled,
  setModuleEnabled,
  setModuleError,
  clearModuleError,
} from './storage';

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

.svp-module-checkbox {
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

  let settings = loadSettings();

  for (const mod of modules) {
    const enabled = isModuleEnabled(settings, mod.id, mod.defaultEnabled);
    const errorMessage = settings.errors[mod.id] ?? null;

    const { row, checkbox, setError } = createModuleRow(
      mod,
      enabled,
      (newEnabled) => {
        settings = setModuleEnabled(settings, mod.id, newEnabled);
        saveSettings(settings);
        if (mod.requiresReload) {
          location.hash = 'svp-settings';
          location.reload();
          return;
        }
        const phaseLabel = newEnabled ? 'включении' : 'выключении';
        function onToggleError(e: unknown): void {
          const message = e instanceof Error ? e.message : String(e);
          console.error(`[SVP] Ошибка при ${phaseLabel} модуля "${t(mod.name)}":`, e);
          mod.status = 'failed';
          settings = setModuleError(settings, mod.id, message);
          saveSettings(settings);
          setError(message);
        }

        const toggleAction = newEnabled ? mod.enable.bind(mod) : mod.disable.bind(mod);
        void runModuleAction(toggleAction, onToggleError);
        if (mod.status !== 'failed') {
          mod.status = 'ready';
          settings = clearModuleError(settings, mod.id);
          saveSettings(settings);
          setError(null);
        }
        onAnyToggle();
      },
      errorMessage,
    );
    checkboxMap.set(mod.id, checkbox);
    errorDisplay.set(mod.id, setError);
    section.appendChild(row);
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
  toggleAllCheckbox.className = 'svp-module-checkbox';
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

  const grouped = new Map<Category, IFeatureModule[]>();
  for (const mod of modules) {
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

  updateMasterState();

  toggleAllCheckbox.addEventListener('change', () => {
    const enableAll = toggleAllCheckbox.checked;
    let settings = loadSettings();
    let needsReload = false;

    for (const mod of modules) {
      const checkbox = checkboxMap.get(mod.id);
      if (!checkbox || checkbox.checked === enableAll) continue;

      checkbox.checked = enableAll;
      settings = setModuleEnabled(settings, mod.id, enableAll);

      if (mod.requiresReload) {
        needsReload = true;
        continue;
      }

      const phaseLabel = enableAll ? 'включении' : 'выключении';
      function onToggleError(e: unknown): void {
        const message = e instanceof Error ? e.message : String(e);
        console.error(`[SVP] Ошибка при ${phaseLabel} модуля "${t(mod.name)}":`, e);
        mod.status = 'failed';
        settings = setModuleError(settings, mod.id, message);
        const setError = errorDisplay.get(mod.id);
        setError?.(message);
      }

      const toggleAction = enableAll ? mod.enable.bind(mod) : mod.disable.bind(mod);
      void runModuleAction(toggleAction, onToggleError);
      if (mod.status !== 'failed') {
        mod.status = 'ready';
        settings = clearModuleError(settings, mod.id);
        const setError = errorDisplay.get(mod.id);
        setError?.(null);
      }
    }

    saveSettings(settings);
    updateMasterState();

    if (needsReload) {
      location.hash = 'svp-settings';
      location.reload();
    }
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
    label.textContent = t(SETTINGS_TITLE);

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
    const isSbgScout = navigator.userAgent.includes('SbgScout/');
    let inserted = false;
    if (isSbgScout) {
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
