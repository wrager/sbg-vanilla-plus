import { t } from '../../core/l10n';
import {
  type FavProtectionMode,
  loadDrawingRestrictionsSettings,
  saveDrawingRestrictionsSettings,
} from './settings';

const MODULE_ID = 'drawingRestrictions';
const CONFIGURE_BUTTON_CLASS = 'svp-dr-configure-button';
const PANEL_CLASS = 'svp-dr-settings-panel';

let panel: HTMLElement | null = null;
let configureButton: HTMLElement | null = null;
let moduleRowObserver: MutationObserver | null = null;
let rafId: number | null = null;

function buildFavRow(
  labelText: string,
  mode: FavProtectionMode,
  current: FavProtectionMode,
  radioName: string,
): HTMLLabelElement {
  const row = document.createElement('label');
  row.className = 'svp-dr-settings-radio-row';
  const radio = document.createElement('input');
  radio.type = 'radio';
  radio.name = radioName;
  radio.value = mode;
  radio.checked = current === mode;
  radio.addEventListener('change', () => {
    if (!radio.checked) return;
    const updated = loadDrawingRestrictionsSettings();
    updated.favProtectionMode = mode;
    saveDrawingRestrictionsSettings(updated);
  });
  row.appendChild(radio);
  const label = document.createElement('span');
  label.textContent = ' ' + labelText;
  row.appendChild(label);
  return row;
}

function buildPanel(): HTMLElement {
  const settings = loadDrawingRestrictionsSettings();

  const element = document.createElement('div');
  element.className = PANEL_CLASS;

  const header = document.createElement('div');
  header.className = 'svp-dr-settings-header';
  header.textContent = t({
    en: 'Drawing restrictions settings',
    ru: 'Настройки ограничений рисования',
  });
  element.appendChild(header);

  const content = document.createElement('div');
  content.className = 'svp-dr-settings-content';

  // Группа radio — защита избранных
  const favGroupTitle = document.createElement('div');
  favGroupTitle.className = 'svp-dr-settings-group-title';
  favGroupTitle.textContent = t({
    en: 'Favorited points protection',
    ru: 'Защита избранных точек',
  });
  content.appendChild(favGroupTitle);

  const radioName = 'svp-dr-fav-mode';
  content.appendChild(
    buildFavRow(
      t({ en: 'No protection', ru: 'Без защиты' }),
      'off',
      settings.favProtectionMode,
      radioName,
    ),
  );
  content.appendChild(
    buildFavRow(
      t({
        en: 'Protect last key only',
        ru: 'Защищать только последний ключ',
      }),
      'protectLastKey',
      settings.favProtectionMode,
      radioName,
    ),
  );
  content.appendChild(
    buildFavRow(
      t({
        en: 'Hide all favorited targets',
        ru: 'Скрывать все избранные цели',
      }),
      'hideAllFavorites',
      settings.favProtectionMode,
      radioName,
    ),
  );

  // Числовое поле — максимальная дистанция
  const distanceRow = document.createElement('label');
  distanceRow.className = 'svp-dr-settings-number-row';
  const distanceLabel = document.createElement('span');
  distanceLabel.textContent = t({
    en: 'Max distance (m), 0 = no limit: ',
    ru: 'Макс. расстояние (м), 0 = без лимита: ',
  });
  distanceRow.appendChild(distanceLabel);
  const distanceInput = document.createElement('input');
  distanceInput.type = 'number';
  distanceInput.min = '0';
  distanceInput.step = '50';
  distanceInput.value = String(settings.maxDistanceMeters);
  distanceInput.addEventListener('change', () => {
    const raw = Number(distanceInput.value);
    const normalized = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;
    const updated = loadDrawingRestrictionsSettings();
    updated.maxDistanceMeters = normalized;
    saveDrawingRestrictionsSettings(updated);
    distanceInput.value = String(normalized);
  });
  distanceRow.appendChild(distanceInput);
  content.appendChild(distanceRow);

  element.appendChild(content);

  const footer = document.createElement('div');
  footer.className = 'svp-dr-settings-footer';
  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'svp-dr-settings-button';
  closeButton.textContent = t({ en: 'Close', ru: 'Закрыть' });
  closeButton.addEventListener('click', () => {
    element.remove();
    panel = null;
  });
  footer.appendChild(closeButton);
  element.appendChild(footer);

  return element;
}

function openPanel(): void {
  if (panel) panel.remove();
  panel = buildPanel();
  document.body.appendChild(panel);
}

function injectConfigureButton(): void {
  const allIds = document.querySelectorAll('.svp-module-id');
  for (const idElement of allIds) {
    if (idElement.textContent !== MODULE_ID) continue;
    const row = idElement.closest('.svp-module-row');
    if (!row) continue;
    if (row.querySelector(`.${CONFIGURE_BUTTON_CLASS}`)) return;
    const nameLine = row.querySelector('.svp-module-name-line');
    if (!nameLine) continue;

    configureButton = document.createElement('button');
    configureButton.className = CONFIGURE_BUTTON_CLASS;
    configureButton.textContent = t({ en: 'Configure', ru: 'Настроить' });
    configureButton.addEventListener('click', (event) => {
      event.stopPropagation();
      openPanel();
    });
    nameLine.appendChild(configureButton);
    return;
  }
}

export function installSettingsUi(): void {
  injectConfigureButton();
  moduleRowObserver = new MutationObserver(() => {
    // Debounce через rAF — аналогично favoritedPoints/settingsUi.ts.
    if (rafId !== null) return;
    rafId = requestAnimationFrame(() => {
      rafId = null;
      if (!document.querySelector(`.${CONFIGURE_BUTTON_CLASS}`)) {
        injectConfigureButton();
      }
    });
  });
  moduleRowObserver.observe(document.body, { childList: true, subtree: true });
}

export function uninstallSettingsUi(): void {
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  moduleRowObserver?.disconnect();
  moduleRowObserver = null;
  panel?.remove();
  panel = null;
  configureButton?.remove();
  configureButton = null;
}
