import { exportToJson, importFromJson, getFavoritesCount } from '../../core/favoritesStore';
import { t } from '../../core/l10n';
import { loadFavoritedPointsSettings, saveFavoritedPointsSettings } from './settings';

const MODULE_ID = 'favoritedPoints';
const CONFIGURE_BUTTON_CLASS = 'svp-fav-configure-button';
const PANEL_CLASS = 'svp-fav-settings-panel';

let panel: HTMLElement | null = null;
let configureButton: HTMLElement | null = null;
let moduleRowObserver: MutationObserver | null = null;

function buildPanel(): HTMLElement {
  const settings = loadFavoritedPointsSettings();

  const element = document.createElement('div');
  element.className = PANEL_CLASS;

  const header = document.createElement('div');
  header.className = 'svp-fav-settings-header';
  header.textContent = t({ en: 'Favorited points settings', ru: 'Настройки избранных точек' });
  element.appendChild(header);

  const content = document.createElement('div');
  content.className = 'svp-fav-settings-content';

  // Чекбокс hideLastFavRef
  const hideLastRow = document.createElement('label');
  hideLastRow.className = 'svp-fav-settings-checkbox-row';
  const hideLastCheckbox = document.createElement('input');
  hideLastCheckbox.type = 'checkbox';
  hideLastCheckbox.checked = settings.hideLastFavRef;
  hideLastCheckbox.addEventListener('change', () => {
    const updated = loadFavoritedPointsSettings();
    updated.hideLastFavRef = hideLastCheckbox.checked;
    saveFavoritedPointsSettings(updated);
  });
  hideLastRow.appendChild(hideLastCheckbox);
  const hideLastLabel = document.createElement('span');
  hideLastLabel.textContent = t({
    en: ' Protect last key of favorited point when drawing',
    ru: ' Защищать последний ключ от избранной точки при рисовании',
  });
  hideLastRow.appendChild(hideLastLabel);
  content.appendChild(hideLastRow);

  // Счётчик избранных
  const counter = document.createElement('div');
  counter.className = 'svp-fav-settings-counter';
  counter.textContent =
    t({ en: 'Favorited points total: ', ru: 'Всего избранных точек: ' }) +
    String(getFavoritesCount());
  content.appendChild(counter);

  // Импорт из JSON (сверху, чтобы был ближе к счётчику — видно эффект замены).
  const importWrapper = document.createElement('div');
  importWrapper.className = 'svp-fav-settings-import-wrapper';
  const importLabel = document.createElement('label');
  importLabel.className = 'svp-fav-settings-button';
  importLabel.textContent = t({ en: '⬆️ Import from JSON', ru: '⬆️ Импорт из JSON' });
  const importInput = document.createElement('input');
  importInput.type = 'file';
  importInput.accept = 'application/json,.json';
  importInput.style.display = 'none';
  importInput.addEventListener('change', () => {
    const file = importInput.files?.[0];
    if (file) {
      void doImport(file, counter);
    }
    importInput.value = '';
  });
  importLabel.appendChild(importInput);
  importWrapper.appendChild(importLabel);
  content.appendChild(importWrapper);

  const importWarning = document.createElement('div');
  importWarning.className = 'svp-fav-settings-warning';
  importWarning.textContent = t({
    en: '⚠️ Current favorites list will be completely replaced',
    ru: '⚠️ Текущий список избранного будет полностью перезаписан',
  });
  content.appendChild(importWarning);

  // Экспорт (скачать JSON).
  const exportButton = document.createElement('button');
  exportButton.type = 'button';
  exportButton.className = 'svp-fav-settings-button';
  exportButton.textContent = t({ en: '⬇️ Download JSON', ru: '⬇️ Скачать JSON' });
  exportButton.addEventListener('click', () => {
    void downloadExport();
  });
  content.appendChild(exportButton);

  element.appendChild(content);

  const footer = document.createElement('div');
  footer.className = 'svp-fav-settings-footer';
  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'svp-fav-settings-button';
  closeButton.textContent = t({ en: 'Close', ru: 'Закрыть' });
  closeButton.addEventListener('click', () => {
    element.remove();
    panel = null;
  });
  footer.appendChild(closeButton);
  element.appendChild(footer);

  return element;
}

async function downloadExport(): Promise<void> {
  try {
    const json = await exportToJson();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const date = new Date().toISOString().slice(0, 10);
    link.download = `svp-favorites-${date}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    alert(t({ en: 'Export error: ', ru: 'Ошибка экспорта: ' }) + message);
  }
}

async function doImport(file: File, counterElement: HTMLElement): Promise<void> {
  try {
    const text = await file.text();
    const added = await importFromJson(text);
    counterElement.textContent =
      t({ en: 'Favorited points total: ', ru: 'Всего избранных точек: ' }) +
      String(getFavoritesCount());
    alert(t({ en: 'Records imported: ', ru: 'Импортировано записей: ' }) + String(added));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    alert(t({ en: 'Import error: ', ru: 'Ошибка импорта: ' }) + message);
  }
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

let rafPending = false;

export function installSettingsUi(): void {
  injectConfigureButton();
  moduleRowObserver = new MutationObserver(() => {
    // Debounce через rAF: при массовых DOM-мутациях (атака, анимации)
    // observer может триггериться сотни раз; querySelector в каждом колбэке
    // вызывает layout thrashing и зависание. rAF группирует вызовы.
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => {
      rafPending = false;
      if (!document.querySelector(`.${CONFIGURE_BUTTON_CLASS}`)) {
        injectConfigureButton();
      }
    });
  });
  moduleRowObserver.observe(document.body, { childList: true, subtree: true });
}

export function uninstallSettingsUi(): void {
  moduleRowObserver?.disconnect();
  moduleRowObserver = null;
  panel?.remove();
  panel = null;
  configureButton?.remove();
  configureButton = null;
}
