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
const BTN_ID = 'svp-settings-btn';

const PANEL_STYLES = `
.svp-settings-btn {
  width: 36px;
  height: 36px;
  border: none;
  background-color: buttonface;
  border-radius: 4px;
  font-size: 20px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

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

.svp-settings-close {
  background: none;
  border: none;
  color: var(--text);
  font-size: 18px;
  cursor: pointer;
}

.svp-settings-section {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.svp-settings-section-title {
  font-size: 10px;
  font-weight: 600;
  color: var(--text-disabled);
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
  color: var(--text-disabled);
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
  color: var(--text-disabled);
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
  padding: 6px 8px;
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

.svp-report-button {
  background: none;
  border: 1px solid var(--border);
  color: var(--text-disabled);
  border-radius: 4px;
  padding: 3px 10px;
  font-size: 11px;
  cursor: pointer;
}
`;

type Category = IFeatureModule['category'];

const CATEGORY_ORDER: readonly Category[] = ['ui', 'map', 'utility', 'fix'];

const SETTINGS_TITLE: ILocalizedString = {
  en: 'SBG Vanilla+ Settings',
  ru: 'Настройки SBG Vanilla+',
};

const RELOAD_LABEL: ILocalizedString = {
  en: 'Page will reload on toggle',
  ru: 'При переключении происходит перезагрузка',
};

const CATEGORY_LABELS: Record<Category, ILocalizedString> = {
  ui: { en: 'Interface', ru: 'Интерфейс' },
  map: { en: 'Map', ru: 'Карта' },
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

  return { row, setError };
}

function fillSection(
  section: HTMLElement,
  modules: readonly IFeatureModule[],
  category: Category,
  errorDisplay: Map<string, (message: string | null) => void>,
): void {
  const title = document.createElement('div');
  title.className = 'svp-settings-section-title';
  title.textContent = t(CATEGORY_LABELS[category]);
  section.appendChild(title);

  let settings = loadSettings();

  for (const mod of modules) {
    const enabled = isModuleEnabled(settings, mod.id, mod.defaultEnabled);
    const errorMessage = settings.errors[mod.id] ?? null;

    const { row, setError } = createModuleRow(
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
      },
      errorMessage,
    );
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
  const titleSpan = document.createElement('span');
  titleSpan.textContent = t(SETTINGS_TITLE);
  header.appendChild(titleSpan);

  const closeBtn = document.createElement('button');
  closeBtn.className = 'svp-settings-close';
  closeBtn.textContent = '✕';
  closeBtn.addEventListener('click', () => {
    panel.classList.remove('svp-open');
  });
  header.appendChild(closeBtn);
  panel.appendChild(header);

  const content = document.createElement('div');
  content.className = 'svp-settings-content';

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
    fillSection(section, categoryModules, category, errorDisplay);
    content.appendChild(section);
  }

  panel.appendChild(content);

  const footer = document.createElement('div');
  footer.className = 'svp-settings-footer';

  const version = document.createElement('span');
  version.className = 'svp-settings-version';
  version.textContent = `SBG Vanilla+ v${__SVP_VERSION__}`;
  footer.appendChild(version);

  const reportButton = document.createElement('button');
  reportButton.className = 'svp-report-button';
  const reportLabel = { en: 'Report Bug', ru: 'Сообщить об ошибке' };
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

  panel.appendChild(footer);

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

  const btn = document.createElement('button');
  btn.className = 'svp-settings-btn';
  btn.id = BTN_ID;
  btn.textContent = '⚙';
  btn.title = t(SETTINGS_TITLE);
  btn.addEventListener('click', () => {
    panel.classList.toggle('svp-open');
    requestAnimationFrame(updateScrollIndicators);
  });

  const container = document.querySelector('.bottom-container');
  if (container) {
    container.appendChild(btn);
  } else {
    document.body.appendChild(btn);
  }

  if (location.hash.includes('svp-settings')) {
    panel.classList.add('svp-open');
    history.replaceState(null, '', location.pathname + location.search);
    requestAnimationFrame(updateScrollIndicators);
  }
}
