import { injectStyles, removeStyles } from './dom';

const STACK_CSS_ID = 'olControlStack';
const STACK_ITEM_CLASS = 'svp-ol-stack-item';
const STACK_INDEX_PROPERTY = '--svp-ol-stack-index';
const REGION_PICKER_SELECTOR = '.region-picker.ol-unselectable.ol-control';

/**
 * Общий CSS для всех элементов стека под `.region-picker`. Каждый элемент
 * абсолютно позиционируется тем же `top: 50%; left: 0.5em` что и picker,
 * вертикальное смещение задаётся через `var(--svp-ol-stack-index)` (1, 2,
 * 3...), который helper выставляет на инлайновый style элемента при
 * пересортировке. Media-queries дублируют игровой `.region-picker button`
 * (см. game style 0.6.1.css) - размер шрифта кнопки увеличивается на узких
 * viewport'ах. SVG масштабируется от font-size кнопки.
 */
const STACK_CSS = `
.${STACK_ITEM_CLASS} {
  position: absolute;
  top: 50%;
  left: 0.5em;
  transform: translateY(calc(100% + 100% * var(${STACK_INDEX_PROPERTY}, 1)));
}
@media (max-width: 425px) {
  .${STACK_ITEM_CLASS} button {
    font-size: 1.5em;
  }
}
@media (max-width: 320px) {
  .${STACK_ITEM_CLASS} button {
    font-size: 1em;
  }
}
.${STACK_ITEM_CLASS} button svg {
  display: block;
  margin: auto;
  width: 1em;
  height: 1em;
}
`;

interface IRegisteredItem {
  priority: number;
  element: HTMLElement;
}

const registry: IRegisteredItem[] = [];
let mutationObserver: MutationObserver | null = null;
let rafId: number | null = null;

function arrange(): void {
  const picker = document.querySelector<HTMLElement>(REGION_PICKER_SELECTOR);
  if (!picker) return;
  const sorted = [...registry].sort((a, b) => a.priority - b.priority);
  let previous: Element = picker;
  for (let i = 0; i < sorted.length; i++) {
    const item = sorted[i];
    item.element.classList.add(STACK_ITEM_CLASS);
    item.element.style.setProperty(STACK_INDEX_PROPERTY, String(i + 1));
    // .after() перемещает элемент, если он уже в DOM (а не дублирует).
    previous.after(item.element);
    previous = item.element;
  }
}

function schedule(): void {
  if (rafId !== null) return;
  rafId = requestAnimationFrame(() => {
    rafId = null;
    arrange();
  });
}

function ensureObserver(): void {
  if (mutationObserver) return;
  injectStyles(STACK_CSS, STACK_CSS_ID);
  // childList: true без subtree - наблюдаем за прямыми детьми body
  // (region-picker - прямой ребёнок body; см. refs/game/dom/body.html).
  // Без subtree callback не дёргается на каждую DOM-мутацию игры
  // (попапы, инвентарь, ввод) - только на пересоздание самого picker'а
  // или наших siblings.
  mutationObserver = new MutationObserver(() => {
    schedule();
  });
  mutationObserver.observe(document.body, { childList: true });
}

/**
 * Регистрирует элемент в стеке под `.region-picker`. Помещается после picker'а
 * в порядке возрастания priority (меньше priority - ближе к picker). Если
 * picker ещё не в DOM, элемент попадёт на место при появлении picker'а через
 * MutationObserver. Возвращает unregister, который убирает элемент из DOM и
 * перенумеровывает оставшиеся.
 *
 * Применять единственный класс STACK_ITEM_CLASS и custom property
 * `--svp-ol-stack-index` для расположения. Модуль ставит свои стили
 * (background-color, border, icon-стили) на собственных классах поверх; общий
 * каскад (`.svp-ol-stack-item` -> position/top/left/transform; на mobile -
 * font-size кнопки 1.5em; SVG-иконка - 1em) приходит из helper'а.
 */
export function registerOlControl(priority: number, element: HTMLElement): () => void {
  ensureObserver();
  const item: IRegisteredItem = { priority, element };
  registry.push(item);
  // Синхронная вставка при наличии picker - чтобы вызывающий код мог сразу
  // обратиться к element.isConnected без ожидания rAF. Последующие
  // перерасстановки от MutationObserver идут через rAF-debounce.
  arrange();
  return () => {
    const index = registry.indexOf(item);
    if (index === -1) return;
    registry.splice(index, 1);
    element.classList.remove(STACK_ITEM_CLASS);
    element.style.removeProperty(STACK_INDEX_PROPERTY);
    element.remove();
    if (registry.length === 0) {
      mutationObserver?.disconnect();
      mutationObserver = null;
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      removeStyles(STACK_CSS_ID);
    } else {
      schedule();
    }
  };
}

/** Тестовый сброс глобального состояния стека. Только для тестов. */
export function resetOlControlStackForTest(): void {
  for (const item of registry) {
    item.element.classList.remove(STACK_ITEM_CLASS);
    item.element.style.removeProperty(STACK_INDEX_PROPERTY);
    item.element.remove();
  }
  registry.length = 0;
  mutationObserver?.disconnect();
  mutationObserver = null;
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  removeStyles(STACK_CSS_ID);
}
