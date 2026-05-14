import { waitForElement } from '../../core/dom';
import { t } from '../../core/l10n';
import { readInventoryReferences } from '../../core/inventoryCache';
import type { IInventoryReference } from '../../core/inventoryTypes';
import { MARK_FLAG_BITS, type MarkFlag } from '../../core/inventoryTypes';
import { MARKS_RATE_LIMIT_MS, postMark } from '../../core/marksApi';

/**
 * Кнопки fav/lock в попапе точки. Состояние кнопки = агрегация по всем
 * стопкам ключей точки в инвентаре (`every`): кнопка считается "включённой"
 * только когда ВСЕ стопки имеют соответствующий бит в `f`. Toggle применяется
 * последовательно (sequential POST с задержкой 1500мс) к стопкам, текущий бит
 * которых отличается от целевого. Совпадает с правилом lockSupportAvailable
 * в inventoryCleanup, где mix-стопки считаются неполным lock-state и блокируют
 * удаление.
 *
 * Если у точки в инвентаре нет ни одной стопки ключей - кнопки disabled (без
 * tooltip): нативный `POST /api/marks` работает на уровне стопки, помечать
 * нечего.
 */

const POPUP_SELECTOR = '.info.popup';
const IMAGE_BOX_SELECTOR = '.i-image-box';
const REF_COUNT_SELECTOR = '#i-ref';
const CONTAINER_CLASS = 'svp-point-mark-buttons';
const BUTTON_CLASS = 'svp-point-mark-button';
const FILLED_CLASS = 'is-filled';

interface IIconState {
  /** Имя SVG-symbol при выключенном (outline) состоянии. */
  off: string;
  /** Имя SVG-symbol при включённом (filled) состоянии. */
  on: string;
}

const ICON_STATES: Record<MarkFlag, IIconState> = {
  favorite: { off: 'fa-star', on: 'fas-star' },
  locked: { off: 'fas-lock-open', on: 'fas-lock' },
};

const TITLES: Record<
  MarkFlag,
  { off: { en: string; ru: string }; on: { en: string; ru: string } }
> = {
  favorite: {
    off: { en: 'Add to favorites', ru: 'Добавить в избранное' },
    on: { en: 'Remove from favorites', ru: 'Убрать из избранного' },
  },
  locked: {
    off: { en: 'Lock keys', ru: 'Заблокировать ключи' },
    on: { en: 'Unlock keys', ru: 'Разблокировать ключи' },
  },
};

const FLAGS: readonly MarkFlag[] = ['favorite', 'locked'];

let popupObserver: MutationObserver | null = null;
let clickAbortController: AbortController | null = null;
// AbortController для waitForElement, ожидающего появления .info.popup. На
// uninstall abort() сразу освобождает MutationObserver и timeout, не оставляя
// pending observer на documentElement на 10 секунд после disable.
let installAbortController: AbortController | null = null;
// Инкрементируется при каждом install/uninstall. Если waitForElement.then()
// срабатывает после uninstall (async race), generation уже другой - skip.
let installGeneration = 0;
// GUIDы точек, для которых сейчас в полёте batch POST /api/marks. На время
// batch кнопки этой точки disabled, повторные клики игнорируются. Состояние
// per-pointGuid, не глобальное: пользователь может свайпнуть на другую точку
// во время batch первой, и кнопки второй точки должны оставаться рабочими.
const batchInProgress = new Set<string>();

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getCurrentGuid(popup: Element): string | null {
  if (popup.classList.contains('hidden')) return null;
  if (!(popup instanceof HTMLElement)) return null;
  const guid = popup.dataset.guid;
  return guid && guid.length > 0 ? guid : null;
}

function getPointStacks(pointGuid: string): IInventoryReference[] {
  // Стопка с a=0 - уже удалённая, ждёт вычистки кэша. Серверный POST по ней
  // вернёт result=false (фантомная стопка), applyFlagToCache не найдёт её -
  // зря дёргать сервер и засчитывать в batch. Фильтр совпадает с поведением
  // migrationApi.inferAndPersistLockMigrationDone и cleanupCalculator.
  return readInventoryReferences().filter((stack) => stack.l === pointGuid && stack.a > 0);
}

function hasBit(stack: IInventoryReference, bit: number): boolean {
  return ((stack.f ?? 0) & bit) !== 0;
}

function isFlagSetOnAllStacks(stacks: IInventoryReference[], flag: MarkFlag): boolean {
  if (stacks.length === 0) return false;
  const bit = MARK_FLAG_BITS[flag];
  return stacks.every((stack) => hasBit(stack, bit));
}

function findContainer(popup: Element): HTMLElement | null {
  return popup.querySelector<HTMLElement>(`.${CONTAINER_CLASS}`);
}

function findButton(popup: Element, flag: MarkFlag): HTMLButtonElement | null {
  return popup.querySelector<HTMLButtonElement>(`.${BUTTON_CLASS}[data-flag="${flag}"]`);
}

function buildButton(flag: MarkFlag): HTMLButtonElement {
  const button = document.createElement('button');
  button.className = BUTTON_CLASS;
  button.type = 'button';
  button.dataset.flag = flag;
  button.setAttribute('aria-pressed', 'false');
  // Нативные FA-spritesheet'ы игры (refs/game/script.js: RA_BUTTONS_DATA).
  // Тот же визуальный язык, что у inventory ref_actions popover.
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 576 576');
  svg.setAttribute('width', '20');
  svg.setAttribute('height', '20');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#${ICON_STATES[flag].off}`);
  svg.appendChild(use);
  button.appendChild(svg);
  return button;
}

