// SVG-иконки для кнопок drawTools.
// Большинство — свои минималистичные (24x24 viewBox, currentColor), потому что
// игровой набор fas-* неполный (нет eraser/clear), из-за чего D и R до этого
// получали одну и ту же fas-trash-can.
// Исключения, использующие игровой spritesheet через `<use href="#fas-*">`:
//   - ICON_WAND — у игры есть готовая `fas-wand-magic-sparkles` нужного нам стиля.

const SVG_OPEN_TOOLBAR =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16"' +
  ' fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"' +
  ' stroke-linejoin="round" class="svp-draw-tools-icon">';

// Кнопка модуля DT крупнее (32x32, под region-picker), потому SVG 20x20 —
// иначе иконка теряется в пустом пространстве.
const SVG_OPEN_CONTROL =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20"' +
  ' fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"' +
  ' stroke-linejoin="round" class="svp-draw-tools-icon">';

const SVG_CLOSE = '</svg>';

function svg(body: string): string {
  return `${SVG_OPEN_TOOLBAR}${body}${SVG_CLOSE}`;
}

function svgControl(body: string): string {
  return `${SVG_OPEN_CONTROL}${body}${SVG_CLOSE}`;
}

// Линия — две точки соединены диагональным отрезком
export const ICON_LINE = svg(
  '<circle cx="6" cy="18" r="2.2" fill="currentColor" stroke="none"/>' +
    '<circle cx="18" cy="6" r="2.2" fill="currentColor" stroke="none"/>' +
    '<line x1="7.5" y1="16.5" x2="16.5" y2="7.5"/>',
);

// Треугольник — контурный, вершиной вверх
export const ICON_TRIANGLE = svg('<polygon points="12,4 20,20 4,20"/>');

// Редактирование — перо над линией: классический pen-tool (Lucide edit-3),
// тело пера диагональю в правом верхнем углу + горизонтальная подложка снизу,
// явный «писать по линии» вид.
export const ICON_EDIT = svg(
  '<path d="M12 20h9"/>' + '<path d="M16.5 3.5a2.121 2.121 0 113 3L7 19l-4 1 1-4z"/>',
);

// Удаление по клику — ластик (Lucide eraser): универсально читаемая иконка
// «убрать одну штуку», прошедшая user-testing в стандартных наборах.
// Мой прежний вариант «круг с крестом внутри» считывался как «no entry» / «stop»,
// а не как точечное удаление.
export const ICON_DELETE = svg(
  '<path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"/>' +
    '<path d="M22 21H7"/>' +
    '<path d="m5 11 9 9"/>',
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
  '<rect x="9" y="3" width="12" height="14" rx="2"/>' +
    '<rect x="3" y="7" width="12" height="14" rx="2"/>',
);

// Импорт / upload — стрелка вверх над горизонтальной линией
export const ICON_UPLOAD = svg(
  '<path d="M12 16V4"/>' + '<path d="M7 9l5-5 5 5"/>' + '<line x1="3" y1="20" x2="21" y2="20"/>',
);

// Полный сброс — мусорная корзина с крышкой и двумя вертикалями (отличается от mishени удаления)
export const ICON_RESET = svg(
  '<line x1="3" y1="6" x2="21" y2="6"/>' +
    '<path d="M5 6l1 14h12l1-14"/>' +
    '<path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/>' +
    '<line x1="10" y1="11" x2="10" y2="17"/>' +
    '<line x1="14" y1="11" x2="14" y2="17"/>',
);

// Закрытие toolbar — самостоятельный крест без обводки (отличается от ICON_DELETE)
export const ICON_CLOSE_X = svg(
  '<line x1="6" y1="6" x2="18" y2="18"/>' + '<line x1="6" y1="18" x2="18" y2="6"/>',
);

// Иконка кнопки запуска модуля (DT) — перо, обводящее волнистую линию.
// 20x20 (см. SVG_OPEN_CONTROL), потому что родитель крупнее тулбара.
export const ICON_DRAW_TOOLS = svgControl(
  '<path d="M3 19c2-2 4-2 6 0s4 2 6 0"/>' + '<path d="M14 5l4 4-7 7-5 1 1-5z"/>',
);
