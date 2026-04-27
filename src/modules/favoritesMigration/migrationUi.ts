import { t } from '../../core/l10n';
import type { ILocalizedString } from '../../core/l10n';
import { showToast } from '../../core/toast';
import {
  exportFavoritesToJson,
  getFavoritesCount,
  importFavoritesFromJson,
  setLockMigrationDone,
} from '../../core/favoritesStore';
import {
  buildCandidates,
  runMigration,
  type IMigrationProgress,
  type MigrationFlag,
} from './migrationApi';

const MODULE_ID = 'favoritesMigration';
const CONFIGURE_BUTTON_CLASS = 'svp-migration-configure-button';
const PANEL_CLASS = 'svp-migration-panel';

const CONFIGURE_LABEL: ILocalizedString = { en: 'Configure', ru: 'Настроить' };

const TITLE: ILocalizedString = {
  en: 'Migrate favorited points',
  ru: 'Миграция избранных точек',
};

const COUNTER_LABEL: ILocalizedString = {
  en: 'Local SVP/CUI list:',
  ru: 'Локальный список SVP/CUI:',
};

const ACTION_FAVORITE_LABEL: ILocalizedString = {
  en: 'Mark as favorites',
  ru: 'Сделать их избранными',
};

const ACTION_LOCKED_LABEL: ILocalizedString = {
  en: 'Mark as locked',
  ru: 'Сделать их заблокированными',
};

const EXPLANATION: ILocalizedString = {
  en: 'Favorited keys: visual marker only, not protected from cleanup. Locked keys: not used for drawing and not deleted by auto-cleanup.',
  ru: 'Избранные ключи: визуальное маркирование, не защищаются от удаления. Заблокированные ключи: не участвуют в рисовании и не удаляются автоочисткой.',
};

const CLOSE_LABEL: ILocalizedString = { en: 'Close', ru: 'Закрыть' };

const EXPORT_LABEL: ILocalizedString = {
  en: '⬇️ Download JSON',
  ru: '⬇️ Скачать JSON',
};
const IMPORT_LABEL: ILocalizedString = {
  en: '⬆️ Import from JSON',
  ru: '⬆️ Импорт из JSON',
};
const IMPORT_WARNING_LABEL: ILocalizedString = {
  en: '⚠️ Current favorites list will be completely replaced',
  ru: '⚠️ Текущий список избранного будет полностью перезаписан',
};

const SECTION_LEGACY_LABEL: ILocalizedString = {
  en: 'CUI / Vanilla+ favorites (legacy)',
  ru: 'Избранное CUI / Vanilla+ (устаревшее)',
};
const SECTION_NATIVE_LABEL: ILocalizedString = {
  en: 'Game favorites and locks (new)',
  ru: 'Избранное и заблокированное игры (новое)',
};

// Подписи фаз прогресс-бара. Каждая фаза перезапускает бар с 0/N, чтобы
// пользователь видел независимый прогресс retry, а не «скачок» суммарного total.
const PHASE_INITIAL_LABEL: ILocalizedString = { en: 'Migrating…', ru: 'Миграция…' };
const PHASE_RETRY_TOGGLE_LABEL: ILocalizedString = {
  en: 'Retrying toggled-off stacks…',
  ru: 'Повтор для стопок с toggle-off…',
};
const PHASE_RETRY_NETWORK_LABEL: ILocalizedString = {
  en: 'Retrying network failures…',
  ru: 'Повтор после сетевых ошибок…',
};

// Финальные статусы. Цвет/класс прогресс-бара определяется здесь, а не accent'ом
// игры (у SBG --accent красный — выглядит как «ошибка» при успешном завершении).
const SUCCESS_STATUS_LABEL: ILocalizedString = {
  en: 'All stacks marked successfully',
  ru: 'Все стопки помечены успешно',
};
const PARTIAL_STATUS_TEMPLATE: ILocalizedString = {
  // {n} заменим в runtime на оставшееся количество.
  en: 'Marked {ok} of {total}. {n} could not be marked — try running migration again in a couple of minutes',
  ru: 'Помечено {ok} из {total}. {n} не удалось — попробуй запустить миграцию ещё раз через пару минут',
};

const NO_KEYS_TOAST: ILocalizedString = {
  en: 'No keys in inventory for any favorited point — nothing to migrate',
  ru: 'В инвентаре нет ключей ни одной избранной точки — мигрировать нечего',
};

const ALREADY_APPLIED_TOAST: ILocalizedString = {
  en: 'All stacks already have this flag — nothing to do',
  ru: 'У всех стопок уже стоит этот флаг — делать нечего',
};

let panel: HTMLElement | null = null;
let configureButton: HTMLElement | null = null;
let moduleRowObserver: MutationObserver | null = null;
let rafId: number | null = null;
let migrationInProgress = false;

