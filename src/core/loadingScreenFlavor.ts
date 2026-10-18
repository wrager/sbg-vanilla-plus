import { injectStyles, removeStyles } from './dom';
import { SVP_FLAVOR } from './sbgFlavor';

const STYLE_ID = 'loading-screen-flavor';
const VERSION_SELECTOR = '.loading-screen__version';

/**
 * Дописывает идентификатор скрипта к версии игры на загрузочном экране:
 * `Stock/0.7.0, VanillaPlus/x.y.z`.
 *
 * Вызывается в document-start, до детекта версии игры: игра пишет свой flavor
 * в `.loading-screen__version` (refs/game/script.js:139) сразу после загрузки
 * i18n, то есть раньше, чем приходит ответ на первый запрос `/api/*`, из
 * которого мы читаем `x-sbg-version`. Ожидание детекта оставляло бы на экране
 * одну версию игры на всё время этого запроса.
 *
 * Метка добавляется псевдоэлементом, а не записью в `textContent`: игра
 * перезаписывает содержимое элемента целиком и позже нашего старта, так что
 * текстовая запись была бы затёрта.
 *
 * `:not(:empty)` держит метку скрытой, пока игра не написала свою версию: в
 * разметке элемент пустой (refs/game/index.html:68), и между нашим стартом и
 * записью игры на экране висела бы одна наша версия с ведущей запятой.
 */
export function showLoadingScreenFlavor(): void {
  injectStyles(`${VERSION_SELECTOR}:not(:empty)::after { content: ', ${SVP_FLAVOR}'; }`, STYLE_ID);
}

/** Убирает метку, если скрипт не работает на этой версии игры. */
export function hideLoadingScreenFlavor(): void {
  removeStyles(STYLE_ID);
}
