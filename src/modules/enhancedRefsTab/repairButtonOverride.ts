import { waitForElement } from '../../core/dom';

const REFS_TAB = '3';
const FULL_CHARGE_THRESHOLD = 100;

let observer: MutationObserver | null = null;
// Кнопки, на которых наш модуль только что выставил `disabled`. Observer сам
// триггерится на эту атрибутную смену, иначе наш handler пере-выставит disabled
// в бесконечном цикле. Микротаск после нашей записи очищает Set, чтобы
// последующие нативные изменения снова обрабатывались.
const selfDispatched = new WeakSet<HTMLButtonElement>();
// Инкремент при каждом install/uninstall: если waitForElement.then() сработает
// после disable, generation уже другой — install пропускается.
let installGeneration = 0;

/**
 * Парсит процент энергии из текста `.iid-energy` карточки ключа. Игра в 0.6.1
 * пишет в это поле строку формата «<percent>% @ <cores>» (refs/game-beta/script.js:3550),
 * например «87% @ 4». Возвращает число процентов или null, если формат не
 * распознан.
 */
export function parseEnergyPercent(text: string | null | undefined): number | null {
  if (!text) return null;
  const match = /^\s*(\d+(?:[.,]\d+)?)\s*%/.exec(text);
  if (!match) return null;
  const num = Number.parseFloat(match[1].replace(',', '.'));
  return Number.isFinite(num) ? num : null;
}

function getRepairButton(item: Element): HTMLButtonElement | null {
  return item.querySelector<HTMLButtonElement>('.inventory__ic-repair');
}

function getEnergyPercent(item: Element): number | null {
  const energyEl = item.querySelector('.iid-energy');
  return parseEnergyPercent(energyEl?.textContent);
}

/**
 * Если у карточки энергия 100%+, гасит кнопку repair. Игра в 0.6.1 включает
 * её только по проверке команды (refs/game-beta/script.js:3573 — `if
 * data.te === self_data.t`), сервер сам решает можно ли заряжать; нам нужно
 * дополнительно блокировать клик при полной зарядке, чтобы пользователь не
 * стучался в сервер впустую.
 *
 * Идемпотентно: если кнопка уже disabled, не трогаем (избегаем лишнего
 * MutationObserver-триггера).
 */
function applyOverrideTo(item: Element): void {
  const repair = getRepairButton(item);
  if (!repair) return;
  // Выходим, если карточка ещё не догрузилась (`loaded` ставит игра после
  // refs-cache fetch — в этот момент iid-energy ещё нет).
  if (!item.classList.contains('loaded')) return;

  const percent = getEnergyPercent(item);
  if (percent === null) return;

  if (percent >= FULL_CHARGE_THRESHOLD) {
    if (!repair.hasAttribute('disabled')) {
      selfDispatched.add(repair);
      repair.setAttribute('disabled', '');
      // Сброс маркера на следующий микротаск — observer уже отбросил наше
      // изменение, можно снова реагировать.
      void Promise.resolve().then(() => selfDispatched.delete(repair));
    }
  }
}

function handleMutations(mutations: MutationRecord[]): void {
  for (const mutation of mutations) {
    if (mutation.type === 'childList') {
      // Новые `.inventory__item[data-ref]` добавляются скопом при открытии
      // вкладки рефов или при переключении на неё; пройдём по добавленным.
      for (const node of mutation.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (node.matches('.inventory__item[data-ref]')) {
          applyOverrideTo(node);
        }
      }
      continue;
    }

    if (mutation.type !== 'attributes') continue;
    const target = mutation.target;
    if (!(target instanceof Element)) continue;

    if (
      mutation.attributeName === 'class' &&
      target.classList.contains('inventory__item') &&
      target.hasAttribute('data-ref')
    ) {
      // `loaded` появляется после `makeEntry` (refs/game-beta/script.js:3568) —
      // в этот момент `.iid-energy` уже заполнен.
      applyOverrideTo(target);
      continue;
    }

    if (
      mutation.attributeName === 'disabled' &&
      target instanceof HTMLButtonElement &&
      target.classList.contains('inventory__ic-repair')
    ) {
      if (selfDispatched.has(target)) continue;
      // Игра сняла disabled (после успешного repair, или при initial setup
      // makeEntry). Перепроверяем текущую энергию: если 100%+, ставим обратно.
      const item = target.closest('.inventory__item[data-ref]');
      if (item) applyOverrideTo(item);
    }
  }
}

/** Применяет override ко всем уже отрендеренным карточкам refs-таба. */
function syncExistingItems(content: Element): void {
  const tab = content.getAttribute('data-tab');
  if (tab !== REFS_TAB) return;
  const items = content.querySelectorAll('.inventory__item[data-ref]');
  for (const item of items) applyOverrideTo(item);
}

export function installRepairButtonOverride(): void {
  installGeneration++;
  const myGeneration = installGeneration;

  void waitForElement('.inventory__content').then((content) => {
    // Между ожиданием и резолвом мог быть disable: проверяем по generation.
    if (myGeneration !== installGeneration) return;

    observer = new MutationObserver(handleMutations);
    observer.observe(content, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['disabled', 'class'],
    });

    syncExistingItems(content);
  });
}

export function uninstallRepairButtonOverride(): void {
  installGeneration++;
  observer?.disconnect();
  observer = null;
}
