import { INVENTORY_CACHE_KEY } from './inventoryCache';
import { isInventoryReference } from './inventoryTypes';

/**
 * Нативный API SBG 0.6.1 для пометки стопки ключей флагом favorite/locked
 * через `POST /api/marks` (refs/game/script.js:1300). Эндпоинт работает на
 * уровне СТОПКИ ключей (`item.g`), не на уровне точки: lock-флаг живёт в
 * битовом поле `f` стопки.
 */

export type MarkFlag = 'favorite' | 'locked';

/**
 * Биты в `inventory-cache`-стопке (`item.f`):
 * бит 0 — favorite, бит 1 — locked.
 * Соответствует логике `is_fav = !!(item?.f & 0b1)` в refs/game/script.js:3404.
 */
export const MARK_FLAG_BITS: Record<MarkFlag, number> = {
  favorite: 0b01,
  locked: 0b10,
};

interface IMarkOutcome {
  /** Сетевой запрос завершился без исключения и `response.ok === true`. */
  networkOk: boolean;
  /** `result === true` означает, что флаг УСТАНОВЛЕН (поставлен) после toggle. */
  result: boolean;
}

/**
 * Сервер отдаёт ответ напрямую, без вложения в `response`. `result === true`
 * означает, что флаг УСТАНОВЛЕН после toggle, `false` — снят.
 *
 * Любой другой формат ответа трактуется как `result: false` — безопасный
 * дефолт: серверный флаг не считается установленным, кэш не обновляется.
 * Лучше лишний retry, чем подмена смысла.
 */
function parseMarksResult(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  if (!('result' in value)) return false;
  return value.result === true;
}

/**
 * Обновляет бит флага у стопки в `localStorage['inventory-cache']`. Повторяет
 * логику игры (refs/game/script.js:1320-1327): после успешного marks-запроса
 * через нативную кнопку игра локально пересобирает поле `f` через Bitfield.put.
 * Без нашего собственного обновления при reload игра прочитает устаревший кэш
 * без бита — пометка не появится в инвентаре.
 *
 * `on === true` устанавливает бит, `false` — снимает. Безопасно к запуску, если
 * стопка с таким `g` отсутствует в кэше: просто no-op.
 */
function applyFlagToCache(stackGuid: string, flag: MarkFlag, on: boolean): void {
  const raw = localStorage.getItem(INVENTORY_CACHE_KEY);
  if (raw === null) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return;
  }
  if (!Array.isArray(parsed)) return;

  const bit = MARK_FLAG_BITS[flag];
  let mutated = false;
  for (const item of parsed) {
    if (!isInventoryReference(item)) continue;
    if (item.g !== stackGuid) continue;
    const current = item.f ?? 0;
    const next = on ? current | bit : current & ~bit;
    if (next !== current) {
      item.f = next;
      mutated = true;
    }
    break;
  }
  if (mutated) localStorage.setItem(INVENTORY_CACHE_KEY, JSON.stringify(parsed));
}

/**
 * Отправляет один `POST /api/marks` с `{ guid, flag }`. Игровая `apiSend` —
 * IIFE-внутренняя функция, недоступна юзерскрипту: используем прямой fetch
 * с auth-токеном, как в `inventoryApi.deleteInventoryItems`.
 *
 * После успешного ответа синхронизирует `inventory-cache` локально, чтобы
 * пометка появилась без перезагрузки и сохранилась при reload.
 */
export async function postMark(itemGuid: string, flag: MarkFlag): Promise<IMarkOutcome> {
  const token = localStorage.getItem('auth');
  if (!token) return { networkOk: false, result: false };

  try {
    const response = await fetch('/api/marks', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ guid: itemGuid, flag }),
    });
    if (!response.ok) return { networkOk: false, result: false };
    const json: unknown = await response.json();
    const result = parseMarksResult(json);
    // Сервер сообщил итоговое состояние флага после toggle: true = поставлен,
    // false = снят. В обоих случаях обновляем кэш под актуальный сервером state.
    applyFlagToCache(itemGuid, flag, result);
    return { networkOk: true, result };
  } catch {
    return { networkOk: false, result: false };
  }
}
