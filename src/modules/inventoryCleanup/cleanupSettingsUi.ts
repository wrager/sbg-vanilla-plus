import { injectStyles, removeStyles } from '../../core/dom';
import { t } from '../../core/l10n';
import type { ILocalizedString } from '../../core/l10n';
import type { ICleanupSettings } from './cleanupSettings';
import { loadCleanupSettings, saveCleanupSettings } from './cleanupSettings';
import styles from './styles.css?inline';

const STYLES_ID = 'inventoryCleanup';
const PANEL_ID = 'svp-cleanup-settings';

const TITLE: ILocalizedString = {
  en: 'Inventory cleanup settings',
  ru: 'Настройки очистки инвентаря',
};

const SAVE_LABEL: ILocalizedString = { en: 'Save', ru: 'Сохранить' };
const CANCEL_LABEL: ILocalizedString = { en: 'Cancel', ru: 'Отмена' };
const CONFIGURE_LABEL: ILocalizedString = { en: 'Configure', ru: 'Настроить' };
const MIN_FREE_SLOTS_LABEL: ILocalizedString = {
  en: 'Min free slots',
  ru: 'Мин. свободных слотов',
};
const CORES_LABEL: ILocalizedString = { en: 'Cores', ru: 'Ядра' };
const CATALYSERS_LABEL: ILocalizedString = { en: 'Catalysers', ru: 'Катализаторы' };
const LEVEL_LABEL: ILocalizedString = { en: 'Level', ru: 'Ур.' };
const UNLIMITED_HINT: ILocalizedString = { en: '-1 = unlimited', ru: '-1 = без лимита' };

let panel: HTMLElement | null = null;
let configureButton: HTMLElement | null = null;
let moduleRowObserver: MutationObserver | null = null;

function createLevelInputs(
  container: HTMLElement,
  titleLabel: ILocalizedString,
  values: Record<number, number>,
  onChange: (level: number, value: number) => void,
): void {
  const section = document.createElement('div');

  const sectionTitle = document.createElement('div');
  sectionTitle.className = 'svp-cleanup-section-title';
  sectionTitle.textContent = t(titleLabel);
  section.appendChild(sectionTitle);

  const grid = document.createElement('div');
  grid.className = 'svp-cleanup-level-grid';

  for (let level = 1; level <= 10; level++) {
    const cell = document.createElement('div');
    cell.className = 'svp-cleanup-level-cell';

    const label = document.createElement('span');
    label.className = 'svp-cleanup-row-label';
    label.textContent = `${t(LEVEL_LABEL)} ${level}`;

    const input = document.createElement('input');
    input.type = 'number';
    input.className = 'svp-cleanup-row-input';
    input.min = '-1';
    input.value = String(values[level] ?? -1);
    input.addEventListener('change', () => {
      const parsed = parseInt(input.value, 10);
      const clamped = Number.isFinite(parsed) && parsed >= 0 ? parsed : -1;
      input.value = String(clamped);
      onChange(level, clamped);
    });

    cell.appendChild(label);
    cell.appendChild(input);
    grid.appendChild(cell);
  }

  section.appendChild(grid);
  container.appendChild(section);
}

