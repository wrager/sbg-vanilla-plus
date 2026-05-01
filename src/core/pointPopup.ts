/**
 * CSS-селектор попапа точки игры. В DOM игры один элемент с двумя классами
 * info+popup (refs/game/index.html:299: `<div class="info popup hidden">`),
 * других элементов с обоими классами нет. Используем эту пару как канонический
 * селектор: `.info.popup` исключает settings-popup / layers-popup / прочие
 * `.popup` диалоги, а пара классов однозначнее, чем одиночный `.info`, и
 * стабильна при возможном будущем переиспользовании одного из классов на
 * других DOM-узлах.
 */
export const POINT_POPUP_SELECTOR = '.info.popup';
