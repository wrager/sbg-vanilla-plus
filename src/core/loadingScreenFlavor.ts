import { injectStyles } from './dom';
import { SVP_FLAVOR } from './sbgFlavor';

const STYLE_ID = 'loading-screen-flavor';
const VERSION_SELECTOR = '.loading-screen__version';

/**
 * Дописывает идентификатор скрипта к версии игры на загрузочном экране:
 * `Stock/0.7.0 VanillaPlus/x.y.z`.
 *
 * Игра пишет свой flavor в `.loading-screen__version` через `textContent` на
 * шаге загрузки `self` (refs/game/script.js:139), то есть позже нашего
 * старта и с полной перезаписью содержимого. Псевдоэлемент переживает эту
 * запись, поэтому наблюдать за элементом или гоняться с игрой за порядок
 * записи не нужно.
 */
export function showLoadingScreenFlavor(): void {
  injectStyles(`${VERSION_SELECTOR}::after { content: ' ${SVP_FLAVOR}'; }`, STYLE_ID);
}