// IO (импорт/экспорт legacy IDB) - буквально из удалённого модуля
// favoritedPoints/settingsUi.ts (до коммита 3574c6c). label+input для импорта,
// button для экспорта, warning между ними, alert для подтверждения и ошибок,
// прямая mutation counterElement.textContent.
async function downloadExport(): Promise<void> {
  try {
    const json = await exportFavoritesToJson();
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
    const added = await importFavoritesFromJson(text);
    counterElement.textContent = `${t(COUNTER_LABEL)} ${getFavoritesCount()}`;
    alert(t({ en: 'Records imported: ', ru: 'Импортировано записей: ' }) + String(added));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    alert(t({ en: 'Import error: ', ru: 'Ошибка импорта: ' }) + message);
  }
}

function buildIoSection(counterElement: HTMLElement): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'svp-migration-io';

  const importWrapper = document.createElement('div');
  importWrapper.className = 'svp-migration-io-import-wrapper';
  const importLabel = document.createElement('label');
  importLabel.className = 'svp-migration-io-button';
  importLabel.dataset.io = 'import';
  importLabel.textContent = t(IMPORT_LABEL);
  const importInput = document.createElement('input');
  importInput.type = 'file';
  importInput.accept = 'application/json,.json';
  importInput.style.display = 'none';
  importInput.addEventListener('change', () => {
    const file = importInput.files?.[0];
    if (file) {
      void doImport(file, counterElement);
    }
    importInput.value = '';
  });
  importLabel.appendChild(importInput);
  importWrapper.appendChild(importLabel);
  wrap.appendChild(importWrapper);

  const importWarning = document.createElement('div');
  importWarning.className = 'svp-migration-io-warning';
  importWarning.textContent = t(IMPORT_WARNING_LABEL);
  wrap.appendChild(importWarning);

  const exportButton = document.createElement('button');
  exportButton.type = 'button';
  exportButton.className = 'svp-migration-io-button';
  exportButton.dataset.io = 'export';
  exportButton.textContent = t(EXPORT_LABEL);
  exportButton.addEventListener('click', () => {
    void downloadExport();
  });
  wrap.appendChild(exportButton);

  return wrap;
}

/**
 * Заполняет кнопку действия SVG-иконкой из игрового sprite + текстовой подписью.
 * Используем createElementNS для SVG: innerHTML с пользовательским текстом
 * требовал бы экранирования, а DOM-API делает это безопасно.
 */
function appendActionContent(button: HTMLElement, spriteId: string, label: string): void {
  const svgNs = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNs, 'svg');
  svg.setAttribute('viewBox', '0 0 576 576');
  svg.setAttribute('width', '1em');
  svg.setAttribute('height', '1em');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(svgNs, 'use');
  use.setAttribute('href', `#${spriteId}`);
  svg.appendChild(use);
  const text = document.createElement('span');
  text.textContent = label;
  button.replaceChildren(svg, text);
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
    configureButton.textContent = t(CONFIGURE_LABEL);
    configureButton.addEventListener('click', (event) => {
      event.stopPropagation();
      openPanel();
    });
    nameLine.appendChild(configureButton);
    return;
  }
}

