/**
 * Принудительно отключает нативный «Сборщик мусора» SBG 0.6.1, пока активен
 * наш `inventoryCleanup`. Запрос пользователя: «нужно сделать так, чтобы наш
 * модуль обязательно выключал сборщик мусора, и это должно быть видно в
 * интерфейсе в виде disabled всех настроек сборщика мусора».
 *
 * Трёхслойная защита:
 * 1. POST /api/settings { usegrb: false } — серверная гарантия, что нативный
 *    сборщик мусора не работает.
 * 2. DOM-disable на чекбоксе usegrb, всех `.garbage-value` инпутах и кнопке
 *    сохранения — пользователь видит, что переключатели заблокированы и
 *    понимает, что управление перешло к нашему модулю.
 * 3. Визуальная индикация подмены: над разметкой fieldset-блока «Сборщик
 *    мусора» вешаем подпись «Заменён модулем автоочистки Vanilla+», а
 *    оставшееся содержимое оборачиваем во внутренний div с opacity 0.5 -
 *    подпись остаётся читаемой, остальное видно, но визуально приглушено.
 *
 * `inventory-cache` пользовательской настройки не трогаем — на disable
 * атрибуты снимаем (контроль возвращается игре), но `usegrb` обратно в true
 * не выставляем: пользователь может оставить нативный сборщик off, если хочет.
 */

import { t } from '../../core/l10n';

const NATIVE_INPUTS_SELECTOR = 'input[data-setting="usegrb"], .garbage-value, #garbage-save';
const SVP_DISABLED_MARKER = 'data-svp-disabled-by-cleanup';

const GARBAGE_NOTE_CLASS = 'svp-garbage-disabled-note';
const GARBAGE_WRAPPER_CLASS = 'svp-garbage-disabled-content';

let domObserver: MutationObserver | null = null;
let installGeneration = 0;

function applyDisabledToNativeInputs(): void {
  const inputs = document.querySelectorAll<HTMLInputElement | HTMLButtonElement>(
    NATIVE_INPUTS_SELECTOR,
  );
  for (const input of inputs) {
    // Запоминаем, что disabled — это наш атрибут, а не игры. Иначе на restore
    // мы могли бы снять disabled с поля, которое игра сама задизейблила
    // (например, во время /api/settings save).
    if (input.hasAttribute('disabled')) continue;
    input.setAttribute('disabled', '');
    input.setAttribute(SVP_DISABLED_MARKER, '');
  }
}

function removeDisabledFromNativeInputs(): void {
  const inputs = document.querySelectorAll<HTMLInputElement | HTMLButtonElement>(
    `[${SVP_DISABLED_MARKER}]`,
  );
  for (const input of inputs) {
    input.removeAttribute('disabled');
    input.removeAttribute(SVP_DISABLED_MARKER);
  }
}

/**
 * Находит fieldset нативного блока «Сборщик мусора» по якорному инпуту
 * `data-setting="usegrb"` (refs/game/index.html:207). Поиск через ancestor
 * устойчив к изменению порядка children и к локали (текст legend меняется
 * по lang).
 */
function findGarbageFieldset(): HTMLFieldSetElement | null {
  const usegrb = document.querySelector<HTMLInputElement>('input[data-setting="usegrb"]');
  return usegrb?.closest('fieldset') ?? null;
}

/**
 * Оборачивает содержимое fieldset'а сборщика мусора (всё кроме legend и
 * нашей подписи) в div с классом GARBAGE_WRAPPER_CLASS, на который
 * накладывается opacity 0.5 через CSS. Сразу после legend вставляет
 * подпись с GARBAGE_NOTE_CLASS - opacity 1, читаема. Идемпотентна:
 * повторный вызов на уже обёрнутом fieldset'е no-op.
 */
