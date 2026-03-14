import type { IFeatureModule } from '../moduleRegistry';
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

const PANEL_ID = 'svp-settings-panel';
const BTN_ID = 'svp-settings-btn';

const PANEL_STYLES = `
.svp-settings-btn {
  width: 36px;
  height: 36px;
  border: none;
  background: #414141;
  border-radius: 50%;
  color: #fff;
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
  background: #1a1a2e;
  color: #eee;
  display: none;
  flex-direction: column;
  font-size: 13px;
}

.svp-settings-panel.svp-open {
  display: flex;
}

.svp-settings-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 14px;
  font-weight: bold;
  padding: 4px 8px;
  flex-shrink: 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.15);
}

.svp-settings-header.svp-scroll-top {
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.5);
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
  box-shadow: inset 0 -12px 8px -8px rgba(0, 0, 0, 0.5);
}

.svp-settings-close {
  background: none;
  border: none;
  color: #eee;
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
  color: #888;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  padding: 6px 0 2px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.15);
  margin-bottom: 2px;
}

.svp-module-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 4px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
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
  color: #666;
  font-family: monospace;
}

.svp-module-desc {
  font-size: 10px;
  color: #aaa;
  margin-top: 1px;
}

.svp-module-failed {
  color: #ff6b6b;
  font-size: 10px;
}

.svp-module-reload {
  font-size: 14px;
  flex-shrink: 0;
}

.svp-toggle {
  position: relative;
  width: 28px;
  height: 16px;
  flex-shrink: 0;
}

.svp-toggle input {
  opacity: 0;
  width: 0;
  height: 0;
}

.svp-toggle-slider {
  position: absolute;
  inset: 0;
  background: #444;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.2s;
}

.svp-toggle-slider::before {
  content: '';
  position: absolute;
  width: 12px;
  height: 12px;
  left: 2px;
  top: 2px;
  background: #fff;
  border-radius: 50%;
  transition: transform 0.2s;
}

.svp-toggle input:checked + .svp-toggle-slider {
  background: #4caf50;
}

.svp-toggle input:checked + .svp-toggle-slider::before {
  transform: translateX(12px);
}
`;

type Category = IFeatureModule['category'];

const CATEGORY_ORDER: readonly Category[] = ['style', 'feature', 'bugfix'];

const CATEGORY_LABELS: Record<Category, ILocalizedString> = {
  style: { en: 'Styling', ru: 'Стилизация' },
  feature: { en: 'Features', ru: 'Фичи' },
  bugfix: { en: 'Bugfixes', ru: 'Багфиксы' },
};

interface ToggleHandle {
  element: HTMLElement;
  setDisabled: (disabled: boolean) => void;
}

function createToggle(checked: boolean, onChange: (enabled: boolean) => void): ToggleHandle {
  const label = document.createElement('label');
  label.className = 'svp-toggle';

  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = checked;
  input.addEventListener('change', () => {
    onChange(input.checked);
  });

  const slider = document.createElement('span');
  slider.className = 'svp-toggle-slider';

  label.appendChild(input);
  label.appendChild(slider);

  return {
    element: label,
    setDisabled(disabled: boolean) {
      input.disabled = disabled;
      label.style.opacity = disabled ? '0.4' : '';
      label.style.pointerEvents = disabled ? 'none' : '';
    },
  };
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

  const failed = document.createElement('div');
  failed.className = 'svp-module-failed';

  row.appendChild(info);
  if (mod.requiresReload) {
    const reload = document.createElement('span');
    reload.className = 'svp-module-reload';
    reload.textContent = '🔄';
    row.appendChild(reload);
  }
  const toggle = createToggle(enabled, onChange);
  row.appendChild(toggle.element);

  function setError(message: string | null): void {
    if (message) {
      failed.textContent = message;
      failed.style.display = '';
      toggle.setDisabled(true);
    } else {
      failed.textContent = '';
      failed.style.display = 'none';
      toggle.setDisabled(false);
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
        try {
          if (newEnabled) {
            mod.enable();
          } else {
            mod.disable();
          }
          mod.status = 'ready';
          settings = clearModuleError(settings, mod.id);
          saveSettings(settings);
          setError(null);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.warn(`[SVP] Ошибка переключения модуля "${t(mod.name)}":`, e);
          mod.status = 'failed';
          settings = setModuleError(settings, mod.id, msg);
          saveSettings(settings);
          setError(msg);
        }
      },
      errorMessage,
    );
    section.appendChild(row);
  }
}

export function initSettingsUI(modules: readonly IFeatureModule[]): void {
  injectStyles(PANEL_STYLES, 'settings');

  const panel = document.createElement('div');
  panel.className = 'svp-settings-panel';
  panel.id = PANEL_ID;

  const header = document.createElement('div');
  header.className = 'svp-settings-header';
  header.innerHTML = '<span>SBG Vanilla+ Settings</span>';

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
    fillSection(section, categoryModules, category);
    content.appendChild(section);
  }

  panel.appendChild(content);

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
  btn.title = 'SBG Vanilla+ Settings';
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