function buildPanel(): HTMLElement {
  const element = document.createElement('div');
  element.className = PANEL_CLASS;

  const header = document.createElement('div');
  header.className = 'svp-migration-header';
  const title = document.createElement('span');
  title.textContent = t(TITLE);
  header.appendChild(title);

  const close = document.createElement('button');
  close.className = 'svp-migration-close';
  close.textContent = '✕';
  close.setAttribute('aria-label', t(CLOSE_LABEL));
  close.addEventListener('click', () => {
    // Кнопка дизейблится в runFlow на время миграции — клик не пройдёт; здесь
    // вторая защита от программных кликов и для случая отключённого `disabled`.
    if (migrationInProgress) return;
    closePanel();
  });
  header.appendChild(close);
  element.appendChild(header);

  const content = document.createElement('div');
  content.className = 'svp-migration-content';

  // Секция legacy: импорт/экспорт списка SVP/CUI и счётчик количества записей.
  const legacySection = document.createElement('div');
  legacySection.className = 'svp-migration-section svp-migration-section-legacy';
  const legacyHeader = document.createElement('div');
  legacyHeader.className = 'svp-migration-section-header';
  legacyHeader.textContent = t(SECTION_LEGACY_LABEL);
  legacySection.appendChild(legacyHeader);

  // Counter создаётся до IO-секции, чтобы передать прямую ссылку в doImport
  // (после импорта counter.textContent обновляется). В DOM counter
  // вставляется после IO-секции - порядок отображения IO -> counter.
  const counter = document.createElement('div');
  counter.className = 'svp-migration-counter';
  counter.textContent = `${t(COUNTER_LABEL)} ${getFavoritesCount()}`;

  legacySection.appendChild(buildIoSection(counter));
  legacySection.appendChild(counter);
  content.appendChild(legacySection);

  // Секция native: миграция в нативные звёздочки/замочки игры.
  const nativeSection = document.createElement('div');
  nativeSection.className = 'svp-migration-section svp-migration-section-native';
  const nativeHeader = document.createElement('div');
  nativeHeader.className = 'svp-migration-section-header';
  nativeHeader.textContent = t(SECTION_NATIVE_LABEL);
  nativeSection.appendChild(nativeHeader);

  const actions = document.createElement('div');
  actions.className = 'svp-migration-actions';

  // Иконки повторяют data-flag-кнопки игры (refs/game-beta/dom/body.html:418, 422):
  // звёздочка для favorite, замочек для locked. SVG-sprite определены в DOM игры
  // в head'е, ссылка через `<use href="#fas-...">` работает без инлайн-копирования.
  const favButton = document.createElement('button');
  favButton.className = 'svp-migration-action';
  favButton.dataset.flag = 'favorite';
  appendActionContent(favButton, 'fas-star', t(ACTION_FAVORITE_LABEL));
  favButton.addEventListener('click', () => {
    void runFlow('favorite', element);
  });
  actions.appendChild(favButton);

  const lockButton = document.createElement('button');
  lockButton.className = 'svp-migration-action';
  lockButton.dataset.flag = 'locked';
  appendActionContent(lockButton, 'fas-lock', t(ACTION_LOCKED_LABEL));
  lockButton.addEventListener('click', () => {
    void runFlow('locked', element);
  });
  actions.appendChild(lockButton);

  nativeSection.appendChild(actions);

  const explanation = document.createElement('div');
  explanation.className = 'svp-migration-explanation';
  explanation.textContent = t(EXPLANATION);
  nativeSection.appendChild(explanation);

  // Прогресс-бар: скрыт до начала миграции.
  const progress = document.createElement('div');
  progress.className = 'svp-migration-progress';
  const status = document.createElement('div');
  status.className = 'svp-migration-progress-status';
  progress.appendChild(status);
  const barWrap = document.createElement('div');
  barWrap.className = 'svp-migration-progress-bar-wrap';
  const bar = document.createElement('div');
  bar.className = 'svp-migration-progress-bar';
  barWrap.appendChild(bar);
  progress.appendChild(barWrap);
  const counterEl = document.createElement('div');
  counterEl.className = 'svp-migration-progress-counter';
  progress.appendChild(counterEl);
  nativeSection.appendChild(progress);

  content.appendChild(nativeSection);

  element.appendChild(content);
  return element;
}

function setProgress(panelElement: HTMLElement, p: IMigrationProgress | null): void {
  const wrap = panelElement.querySelector<HTMLElement>('.svp-migration-progress');
  if (!wrap) return;
  if (!p) {
    wrap.classList.remove('svp-active');
    wrap.classList.remove('svp-success');
    wrap.classList.remove('svp-partial');
    return;
  }
  wrap.classList.add('svp-active');
  // Сбрасываем терминальные состояния — фаза в процессе.
  wrap.classList.remove('svp-success');
  wrap.classList.remove('svp-partial');
  const bar = wrap.querySelector<HTMLElement>('.svp-migration-progress-bar');
  if (bar) {
    const percent = p.total === 0 ? 0 : Math.round((p.done / p.total) * 100);
    bar.style.width = `${percent}%`;
  }
  const counterEl = wrap.querySelector<HTMLElement>('.svp-migration-progress-counter');
  if (counterEl) {
    // Показываем `done/total` — сколько запросов прогнано из общего числа.
    // Раньше показывали `succeeded/total`, но при ответах с `result: false`
    // (toggle off) бар двигался, а счётчик стоял на 0 — пользователь видел
    // «прогресс есть, а число не растёт». Дополнительно выводим количество
    // успешных, если оно отличается от done.
    counterEl.textContent =
      p.succeeded < p.done ? `${p.done} / ${p.total} (✓ ${p.succeeded})` : `${p.done} / ${p.total}`;
  }
}

function setProgressStatus(panelElement: HTMLElement, text: string): void {
  const status = panelElement.querySelector<HTMLElement>('.svp-migration-progress-status');
  if (status) status.textContent = text;
}

function markProgressTerminal(
  panelElement: HTMLElement,
  outcome: 'success' | 'partial',
  statusText: string,
): void {
  const wrap = panelElement.querySelector<HTMLElement>('.svp-migration-progress');
  if (!wrap) return;
  // Убираем «активную» окраску, ставим терминальную: success — зелёный, partial —
  // accent игры (красный) допустим как сигнал «есть проблемы».
  wrap.classList.add(outcome === 'success' ? 'svp-success' : 'svp-partial');
  setProgressStatus(panelElement, statusText);
  // Прогресс-бар при success заполняем до 100% независимо от done/total — все
  // фазы суммарно успешны, бар после retry мог остановиться на N<total.
  if (outcome === 'success') {
    const bar = wrap.querySelector<HTMLElement>('.svp-migration-progress-bar');
    if (bar) bar.style.width = '100%';
  }
}

