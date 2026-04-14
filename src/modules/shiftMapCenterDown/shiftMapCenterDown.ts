import type { IFeatureModule } from '../../core/moduleRegistry';
import type { IOlMap, IOlView } from '../../core/olMap';
import { getOlMap } from '../../core/olMap';

const MODULE_ID = 'shiftMapCenterDown';
const PADDING_FACTOR = 0.35;
const ACTION_PANEL_SELECTORS = '.attack-slider-wrp, .draw-slider-wrp';

let map: IOlMap | null = null;
let topPadding = 0;
let actionObserver: MutationObserver | null = null;
let actionPanelActive = false;
let actionRafId: number | null = null;
// Сохранённая ссылка на оригинальный view.calculateExtent, чтобы корректно
// восстановить его в disable(). null, когда обёртка не установлена.
let originalCalculateExtent: IOlView['calculateExtent'] | null = null;

/** Применить padding к view, сохраняя текущий центр карты. */
function applyPadding(padding: number[]): void {
  if (!map) return;
  const view = map.getView();
  // Сохраняем центр ДО смены padding: OL's padding setter корректирует
  // центр в координатном пространстве (без учёта rotation), а рендеринг
  // (getState) применяет padding в экранном (с rotation). Если не
  // восстановить центр, при повороте карты сдвиг пойдёт не вниз.
  const center = view.getCenter();
  view.padding = padding;
  view.setCenter(center);
}

/** Проверить текущее состояние панелей и переключить padding. */
function handleActionPanelChange(): void {
  const openPanel = document.querySelector<HTMLElement>(
    '.attack-slider-wrp:not(.hidden), .draw-slider-wrp:not(.hidden)',
  );

  if (openPanel && !actionPanelActive) {
    actionPanelActive = true;
    const panelHeight = openPanel.getBoundingClientRect().height;
    applyPadding([0, 0, panelHeight, 0]);
  } else if (!openPanel && actionPanelActive) {
    actionPanelActive = false;
    applyPadding([topPadding, 0, 0, 0]);
  }
}

function startActionObserver(): void {
  stopActionObserver();
  const panels = document.querySelectorAll(ACTION_PANEL_SELECTORS);
  if (panels.length === 0) return;

  // RAF-батчинг: getBoundingClientRect в колбэке MutationObserver вызывает
  // принудительный layout reflow. Откладываем до следующего кадра и проверяем
  // текущее состояние DOM, а не mutation records.
  actionObserver = new MutationObserver(() => {
    if (actionRafId !== null) return;
    actionRafId = requestAnimationFrame(() => {
      actionRafId = null;
      handleActionPanelChange();
    });
  });

  for (const panel of panels) {
    actionObserver.observe(panel, {
      attributes: true,
      attributeFilter: ['class'],
    });
  }
}

function stopActionObserver(): void {
  if (actionRafId !== null) {
    cancelAnimationFrame(actionRafId);
    actionRafId = null;
  }
  actionObserver?.disconnect();
  actionObserver = null;
}

/**
 * Устанавливает обёртку на view.calculateExtent, которая увеличивает height
 * на topPadding. Игра вызывает calculateExtent(map.getSize()) для определения
 * видимой области и загрузки точек. OL при наличии padding уменьшает эту
 * область, из-за чего точки в padding-зоне не загружаются. Компенсируем.
 *
 * Идемпотентна: повторный вызов — no-op (не оборачивает уже обёрнутое).
 */
function installCalculateExtentWrapper(): void {
  if (!map || originalCalculateExtent !== null) return;
  const view = map.getView();
  // Сохраняем ровно то, что лежит в view.calculateExtent сейчас, без .bind():
  // иначе каждый цикл enable/disable наращивал бы слой bound-обёрток, и
  // disable() не восстанавливал бы исходную функцию by-reference. Контекст
  // восстанавливаем через .call(view, ...) в самом wrapper'е.
  // eslint-disable-next-line @typescript-eslint/unbound-method -- см. комментарий выше, контекст явно передаётся через .call(view, ...)
  const original = view.calculateExtent;
  originalCalculateExtent = original;
  view.calculateExtent = (size?: number[]) => {
    if (size) {
      return original.call(view, [size[0], size[1] + topPadding]);
    }
    return original.call(view, size);
  };
}

/** Возвращает view.calculateExtent в исходное состояние. Идемпотентна. */
function restoreCalculateExtentWrapper(): void {
  if (!map || originalCalculateExtent === null) return;
  const view = map.getView();
  view.calculateExtent = originalCalculateExtent;
  originalCalculateExtent = null;
}

export const shiftMapCenterDown: IFeatureModule = {
  id: MODULE_ID,
  name: { en: 'Shift Map Center Down', ru: 'Сдвиг центра карты вниз' },
  description: {
    en: 'Moves map center down so you see more ahead while moving',
    ru: 'Сдвигает центр карты вниз, чтобы видеть больше карты впереди по ходу движения',
  },
  defaultEnabled: true,
  category: 'map',
  init() {
    topPadding = Math.round(window.innerHeight * PADDING_FACTOR);
    // Защитный сброс на случай повторной инициализации: view, на который
    // ссылается originalCalculateExtent, после предыдущего init() уже не
    // актуален и попытка restore через него испортит свежий view.
    originalCalculateExtent = null;
    actionPanelActive = false;
    return getOlMap().then((olMap) => {
      map = olMap;
    });
  },
  enable() {
    installCalculateExtentWrapper();
    applyPadding([topPadding, 0, 0, 0]);
    startActionObserver();
  },
  disable() {
    stopActionObserver();
    actionPanelActive = false;
    applyPadding([0, 0, 0, 0]);
    restoreCalculateExtentWrapper();
  },
};
