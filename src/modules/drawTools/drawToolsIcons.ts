// SVG-иконки для кнопок drawTools.
// Большинство — свои минималистичные (24x24 viewBox, currentColor), потому что
// игровой набор fas-* неполный (нет eraser/clear), из-за чего D и R до этого
// получали одну и ту же fas-trash-can.
// Исключения, использующие игровой spritesheet через `<use href="#fas-*">`:
//   - ICON_WAND — у игры есть готовая `fas-wand-magic-sparkles` нужного нам стиля.
//
// `style="fill:none"` (inline style) ставится на каждую замкнутую фигуру outline-иконок
// (polygon, path, rect, circle, если она обводка), а не только на корневой
// `<svg fill="none">`: на странице SBG в каскаде есть CSS-правила, которые
// фактически перебивают presentation-атрибут `fill` на потомках. Inline style
// побеждает любой author CSS, и мы гарантируем, что треугольник/ластик/копия/
// корзина рендерятся именно как контур, а не как залитый силуэт.

const SVG_OPEN =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16"' +
  ' fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"' +
  ' stroke-linejoin="round" class="svp-draw-tools-icon">';

const SVG_CLOSE = '</svg>';

// Атрибут для замкнутых outline-фигур: inline-стиль выигрывает у любого CSS.
const NO_FILL = ' style="fill:none"';

function svg(body: string): string {
  return `${SVG_OPEN}${body}${SVG_CLOSE}`;
}

// Линия — две залитые точки (это намеренно filled, маркеры вершин)
// соединены диагональным отрезком.
export const ICON_LINE = svg(
  '<circle cx="6" cy="18" r="2.2" fill="currentColor" stroke="none"/>' +
    '<circle cx="18" cy="6" r="2.2" fill="currentColor" stroke="none"/>' +
    '<line x1="7.5" y1="16.5" x2="16.5" y2="7.5"/>',
);

// Треугольник — контурный, вершиной вверх
export const ICON_TRIANGLE = svg(`<polygon${NO_FILL} points="12,4 20,20 4,20"/>`);

// Редактирование — перо над линией: классический pen-tool (Lucide edit-3),
// тело пера диагональю в правом верхнем углу + горизонтальная подложка снизу,
// явный «писать по линии» вид.
export const ICON_EDIT = svg(
  `<path${NO_FILL} d="M12 20h9"/>` +
    `<path${NO_FILL} d="M16.5 3.5a2.121 2.121 0 113 3L7 19l-4 1 1-4z"/>`,
);

// Удаление по клику — ластик (Lucide eraser): универсально читаемая иконка
// «убрать одну штуку», прошедшая user-testing в стандартных наборах.
// Мой прежний вариант «круг с крестом внутри» считывался как «no entry» / «stop»,
// а не как точечное удаление.
export const ICON_DELETE = svg(
  `<path${NO_FILL} d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"/>` +
    `<path${NO_FILL} d="M22 21H7"/>` +
    `<path${NO_FILL} d="m5 11 9 9"/>`,
);

// Привязка к точкам — игровая `fas-wand-magic-sparkles` через <use>: один
// визуальный язык с остальной игрой. viewBox и пропорции у игровой иконки
// 0 0 586 512, поэтому здесь свой preamble.
export const ICON_WAND =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 586 512" width="16" height="16"' +
  ' fill="currentColor" class="svp-draw-tools-icon">' +
  '<use href="#fas-wand-magic-sparkles"/>' +
  SVG_CLOSE;

// Копирование — две перекрывающиеся рамки (clipboard stack)
export const ICON_COPY = svg(
  `<rect${NO_FILL} x="9" y="3" width="12" height="14" rx="2"/>` +
    `<rect${NO_FILL} x="3" y="7" width="12" height="14" rx="2"/>`,
);

// Импорт / upload — стрелка вверх над горизонтальной линией
export const ICON_UPLOAD = svg(
  `<path${NO_FILL} d="M12 16V4"/>` +
    `<path${NO_FILL} d="M7 9l5-5 5 5"/>` +
    '<line x1="3" y1="20" x2="21" y2="20"/>',
);

// Полный сброс — мусорная корзина с крышкой и двумя вертикалями (отличается от mishени удаления)
export const ICON_RESET = svg(
  '<line x1="3" y1="6" x2="21" y2="6"/>' +
    `<path${NO_FILL} d="M5 6l1 14h12l1-14"/>` +
    `<path${NO_FILL} d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/>` +
    '<line x1="10" y1="11" x2="10" y2="17"/>' +
    '<line x1="14" y1="11" x2="14" y2="17"/>',
);

// Закрытие toolbar — самостоятельный крест без обводки (отличается от ICON_DELETE)
export const ICON_CLOSE_X = svg(
  '<line x1="6" y1="6" x2="18" y2="18"/>' + '<line x1="6" y1="18" x2="18" y2="6"/>',
);

// Иконка кнопки запуска модуля (DT) — перо, обводящее волнистую линию.
export const ICON_DRAW_TOOLS = svg(
  `<path${NO_FILL} d="M3 19c2-2 4-2 6 0s4 2 6 0"/>` +
    `<path${NO_FILL} d="M14 5l4 4-7 7-5 1 1-5z"/>`,
);
