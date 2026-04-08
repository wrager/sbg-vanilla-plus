import { injectStyles, removeStyles } from '../../core/dom';
import { t } from '../../core/l10n';
import type { ILocalizedString } from '../../core/l10n';
import { isModuleActive } from '../../core/moduleRegistry';
import type { ICleanupSettings, ReferencesMode } from './cleanupSettings';
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
const REFERENCES_LABEL: ILocalizedString = { en: 'Keys', ru: 'Ключи' };
const REF_MODE_OFF_LABEL: ILocalizedString = { en: 'Off', ru: 'Не удалять' };
const REF_MODE_FAST_LABEL: ILocalizedString = {
  en: 'Fast (per-point limit, on discover)',
  ru: 'Быстро (лимит на точку, очистка при изучении)',
};
const REF_MODE_SLOW_LABEL: ILocalizedString = {
  en: 'Slow (allied/not allied split, manual only)',
  ru: 'Медленно (союзные/несоюзные, только вручную)',
};
const REF_FAST_LIMIT_LABEL: ILocalizedString = {
  en: 'Keys per point limit',
  ru: 'Лимит ключей на точку',
};
const REF_ALLIED_LIMIT_LABEL: ILocalizedString = {
  en: 'Allied keys limit',
  ru: 'Лимит союзных',
};
const REF_NOT_ALLIED_LIMIT_LABEL: ILocalizedString = {
  en: 'Not allied keys limit',
  ru: 'Лимит несоюзных',
};
const REF_DISABLED_HINT: ILocalizedString = {
  en: 'Enable "Favorited points" module to manage key deletion',
  ru: 'Включите модуль «Избранные точки», чтобы настроить удаление ключей',
};
const REF_SLOW_HINT: ILocalizedString = {
  en: 'Slow cleanup runs manually from the references OPS tab',
  ru: 'Медленная очистка запускается вручную через кнопку во вкладке ключей в ОРПЦ',
};

let panel: HTMLElement | null = null;
let configureButton: HTMLElement | null = null;
let moduleRowObserver: MutationObserver | null = null;
let rafId: number | null = null;

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

function createNumberInput(
  labelText: string,
  value: number,
  onChange: (value: number) => void,
): HTMLElement {
  const row = document.createElement('div');
  row.className = 'svp-cleanup-row';

  const label = document.createElement('span');
  label.className = 'svp-cleanup-row-label';
  label.textContent = labelText;

  const input = document.createElement('input');
  input.type = 'number';
  input.className = 'svp-cleanup-row-input';
  input.min = '-1';
  input.value = String(value);
  input.addEventListener('change', () => {
    const parsed = parseInt(input.value, 10);
    const clamped = Number.isFinite(parsed) && parsed >= 0 ? parsed : -1;
    input.value = String(clamped);
    onChange(clamped);
  });

  row.appendChild(label);
  row.appendChild(input);
  return row;
}

function createReferencesSection(draft: ICleanupSettings, refsEnabled: boolean): HTMLElement {
  const section = document.createElement('div');
  section.className = 'svp-cleanup-references-section';

  const title = document.createElement('div');
  title.className = 'svp-cleanup-section-title';
  title.textContent = t(REFERENCES_LABEL);
  section.appendChild(title);

  if (!refsEnabled) {
    const hint = document.createElement('div');
    hint.className = 'svp-cleanup-hint svp-cleanup-hint-warning';
    hint.textContent = t(REF_DISABLED_HINT);
    section.appendChild(hint);
    return section;
  }

  const modeGroupName = 'svp-cleanup-ref-mode';
  const modes: { value: ReferencesMode; label: ILocalizedString }[] = [
    { value: 'off', label: REF_MODE_OFF_LABEL },
    { value: 'fast', label: REF_MODE_FAST_LABEL },
    { value: 'slow', label: REF_MODE_SLOW_LABEL },
  ];

  const inputsContainer = document.createElement('div');
  inputsContainer.className = 'svp-cleanup-ref-inputs';

  function renderInputs(): void {
    inputsContainer.innerHTML = '';
    if (draft.limits.referencesMode === 'fast') {
      inputsContainer.appendChild(
        createNumberInput(t(REF_FAST_LIMIT_LABEL), draft.limits.referencesFastLimit, (value) => {
          draft.limits.referencesFastLimit = value;
        }),
      );
    } else if (draft.limits.referencesMode === 'slow') {
      inputsContainer.appendChild(
        createNumberInput(
          t(REF_ALLIED_LIMIT_LABEL),
          draft.limits.referencesAlliedLimit,
          (value) => {
            draft.limits.referencesAlliedLimit = value;
          },
        ),
      );
      inputsContainer.appendChild(
        createNumberInput(
          t(REF_NOT_ALLIED_LIMIT_LABEL),
          draft.limits.referencesNotAlliedLimit,
          (value) => {
            draft.limits.referencesNotAlliedLimit = value;
          },
        ),
      );
      const slowHint = document.createElement('div');
      slowHint.className = 'svp-cleanup-hint';
      slowHint.textContent = t(REF_SLOW_HINT);
      inputsContainer.appendChild(slowHint);
    }
  }

  for (const mode of modes) {
    const label = document.createElement('label');
    label.className = 'svp-cleanup-radio-label';

    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = modeGroupName;
    radio.value = mode.value;
    radio.checked = draft.limits.referencesMode === mode.value;
    radio.addEventListener('change', () => {
      if (radio.checked) {
        draft.limits.referencesMode = mode.value;
        renderInputs();
      }
    });

    label.appendChild(radio);
    label.appendChild(document.createTextNode(' ' + t(mode.label)));
    section.appendChild(label);
  }

  section.appendChild(inputsContainer);
  renderInputs();
  return section;
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

  const refsEnabled = isModuleActive('favoritedPoints');
  content.appendChild(createReferencesSection(draft, refsEnabled));

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
    if (rafId !== null) return;
    rafId = requestAnimationFrame(() => {
      rafId = null;
      if (!document.querySelector('.svp-cleanup-configure-button')) {
        injectConfigureButton();
      }
    });
  });
  moduleRowObserver.observe(document.body, { childList: true, subtree: true });
}

export function destroyCleanupSettingsUi(): void {
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }

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
