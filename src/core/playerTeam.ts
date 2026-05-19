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
  // В реальном браузере SBG ставит var(--team-N) через jQuery .css() - оба
  // способа (element.style.color и getAttribute('style')) возвращают эту
  // строку. В jsdom CSS-значения с var(...) отбрасываются из CSSStyleDeclaration
  // при setAttribute('style', ...), но сохраняются в исходной строке атрибута;
  // обратно, при прямом element.style.color = '...' jsdom сохраняет в style.color,
  // но не сериализует в атрибут. Чтобы тесты могли использовать любой из двух
  // путей задания стиля, проверяем оба источника.
  const candidates = [element.style.color, element.getAttribute('style') ?? ''];
  for (const candidate of candidates) {
    const match = /var\(--team-(\d+)\)/.exec(candidate);
    if (match) {
      const team = parseInt(match[1], 10);
      if (Number.isFinite(team)) return team;
    }
  }
  return null;
}
