import { t } from '../../core/l10n';
import { ANIMATION_SAFETY_MARGIN } from '../../core/popupSwipe';

const LAYER_CLASS = 'svp-xp-popup-layer';
const POPUP_CLASS = 'svp-xp-popup';
const DURATION_PROPERTY = '--svp-xp-popup-duration';
const OFFSET_PROPERTY = '--svp-xp-popup-offset';

/**
 * Длительность всплытия (мс). Единственный источник истины: CSS получает её
 * через custom property на слое, страховочный таймер удаления узла считает от
 * неё же. Второго объявления быть не должно - в CUI таймер на 3000мс не был
 * связан с длительностью перехода в стилях (refs/cui/index.js:2028-2029).
 */
export const XP_POPUP_ANIMATION_MS = 1200;

/**
 * Шаг стопки (px). Значения серии встают друг под другом, а не в одной точке:
 * иначе три действия подряд накладываются и не читаются вовсе.
 */
const STACK_STEP_PX = 26;

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

/** Подпись единицы опыта в разметке игры (refs/game/index.html:74). */
const XP_UNIT_SELECTOR = '[data-i18n="units.pts-xp"]';

interface ILivePopup {
  element: HTMLElement;
  /** Место в стопке: индекс от 0, умноженный на шаг, даёт смещение по вертикали. */
  slot: number;
  fallbackTimer: ReturnType<typeof setTimeout>;
  onAnimationEnd: (event: AnimationEvent) => void;
}

let layer: HTMLElement | null = null;
const livePopups: ILivePopup[] = [];
let cachedXpUnit: string | null = null;

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
 * Наименьшее свободное место в стопке. Отсчёт по занятым, а не по количеству
 * живых: значение из середины серии могло уже улететь, и его место надо занять
 * заново, иначе новое значение встало бы поверх соседнего.
 */
function nextFreeSlot(): number {
  const used = new Set(livePopups.map((popup) => popup.slot));
  for (let slot = 0; slot < MAX_LIVE_POPUPS; slot++) {
    if (!used.has(slot)) return slot;
  }
  return 0;
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
 * Единица опыта берётся из уже переведённой игрой разметки: игра локализует её
 * один раз при старте (refs/game/script.js:135), в DOM лежит готовая подпись на
 * языке игрока. Тот же приём, что в removeAttackCloseButton, где подпись
 * "Закрыть" читается с самой кнопки.
 *
 * Через i18next.t не идём: на неизвестном ключе i18next возвращает сам ключ, и
 * в попапе оказалось бы "+130 units.pts-xp".
 *
 * Кэшируется только удачное чтение: enable может случиться раньше, чем игра
 * переведёт разметку.
 */
function readXpUnit(): string {
  if (cachedXpUnit !== null) return cachedXpUnit;

  const unitElement = document.querySelector(XP_UNIT_SELECTOR);
  const text = unitElement?.textContent.trim();
  if (text) {
    cachedXpUnit = text;
    return text;
  }

  return t({ en: 'pts.', ru: 'очк.' });
}

/**
 * Формат повторяет нативную подпись (`+${diff} ${units.pts-xp}`,
 * refs/game/script.js:2772) - игрок видит ту же запись, только крупнее и по
 * центру. Знак ставится по значению: игра печатает "+" безусловно и на
 * отрицательном приросте нарисовала бы "+-5".
 */
function formatXpDiff(diff: number): string {
  const sign = diff > 0 ? '+' : '';
  return `${sign}${diff} ${readXpUnit()}`;
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
  cachedXpUnit = null;
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
  // Место закрепляется за значением на всю его жизнь: пересчитывать стопку при
  // каждом уходе значило бы переписывать transform чужим узлам посреди их
  // анимации, и вся серия дёргалась бы вверх на каждом снятии.
  const slot = nextFreeSlot();
  element.style.setProperty(OFFSET_PROPERTY, `${slot * STACK_STEP_PX}px`);

  const record: ILivePopup = {
    element,
    slot,
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
