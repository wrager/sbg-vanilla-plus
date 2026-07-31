import { ANIMATION_SAFETY_MARGIN } from '../../core/popupSwipe';

const LAYER_CLASS = 'svp-xp-popup-layer';
const POPUP_CLASS = 'svp-xp-popup';
const DURATION_PROPERTY = '--svp-xp-popup-duration';
const SHIFT_X_PROPERTY = '--svp-xp-popup-shift-x';
const SHIFT_Y_PROPERTY = '--svp-xp-popup-shift-y';

/**
 * Длительность всплытия (мс). Единственный источник истины: CSS получает её
 * через custom property на слое, страховочный таймер удаления узла считает от
 * неё же. Второго объявления быть не должно - в CUI таймер на 3000мс не был
 * связан с длительностью перехода в стилях (refs/cui/index.js:2028-2029).
 */
export const XP_POPUP_ANIMATION_MS = 1200;

/**
 * Допустимые смещения от точки появления (px), по горизонтали и по вертикали
 * независимо. Значения серии выходят примерно из одного места, но не ложатся
 * ровно друг на друга: набор симметричен нулю, поэтому центр разброса совпадает
 * с самой точкой появления.
 */
const SHIFT_STEPS_PX = [-24, -12, 0, 12, 24];

/**
 * Больше пяти значений разом на экране нечитаемо; самое старое вытесняется.
 * В CUI лимита не было вовсе, и серия действий наслаивала узлы друг на друга.
 */
const MAX_LIVE_POPUPS = 5;

/** Верхняя панель игры (ник, опыт, инвентарь плюс строка кнопок меню). */
const TOP_PANEL_SELECTOR = '.topleft-container';
/** Отступ от нижней кромки верхней панели. */
const TOP_PANEL_GAP_PX = 12;
/** Позиция слоя, когда панели в DOM нет: её типовая нижняя кромка плюс отступ. */
const FALLBACK_TOP_PX = 132;

/** Единица опыта в подписи. Одна на любой язык игры, как в CUI. */
const XP_UNIT = 'xp';

interface ILivePopup {
  element: HTMLElement;
  fallbackTimer: ReturnType<typeof setTimeout>;
  onAnimationEnd: (event: AnimationEvent) => void;
}

let layer: HTMLElement | null = null;
const livePopups: ILivePopup[] = [];
/** Номер комбинации смещений у предыдущего значения; null - значений ещё не было. */
let lastShiftIndex: number | null = null;

/**
 * Снимает попап: убирает из списка живых, гасит страховочный таймер, отписывает
 * слушателя и удаляет узел. Идемпотентна - оба пути завершения (animationend и
 * страховочный таймер) ведут сюда, и второй пришедший не должен ни бросать, ни
 * трогать чужой узел.
 */
function finishPopup(record: ILivePopup): void {
  const index = livePopups.indexOf(record);
  if (index === -1) return;

  livePopups.splice(index, 1);
  clearTimeout(record.fallbackTimer);
  record.element.removeEventListener('animationend', record.onAnimationEnd);
  // remove(), а не removeChild(): не бросает, если узел уже отцеплён от слоя.
  record.element.remove();
}

function finishAllPopups(): void {
  while (livePopups.length > 0) finishPopup(livePopups[0]);
}

/**
 * Случайная пара смещений, заведомо не равная предыдущей: два значения подряд в
 * одной точке выглядели бы как одно застрявшее.
 *
 * Выбор идёт по номеру комбинации среди всех допустимых, а из набора
 * выбрасывается предыдущая. Перевыбор в цикле "пока не отличается" дал бы тот
 * же результат, но с ненулевой вероятностью лишних итераций и без гарантии
 * завершения.
 */
