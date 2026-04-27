/**
 * Принудительно отключает нативный «Сборщик мусора» SBG 0.6.1, пока активен
 * наш `inventoryCleanup`. Запрос пользователя: «нужно сделать так, чтобы наш
 * модуль обязательно выключал сборщик мусора, и это должно быть видно в
 * интерфейсе в виде disabled всех настроек сборщика мусора».
 *
 * Двухслойная защита:
 * 1. POST /api/settings { usegrb: false } — серверная гарантия, что нативный
 *    сборщик мусора не работает.
 * 2. DOM-disable на чекбоксе usegrb, всех `.garbage-value` инпутах и кнопке
 *    сохранения — пользователь видит, что переключатели заблокированы и
 *    понимает, что управление перешло к нашему модулю.
 *
 * `inventory-cache` пользовательской настройки не трогаем — на disable
 * атрибуты снимаем (контроль возвращается игре), но `usegrb` обратно в true
 * не выставляем: пользователь может оставить нативный сборщик off, если хочет.
 */

const NATIVE_INPUTS_SELECTOR = 'input[data-setting="usegrb"], .garbage-value, #garbage-save';
const SVP_DISABLED_MARKER = 'data-svp-disabled-by-cleanup';

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

  domObserver = new MutationObserver(() => {
    // installGeneration защищает от race условий, если callback пришёл
    // после быстрого uninstall→install (counter уже другой).
    if (myGeneration !== installGeneration) return;
    applyDisabledToNativeInputs();
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
}
