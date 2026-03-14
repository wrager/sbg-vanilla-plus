import type { FeatureModule } from '../moduleRegistry';
import { injectStyles } from '../dom';
import { loadSettings, saveSettings, isModuleEnabled, setModuleEnabled } from './storage';

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
  overflow-y: auto;
  padding: 16px;
  display: none;
  flex-direction: column;
  gap: 12px;
}

.svp-settings-panel.svp-open {
  display: flex;
}

.svp-settings-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 18px;
  font-weight: bold;
}

.svp-settings-close {
  background: none;
  border: none;
  color: #eee;
  font-size: 24px;
  cursor: pointer;
}

.svp-settings-section {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.svp-settings-section-title {
  font-size: 13px;
  font-weight: 600;
  color: #888;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  padding: 12px 0 4px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.15);
  margin-bottom: 4px;
}

.svp-module-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.svp-module-info {
  flex: 1;
}

.svp-module-name {
  font-weight: 600;
}

.svp-module-desc {
  font-size: 12px;
  color: #aaa;
  margin-top: 2px;
}

.svp-module-failed {
  color: #ff6b6b;
  font-size: 12px;
}

.svp-toggle {
  position: relative;
  width: 44px;
  height: 24px;
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
  border-radius: 12px;
  cursor: pointer;
  transition: background 0.2s;
}

.svp-toggle-slider::before {
  content: '';
  position: absolute;
  width: 18px;
  height: 18px;
  left: 3px;
  top: 3px;
  background: #fff;
  border-radius: 50%;
  transition: transform 0.2s;
}

.svp-toggle input:checked + .svp-toggle-slider {
  background: #4caf50;
}

.svp-toggle input:checked + .svp-toggle-slider::before {
  transform: translateX(20px);
}
`;

const SECTION_LABELS: Record<string, string> = {
  style: 'Внешний вид',
  features: 'Функции',
};

function createToggle(checked: boolean, onChange: (enabled: boolean) => void): HTMLElement {
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
  return label;
}

function createModuleRow(
  mod: FeatureModule,
  enabled: boolean,
  onChange: (enabled: boolean) => void,
): HTMLElement {
  const row = document.createElement('div');
  row.className = 'svp-module-row';

  const info = document.createElement('div');
  info.className = 'svp-module-info';

  const name = document.createElement('div');
  name.className = 'svp-module-name';
  name.textContent = mod.name;

  const desc = document.createElement('div');
  desc.className = 'svp-module-desc';
  desc.textContent = mod.description;

  info.appendChild(name);
  info.appendChild(desc);

  if (mod.status === 'failed') {
    const failed = document.createElement('div');
    failed.className = 'svp-module-failed';
    failed.textContent = '(ошибка загрузки)';
    info.appendChild(failed);
  }

  row.appendChild(info);
  row.appendChild(createToggle(enabled, onChange));
  return row;
}

function createSection(modules: readonly FeatureModule[], scriptType: string): HTMLElement {
  const section = document.createElement('div');
  section.className = 'svp-settings-section';

  const title = document.createElement('div');
  title.className = 'svp-settings-section-title';
  title.textContent = SECTION_LABELS[scriptType] ?? scriptType;
  section.appendChild(title);

  let settings = loadSettings();

  for (const mod of modules) {
    const enabled = isModuleEnabled(settings, mod.id, mod.defaultEnabled);
    const row = createModuleRow(mod, enabled, (newEnabled) => {
      settings = setModuleEnabled(settings, mod.id, newEnabled);
      saveSettings(settings);
      try {
        if (newEnabled) {
          mod.enable();
        } else {
          mod.disable();
        }
      } catch (e) {
        console.warn(`[SVP] Ошибка переключения модуля "${mod.name}":`, e);
      }
    });
    section.appendChild(row);
  }

  return section;
}

export function initSettingsUI(modules: readonly FeatureModule[]): void {
  injectStyles(PANEL_STYLES, 'settings');

  const scriptType = modules[0]?.script ?? 'features';
  const existingPanel = document.getElementById(PANEL_ID);

  if (existingPanel) {
    existingPanel.appendChild(createSection(modules, scriptType));
    return;
  }

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

  panel.appendChild(createSection(modules, scriptType));

  document.body.appendChild(panel);

  const btn = document.createElement('button');
  btn.className = 'svp-settings-btn';
  btn.id = BTN_ID;
  btn.textContent = '⚙';
  btn.title = 'SBG Vanilla+ Settings';
  btn.addEventListener('click', () => {
    panel.classList.toggle('svp-open');
  });

  const container = document.querySelector('.bottom-container');
  if (container) {
    container.appendChild(btn);
  } else {
    document.body.appendChild(btn);
  }
}
