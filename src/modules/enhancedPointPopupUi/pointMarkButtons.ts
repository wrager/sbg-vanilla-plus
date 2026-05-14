import { waitForElement } from '../../core/dom';
import { t } from '../../core/l10n';
import { INVENTORY_CACHE_KEY, readInventoryReferences } from '../../core/inventoryCache';
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
const BATCHING_CLASS = 'is-batching';
const PROGRESS_CLASS = 'svp-point-mark-progress';

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
// Активный popup, на котором нужно перерисовать кнопки при изменении
// inventory-cache. null при uninstall: setItem-wrapper остаётся в цепочке
// (см. docs/architecture.md про runtime-override), но игнорирует событие.
let observedPopup: Element | null = null;
// Wrapper для localStorage.setItem устанавливается один раз на жизнь страницы:
// снимать его в uninstall опасно (между нашим enable и inventoryCleanup могут
// быть другие wrappers, восстановление прототипа порвало бы цепочку).
let inventoryCacheListenerInstalled = false;
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
// Прогресс batch по точке: {done, total}. Показывается внутри кнопки как
// текст N/total. Без прогресса пользователь видит просто "потускневшие"
// кнопки на 5-30 секунд и не понимает, что происходит.
const batchProgress = new Map<string, { done: number; total: number }>();

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
  svg.setAttribute('width', '24');
  svg.setAttribute('height', '24');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#${ICON_STATES[flag].off}`);
  svg.appendChild(use);
  button.appendChild(svg);
  // Прогресс-индикатор: скрыт по умолчанию через CSS, появляется только в
  // batch-режиме (is-batching класс на кнопке) и пишет N/total.
  const progress = document.createElement('span');
  progress.className = PROGRESS_CLASS;
  progress.setAttribute('aria-live', 'polite');
  button.appendChild(progress);
  return button;
}

function updateButton(button: HTMLButtonElement, flag: MarkFlag, popup: Element): void {
  const guid = getCurrentGuid(popup);
  const progress = button.querySelector<HTMLElement>(`.${PROGRESS_CLASS}`);
  if (guid !== null && batchInProgress.has(guid)) {
    button.disabled = true;
    button.classList.add(BATCHING_CLASS);
    const state = batchProgress.get(guid);
    if (progress) progress.textContent = state ? `${state.done}/${state.total}` : '';
    return;
  }
  button.classList.remove(BATCHING_CLASS);
  if (progress) progress.textContent = '';
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
  batchProgress.set(guid, { done: 0, total: toToggle.length });
  refreshAll(popup);
  // Снимок generation на момент старта batch. После каждого awaited step
  // (sleep между POST, сам POST) сверяем со свежим installGeneration: при
  // uninstall он уже инкрементирован, дальнейшие POST не пускаются. Иначе
  // цикл продолжал бы дёргать /api/marks и мутировать inventory-cache до 30
  // секунд после disable.
  const myGeneration = installGeneration;
  try {
    for (let i = 0; i < toToggle.length; i++) {
      if (i > 0) {
        await sleep(MARKS_RATE_LIMIT_MS);
        if (myGeneration !== installGeneration) return;
      }
      // POST /api/marks - toggle, не set: инвертирует текущий бит на сервере.
      // Между нашими POST 1500мс sleep; за это время другой источник
      // (нативный inventory ref_actions, CUI, другая вкладка) мог toggle'нуть
      // бит у этой же стопки. Если f уже совпадает с targetOn - наш POST
      // вернул бы бит к противоположному, ломая "все favorite" в
      // "все кроме одной". Перечитываем актуальный f перед POST и пропускаем
      // стопку, у которой бит уже там, где нам надо.
      const stackGuid = toToggle[i].g;
      const fresh = readInventoryReferences().find((s) => s.g === stackGuid);
      if (fresh !== undefined && hasBit(fresh, bit) !== targetOn) {
        await postMark(stackGuid, flag);
        if (myGeneration !== installGeneration) return;
      }
      batchProgress.set(guid, { done: i + 1, total: toToggle.length });
      refreshAll(popup);
    }
  } finally {
    batchInProgress.delete(guid);
    batchProgress.delete(guid);
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
  observedPopup = popup;

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

/**
 * Перехват `localStorage.setItem` на ключ `inventory-cache`. Нужен, потому что
 * у нас в открытом попапе могут происходить параллельные изменения стопок:
 * нативный inventory ref_actions popover клонируется внутрь .info.popup в
 * SBG 0.6.1 и пишет item.f напрямую; favoritesMigration во время прогона
 * мутирует через applyFlagToCache; discover добавляет/инкрементит стопку;
 * inventoryCleanup удаляет ключи. MutationObserver на атрибуты попапа этого
 * не видит. Подписка на setItem - единственный способ узнать о mutation
 * inventory-cache в нашей же вкладке (storage event срабатывает только в
 * других вкладках).
 *
 * Wrapper идемпотентен (ставится один раз на страницу) и не снимается в
 * uninstall: его соседи в цепочке (inventoryCleanup) могут не пережить
 * восстановление прототипа. observedPopup === null после uninstall - wrapper
 * по факту no-op.
 */
function installInventoryCacheListener(): void {
  if (inventoryCacheListenerInstalled) return;
  inventoryCacheListenerInstalled = true;
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const nativeSetItem = localStorage.setItem;
  const wrapper: typeof localStorage.setItem = function (this: Storage, key, value) {
    nativeSetItem.apply(this, [key, value]);
    if (key === INVENTORY_CACHE_KEY && observedPopup !== null) {
      refreshAll(observedPopup);
    }
  };
  // Сначала пробуем instance-уровень (как inventoryCleanup): в браузерах
  // assignment в localStorage.setItem работает. В jsdom (тесты) instance
  // setItem - non-writable accessor, assignment молча игнорируется -
  // fallback на прототип.
  localStorage.setItem = wrapper;
  if (localStorage.setItem !== wrapper) {
    Storage.prototype.setItem = wrapper;
  }
}

export function installPointMarkButtons(): void {
  if (popupObserver) return;
  installGeneration++;
  const generation = installGeneration;
  installInventoryCacheListener();
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
  // Висящий старый цикл postMark из onClick всё ещё в полёте и доберётся до
  // finally сам, но между uninstall и enable обратно пользователь не должен
  // видеть свежие кнопки disabled из-за batch отключённой инкарнации.
  batchInProgress.clear();
  batchProgress.clear();
  observedPopup = null;
  document.querySelector(`.${CONTAINER_CLASS}`)?.remove();
}