function setActionsDisabled(panelElement: HTMLElement, disabled: boolean): void {
  const actions = panelElement.querySelectorAll<HTMLButtonElement>('.svp-migration-action');
  for (const action of actions) action.disabled = disabled;
}

/** Дизейблит крестик закрытия панели на время миграции — пользователь не может
 *  прервать долгую операцию случайным кликом. Восстанавливает после завершения. */
function setCloseDisabled(panelElement: HTMLElement, disabled: boolean): void {
  const close = panelElement.querySelector<HTMLButtonElement>('.svp-migration-close');
  if (close) close.disabled = disabled;
}

async function runFlow(flag: MigrationFlag, panelElement: HTMLElement): Promise<void> {
  if (migrationInProgress) return;
  migrationInProgress = true;
  setActionsDisabled(panelElement, true);
  setCloseDisabled(panelElement, true);

  try {
    const candidates = buildCandidates(flag);

    if (candidates.toSend.length === 0) {
      // Все стопки уже помечены нужным флагом. Для locked это означает что
      // защита уже полная - ставим lock-migration-done, чтобы inventoryCleanup
      // перестал блокировать удаление ключей. Для favorite ничего не ставим:
      // favorite не защищает от удаления.
      if (flag === 'locked' && candidates.alreadyApplied > 0) {
        setLockMigrationDone();
      }
      const message = candidates.alreadyApplied > 0 ? t(ALREADY_APPLIED_TOAST) : t(NO_KEYS_TOAST);
      showToast(message);
      return;
    }

    setProgressStatus(panelElement, t(PHASE_INITIAL_LABEL));
    setProgress(panelElement, {
      done: 0,
      total: candidates.toSend.length,
      succeeded: 0,
    });

    const result = await runMigration(candidates.toSend, {
      flag,
      onProgress: (p) => {
        setProgress(panelElement, p);
      },
      onPhaseChange: (phase) => {
        // Каждая фаза получает собственный прогресс-бар: пользователь не видит
        // «скачка» total с N до N+M при retry, видит чистый 0/M для retry.
        const label =
          phase.name === 'initial'
            ? PHASE_INITIAL_LABEL
            : phase.name === 'retry-toggle'
              ? PHASE_RETRY_TOGGLE_LABEL
              : PHASE_RETRY_NETWORK_LABEL;
        setProgressStatus(panelElement, t(label));
        setProgress(panelElement, { done: 0, total: phase.total, succeeded: 0 });
      },
    });

    const isSuccess =
      result.networkFailed.length === 0 &&
      result.toggleStuck.length === 0 &&
      result.succeeded.length === candidates.toSend.length;

    if (isSuccess) {
      // Полный success миграции в locked - выставляем флаг lock-migration-done.
      // С этого момента inventoryCleanup доверяет нативному lock-флагу и не
      // блокирует удаление ключей по факту непустого legacy-списка.
      // Для favorite флаг НЕ ставим: favorite не защищает от удаления, и блок
      // должен оставаться, пока пользователь явно не нажмёт locked-миграцию.
      if (flag === 'locked') {
        setLockMigrationDone();
      }
      markProgressTerminal(panelElement, 'success', t(SUCCESS_STATUS_LABEL));
      showToast(t(SUCCESS_STATUS_LABEL));
    } else {
      const remaining = candidates.toSend.length - result.succeeded.length;
      const partialText = t(PARTIAL_STATUS_TEMPLATE)
        .replace('{ok}', String(result.succeeded.length))
        .replace('{total}', String(candidates.toSend.length))
        .replace('{n}', String(remaining));
      markProgressTerminal(panelElement, 'partial', partialText);
      showToast(partialText);
    }
  } finally {
    migrationInProgress = false;
    setActionsDisabled(panelElement, false);
    setCloseDisabled(panelElement, false);
  }
}

function openPanel(): void {
  if (panel) panel.remove();
  panel = buildPanel();
  document.body.appendChild(panel);
}

function closePanel(): void {
  if (panel) {
    panel.remove();
    panel = null;
  }
}

export function installMigrationUi(): void {
  injectConfigureButton();
  // Settings panel создаётся позже bootstrap'а — догоняем через observer.
  moduleRowObserver = new MutationObserver(() => {
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

export function uninstallMigrationUi(): void {
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  moduleRowObserver?.disconnect();
  moduleRowObserver = null;
  if (configureButton) {
    configureButton.remove();
    configureButton = null;
  }
  closePanel();
}
