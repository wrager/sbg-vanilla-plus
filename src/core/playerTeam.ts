/**
 * Команда (фракция) текущего игрока.
 *
 * Источник правды - inline `style.color` элемента `#self-info__name`: игра
 * (refs/game/script.js) выставляет `$('#self-info__name').css('color',
 * 'var(--team-${self_data.t})')` после login/refresh. Альтернативного
 * программного API у нас нет (`self_data` живёт в IIFE-замыкании игры).
 *
 * Возвращает `null`, если элемент отсутствует или color не соответствует
 * ожидаемому формату `var(--team-N)`. Вызывающий обязан явно решить, что
 * делать в этом случае: блокировать операцию (slow cleanup), пропустить
 * фильтр (refsOnMap при выключенном keepOwnTeam), и т. д.
 */
export function getPlayerTeam(): number | null {
  const element = document.getElementById('self-info__name');
  if (!element) return null;
  const match = /var\(--team-(\d+)\)/.exec(element.style.color);
  if (!match) return null;
  const team = parseInt(match[1], 10);
  return Number.isFinite(team) ? team : null;
}