function pickShift(): { x: number; y: number } {
  const combinations = SHIFT_STEPS_PX.length * SHIFT_STEPS_PX.length;
  const available = lastShiftIndex === null ? combinations : combinations - 1;
  let index = Math.floor(Math.random() * available);
  // Пропуск занятого номера сохраняет равномерность по оставшимся комбинациям.
  if (lastShiftIndex !== null && index >= lastShiftIndex) index++;
  lastShiftIndex = index;

  return {
    x: SHIFT_STEPS_PX[index % SHIFT_STEPS_PX.length],
    y: SHIFT_STEPS_PX[Math.floor(index / SHIFT_STEPS_PX.length)],
  };
}

/**
 * Ставит верх слоя под нижнюю кромку верхней панели. Замер, а не константа и не
 * завязка на класс компактного режима: высота панели зависит от режима
 * enhancedMainScreen, языка и размера шрифта.
 *
 * Вызывается только в начале серии: getBoundingClientRect вынуждает браузер
 * посчитать раскладку, и звать его на каждый попап незачем - за время жизни
 * серии панель не переезжает.
 */
function positionLayer(): void {
  if (!layer) return;

  const panel = document.querySelector(TOP_PANEL_SELECTOR);
  const bottom = panel ? panel.getBoundingClientRect().bottom : 0;
  const top = bottom > 0 ? bottom + TOP_PANEL_GAP_PX : FALLBACK_TOP_PX;
  layer.style.top = `${Math.round(top)}px`;
}

/**
 * Знак ставится по значению: игра печатает "+" безусловно
 * (refs/game/script.js:2772) и на отрицательном приросте нарисовала бы "+-5".
 */
function formatXpDiff(diff: number): string {
  const sign = diff > 0 ? '+' : '';
  return `${sign}${diff} ${XP_UNIT}`;
}

export function createXpPopupLayer(): void {
  if (layer !== null) return;

  const element = document.createElement('div');
  element.className = LAYER_CLASS;
  element.style.setProperty(DURATION_PROPERTY, `${XP_POPUP_ANIMATION_MS}ms`);
  document.body.appendChild(element);
  layer = element;
  positionLayer();
}

export function destroyXpPopupLayer(): void {
  finishAllPopups();
  layer?.remove();
  layer = null;
  lastShiftIndex = null;
}

export function showXpPopup(diff: number): void {
  // Нулевой прирост игра тоже не показывает (refs/game/script.js:2768).
  if (diff === 0) return;
  // Модуль выключен - рисовать некуда.
  if (layer === null) return;
  /*
   * В скрытой вкладке кадры не идут: CSS-анимация не стартует, animationend не
   * приходит, и вернувшийся игрок увидел бы доигрывающее значение из прошлого.
   * Узлы, которые попали в фон уже созданными, снимет страховочный таймер.
   */
  if (document.visibilityState === 'hidden') return;

  if (livePopups.length === 0) positionLayer();
  if (livePopups.length >= MAX_LIVE_POPUPS) finishPopup(livePopups[0]);

  const element = document.createElement('div');
  element.className = POPUP_CLASS;
  element.textContent = formatXpDiff(diff);
  // Смещение выбирается один раз при вставке и дальше не меняется: правка
  // transform у живого узла посреди анимации дёргала бы значение на месте.
  const shift = pickShift();
  element.style.setProperty(SHIFT_X_PROPERTY, `${shift.x}px`);
  element.style.setProperty(SHIFT_Y_PROPERTY, `${shift.y}px`);

  const record: ILivePopup = {
    element,
    fallbackTimer: setTimeout(() => {
      finishPopup(record);
    }, XP_POPUP_ANIMATION_MS + ANIMATION_SAFETY_MARGIN),
    onAnimationEnd: (event) => {
      // Событие всплывает: без сверки target попап снимался бы по концу
      // анимации вложенного узла.
      if (event.target !== element) return;
      finishPopup(record);
    },
  };

  element.addEventListener('animationend', record.onAnimationEnd);
  livePopups.push(record);
  // Класс с анимацией уже на узле, поэтому она стартует сама: ни отложенного
  // добавления класса, ни принудительного reflow не нужно.
  layer.appendChild(element);
}