function buildPanel(
  settings: ICleanupSettings,
  onSave: (settings: ICleanupSettings) => void,
): HTMLElement {
  const draft = structuredClone(settings);

  const element = document.createElement('div');
  element.className = 'svp-cleanup-settings';
  element.id = PANEL_ID;

  const header = document.createElement('div');
  header.className = 'svp-cleanup-header';
  header.textContent = t(TITLE);
  element.appendChild(header);

  const content = document.createElement('div');
  content.className = 'svp-cleanup-content';

  const hint = document.createElement('div');
  hint.style.fontSize = '10px';
  hint.style.color = 'var(--text-disabled)';
  hint.textContent = t(UNLIMITED_HINT);
  content.appendChild(hint);

  const minFreeSlotsRow = document.createElement('div');
  minFreeSlotsRow.className = 'svp-cleanup-row';
  const minFreeSlotsLabel = document.createElement('span');
  minFreeSlotsLabel.className = 'svp-cleanup-row-label';
  minFreeSlotsLabel.textContent = t(MIN_FREE_SLOTS_LABEL);
  const minFreeSlotsInput = document.createElement('input');
  minFreeSlotsInput.type = 'number';
  minFreeSlotsInput.className = 'svp-cleanup-row-input';
  minFreeSlotsInput.min = '20';
  minFreeSlotsInput.value = String(draft.minFreeSlots);
  minFreeSlotsInput.addEventListener('change', () => {
    draft.minFreeSlots = Math.max(20, parseInt(minFreeSlotsInput.value, 10) || 20);
    minFreeSlotsInput.value = String(draft.minFreeSlots);
  });
  minFreeSlotsRow.appendChild(minFreeSlotsLabel);
  minFreeSlotsRow.appendChild(minFreeSlotsInput);
  content.appendChild(minFreeSlotsRow);

  createLevelInputs(content, CORES_LABEL, draft.limits.cores, (level, value) => {
    draft.limits.cores[level] = value;
  });

  createLevelInputs(content, CATALYSERS_LABEL, draft.limits.catalysers, (level, value) => {
    draft.limits.catalysers[level] = value;
  });

  // TODO: секция настройки лимита ключей — добавить после реализации модуля «Избранные точки»

  element.appendChild(content);

  const footer = document.createElement('div');
  footer.className = 'svp-cleanup-footer';

  const cancelButton = document.createElement('button');
  cancelButton.className = 'svp-cleanup-button';
  cancelButton.textContent = t(CANCEL_LABEL);
  cancelButton.addEventListener('click', () => {
    element.classList.remove('svp-open');
  });

  const saveButton = document.createElement('button');
  saveButton.className = 'svp-cleanup-button svp-cleanup-button-primary';
  saveButton.textContent = t(SAVE_LABEL);
  saveButton.addEventListener('click', () => {
    onSave(draft);
    element.classList.remove('svp-open');
  });

  footer.appendChild(cancelButton);
  footer.appendChild(saveButton);
  element.appendChild(footer);

  return element;
}

function injectConfigureButton(): void {
  const moduleRow = document.querySelector('.svp-module-row .svp-module-id');
  if (!moduleRow) return;

  const allIds = document.querySelectorAll('.svp-module-id');
  for (const idElement of allIds) {
    if (idElement.textContent === 'inventoryCleanup') {
      const row = idElement.closest('.svp-module-row');
      if (!row) continue;

      const existing = row.querySelector('.svp-cleanup-configure-button');
      if (existing) return;

      const nameLine = row.querySelector('.svp-module-name-line');
      if (!nameLine) continue;

      configureButton = document.createElement('button');
      configureButton.className = 'svp-cleanup-configure-button';
      configureButton.textContent = t(CONFIGURE_LABEL);
      configureButton.addEventListener('click', (event) => {
        event.stopPropagation();
        openSettingsPanel();
      });
      nameLine.appendChild(configureButton);
      return;
    }
  }
}

function openSettingsPanel(): void {
  if (panel) {
    panel.remove();
  }

  const settings = loadCleanupSettings();
  panel = buildPanel(settings, (updatedSettings) => {
    saveCleanupSettings(updatedSettings);
  });
  document.body.appendChild(panel);
  panel.classList.add('svp-open');
}

export function initCleanupSettingsUi(): void {
  injectStyles(styles, STYLES_ID);

  injectConfigureButton();

  // Наблюдаем document.body, потому что enable() вызывается до initSettingsUI()
  // в bootstrap — панель #svp-settings-panel ещё не существует в DOM
  moduleRowObserver = new MutationObserver(() => {
    if (!document.querySelector('.svp-cleanup-configure-button')) {
      injectConfigureButton();
    }
  });
  moduleRowObserver.observe(document.body, { childList: true, subtree: true });
}

export function destroyCleanupSettingsUi(): void {
  removeStyles(STYLES_ID);

  if (panel) {
    panel.remove();
    panel = null;
  }

  if (configureButton) {
    configureButton.remove();
    configureButton = null;
  }

  if (moduleRowObserver) {
    moduleRowObserver.disconnect();
    moduleRowObserver = null;
  }
}