function ensureGarbageFieldsetWrapped(): void {
  const fieldset = findGarbageFieldset();
  if (!fieldset) return;
  if (fieldset.querySelector(`:scope > .${GARBAGE_WRAPPER_CLASS}`)) return;

  const note = document.createElement('div');
  note.className = GARBAGE_NOTE_CLASS;
  note.textContent = t({
    en: 'Replaced by the Vanilla+ auto-cleanup module',
    ru: 'Заменён модулем автоочистки Vanilla+',
  });

  const wrapper = document.createElement('div');
  wrapper.className = GARBAGE_WRAPPER_CLASS;

  const childrenToMove = Array.from(fieldset.children).filter(
    (child) =>
      child.tagName !== 'LEGEND' &&
      !child.classList.contains(GARBAGE_NOTE_CLASS) &&
      !child.classList.contains(GARBAGE_WRAPPER_CLASS),
  );
  for (const child of childrenToMove) wrapper.appendChild(child);

  const legend = fieldset.querySelector(':scope > legend');
  if (legend) {
    // Порядок вставки: legend, потом note, потом wrapper.
    // insertAdjacentElement('afterend', X) ставит X сразу после legend.
    legend.insertAdjacentElement('afterend', wrapper);
    legend.insertAdjacentElement('afterend', note);
  } else {
    fieldset.appendChild(note);
    fieldset.appendChild(wrapper);
  }
}

/**
 * Возвращает содержимое fieldset'а в исходное состояние: переносит детей
 * wrapper'а обратно в fieldset, удаляет wrapper и подпись. Идемпотентна:
 * если обёртка не была установлена - no-op.
 */
function unwrapGarbageFieldset(): void {
  const fieldset = findGarbageFieldset();
  if (!fieldset) return;
  const wrapper = fieldset.querySelector<HTMLDivElement>(`:scope > .${GARBAGE_WRAPPER_CLASS}`);
  if (wrapper) {
    while (wrapper.firstChild) {
      fieldset.insertBefore(wrapper.firstChild, wrapper);
    }
    wrapper.remove();
  }
  const note = fieldset.querySelector(`:scope > .${GARBAGE_NOTE_CLASS}`);
  if (note) note.remove();
}

/**
 * Шлёт `POST /api/settings { usegrb: false }`. Эндпоинт описан в
 * release-notes 1.5: общий механизм server-synced settings, payload —
 * partial update.
 *
 * Используем напрямую `fetch` (как в `inventoryApi.deleteInventoryItems`),
 * потому что игровая `apiSend` — IIFE-внутренняя функция, недоступная
 * нашему юзерскрипту извне.
 *
 * Игнорируем сетевые ошибки: модуль работает дальше, но
 * без серверного выключения. DOM-defence остаётся в силе.
 */
async function postUsegrbFalse(): Promise<void> {
  const token = localStorage.getItem('auth');
  if (!token) return;
  try {
    await fetch('/api/settings', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ usegrb: false }),
    });
  } catch {
    // Сеть недоступна / сервер вернул ошибку — игнорируем. DOM-disable
    // остаётся в силе, пользователь видит, что управление у нас.
  }
}

export function installNativeGarbageGuard(): void {
  installGeneration++;
  const myGeneration = installGeneration;

  // Серверная сторона: однократный POST на enable.
  void postUsegrbFalse();

  // DOM-сторона: применить disabled сейчас и при любом ререндере settings.
  // Игра не пересоздаёт settings-секцию в реальной жизни (один раз при init),
  // но если какая-то будущая версия начнёт это делать — observer догонит.
  applyDisabledToNativeInputs();
  ensureGarbageFieldsetWrapped();

  domObserver = new MutationObserver(() => {
    // installGeneration защищает от race условий, если callback пришёл
    // после быстрого uninstall→install (counter уже другой).
    if (myGeneration !== installGeneration) return;
    applyDisabledToNativeInputs();
    ensureGarbageFieldsetWrapped();
  });
  domObserver.observe(document.body, {
    childList: true,
    subtree: true,
  });
}

export function uninstallNativeGarbageGuard(): void {
  installGeneration++;
  domObserver?.disconnect();
  domObserver = null;
  removeDisabledFromNativeInputs();
  unwrapGarbageFieldset();
}