function updateButton(button: HTMLButtonElement, flag: MarkFlag, popup: Element): void {
  const guid = getCurrentGuid(popup);
  if (guid !== null && batchInProgress.has(guid)) {
    button.disabled = true;
    return;
  }
  if (guid === null) {
    button.disabled = true;
    button.title = '';
    button.classList.remove(FILLED_CLASS);
    button.setAttribute('aria-pressed', 'false');
    button.querySelector('use')?.setAttribute('href', `#${ICON_STATES[flag].off}`);
    return;
  }
  const stacks = getPointStacks(guid);
  if (stacks.length === 0) {
    button.disabled = true;
    button.title = '';
    button.classList.remove(FILLED_CLASS);
    button.setAttribute('aria-pressed', 'false');
    button.querySelector('use')?.setAttribute('href', `#${ICON_STATES[flag].off}`);
    return;
  }
  const filled = isFlagSetOnAllStacks(stacks, flag);
  button.disabled = false;
  button.classList.toggle(FILLED_CLASS, filled);
  button.setAttribute('aria-pressed', filled ? 'true' : 'false');
  button.title = t(filled ? TITLES[flag].on : TITLES[flag].off);
  button
    .querySelector('use')
    ?.setAttribute('href', `#${filled ? ICON_STATES[flag].on : ICON_STATES[flag].off}`);
}

function refreshAll(popup: Element): void {
  for (const flag of FLAGS) {
    const button = findButton(popup, flag);
    if (button) updateButton(button, flag, popup);
  }
}

async function onClick(popup: Element, flag: MarkFlag): Promise<void> {
  const guid = getCurrentGuid(popup);
  if (guid === null) return;
  if (batchInProgress.has(guid)) return;
  const stacks = getPointStacks(guid);
  if (stacks.length === 0) return;

  const bit = MARK_FLAG_BITS[flag];
  // Целевое состояние - инверсия агрегата. Когда все стопки помечены - снимаем;
  // когда хотя бы одна не помечена - ставим всем.
  const targetOn = !stacks.every((stack) => hasBit(stack, bit));
  const toToggle = stacks.filter((stack) => hasBit(stack, bit) !== targetOn);
  if (toToggle.length === 0) return;

  batchInProgress.add(guid);
  refreshAll(popup);
  try {
    for (let i = 0; i < toToggle.length; i++) {
      if (i > 0) await sleep(MARKS_RATE_LIMIT_MS);
      await postMark(toToggle[i].g, flag);
    }
  } finally {
    batchInProgress.delete(guid);
    refreshAll(popup);
  }
}

function injectButtons(popup: Element): void {
  const imageBox = popup.querySelector(IMAGE_BOX_SELECTOR);
  if (!imageBox) return;
  if (findContainer(popup)) {
    refreshAll(popup);
    return;
  }

  const container = document.createElement('div');
  container.className = CONTAINER_CLASS;

  clickAbortController = new AbortController();
  for (const flag of FLAGS) {
    const button = buildButton(flag);
    button.addEventListener(
      'click',
      (event) => {
        event.stopPropagation();
        event.preventDefault();
        void onClick(popup, flag);
      },
      { signal: clickAbortController.signal },
    );
    container.appendChild(button);
  }

  // Вставляем сразу после #i-ref (количество ключей), как старая svp-fav-star.
  // CSS сдвигает #i-ref левее на ширину контейнера.
  const refSpan = imageBox.querySelector(REF_COUNT_SELECTOR);
  if (refSpan) {
    refSpan.after(container);
  } else {
    imageBox.appendChild(container);
  }
  refreshAll(popup);
}

function startObserving(popup: Element): void {
  injectButtons(popup);

  popupObserver = new MutationObserver(() => {
    injectButtons(popup);
  });
  // Только за атрибутами самого попапа (class - hidden, data-guid - смена точки).
  // subtree:true вызвал бы цикл: updateButton меняет атрибуты кнопок -> observer
  // -> updateButton -> ...
  popupObserver.observe(popup, {
    attributes: true,
    attributeFilter: ['class', 'data-guid'],
  });
}

export function installPointMarkButtons(): void {
  if (popupObserver) return;
  installGeneration++;
  const generation = installGeneration;
  const existing = document.querySelector(POPUP_SELECTOR);
  if (existing) {
    startObserving(existing);
    return;
  }
  installAbortController = new AbortController();
  waitForElement(POPUP_SELECTOR, 10_000, installAbortController.signal)
    .then((popup) => {
      if (generation !== installGeneration) return;
      startObserving(popup);
    })
    .catch((error: unknown) => {
      // Generation сменился = модуль уже отключён или переинициализирован.
      // Не логировать ни AbortError (мы сами аборт-нули в uninstall), ни
      // timeout (если до timeout пользователь успел disable -> enable снова).
      if (generation !== installGeneration) return;
      console.warn('[SVP enhancedPointPopupUi] попап точки не найден:', error);
    });
}

export function uninstallPointMarkButtons(): void {
  installGeneration++;
  popupObserver?.disconnect();
  popupObserver = null;
  clickAbortController?.abort();
  clickAbortController = null;
  installAbortController?.abort();
  installAbortController = null;
  document.querySelector(`.${CONTAINER_CLASS}`)?.remove();
}
