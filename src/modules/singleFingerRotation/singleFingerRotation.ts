import type { IFeatureModule } from '../../core/moduleRegistry';
import type { IDragPanControl, IOlMap, IOlView } from '../../core/olMap';
import { createDragPanControl, getOlMap } from '../../core/olMap';
import { $ } from '../../core/dom';

const MODULE_ID = 'singleFingerRotation';

let viewport: HTMLElement | null = null;
let map: IOlMap | null = null;
let dragPanControl: IDragPanControl | null = null;
let latestPoint: [number, number] | null = null;
let pendingDelta = 0;
let frameRequestId: number | null = null;
// Сохранённая ссылка на оригинальный view.calculateExtent, чтобы корректно
// восстановить его в disable(). null, когда обёртка не установлена.
let originalCalculateExtent: IOlView['calculateExtent'] | null = null;

function isFollowActive(): boolean {
  // Игра считает follow активным по умолчанию (null != 'false'),
  // неактивным — только при явном 'false' в localStorage.
  return localStorage.getItem('follow') !== 'false';
}

function getScreenCenter(): { x: number; y: number } {
  const padding = (map ? map.getView().padding : undefined) ?? [0, 0, 0, 0];
  const [top, right, bottom, left] = padding;
  return {
    x: (left + window.innerWidth - right) / 2,
    y: (top + window.innerHeight - bottom) / 2,
  };
}

function angleFromCenter(clientX: number, clientY: number): number {
  const center = getScreenCenter();
  return Math.atan2(clientY - center.y, clientX - center.x);
}

function normalizeAngleDelta(delta: number): number {
  if (delta > Math.PI) return delta - 2 * Math.PI;
  if (delta < -Math.PI) return delta + 2 * Math.PI;
  return delta;
}

function applyRotation(delta: number): void {
  if (!map) return;
  const view = map.getView();
  view.setRotation(view.getRotation() + delta);
}

function applyPendingRotation(): void {
  frameRequestId = null;
  const delta = pendingDelta;
  pendingDelta = 0;
  if (delta !== 0) {
    applyRotation(delta);
  }
}

function flushPendingRotation(): void {
  if (frameRequestId !== null) {
    cancelAnimationFrame(frameRequestId);
    frameRequestId = null;
  }
  if (pendingDelta !== 0) {
    applyRotation(pendingDelta);
    pendingDelta = 0;
  }
}

function scheduleRotationFrame(): void {
  if (frameRequestId === null) {
    frameRequestId = requestAnimationFrame(applyPendingRotation);
  }
}

function resetGesture(): void {
  flushPendingRotation();
  latestPoint = null;
  dragPanControl?.restore();
}

function onTouchStart(event: TouchEvent): void {
  if (event.targetTouches.length > 1) {
    resetGesture();
    return;
  }
  if (!isFollowActive()) return;
  if (!(event.target instanceof HTMLCanvasElement)) return;

  const touch = event.targetTouches[0];
  latestPoint = [touch.clientX, touch.clientY];
  dragPanControl?.disable();
}

function onTouchMove(event: TouchEvent): void {
  if (!latestPoint) return;

  event.preventDefault();

  const touch = event.targetTouches[0];
  const currentAngle = angleFromCenter(touch.clientX, touch.clientY);
  const previousAngle = angleFromCenter(latestPoint[0], latestPoint[1]);
  const delta = normalizeAngleDelta(currentAngle - previousAngle);

  pendingDelta += delta;
  scheduleRotationFrame();
  latestPoint = [touch.clientX, touch.clientY];
}

function onTouchEnd(): void {
  resetGesture();
}

function addListeners(): void {
  if (!viewport) return;
  viewport.addEventListener('touchstart', onTouchStart);
  viewport.addEventListener('touchmove', onTouchMove, { passive: false });
  viewport.addEventListener('touchend', onTouchEnd);
}

function removeListeners(): void {
  if (!viewport) return;
  viewport.removeEventListener('touchstart', onTouchStart);
  viewport.removeEventListener('touchmove', onTouchMove);
  viewport.removeEventListener('touchend', onTouchEnd);
}

/**
 * Оборачивает view.calculateExtent, расширяя область до диагонали вьюпорта.
 * Игра запрашивает точки через view.calculateExtent(map.getSize()), но
 * перезапрашивает только при смещении центра >30м или изменении зума —
 * поворот не вызывает перезагрузку. Расширяем extent до диагонали, чтобы
 * загруженная область покрывала любой угол поворота.
 *
 * Сохраняется ссылка на оригинал как есть (без bind): иначе каждый цикл
 * enable/disable наращивал бы слой bound-обёрток, и disable() не
 * восстанавливал бы исходную функцию by-reference. Контекст передаётся
 * через .call(view, ...) в самом wrapper'е.
 */
function installCalculateExtentWrapper(): void {
  if (!map || originalCalculateExtent !== null) return;
  const view = map.getView();
  // eslint-disable-next-line @typescript-eslint/unbound-method -- см. комментарий выше, контекст явно передаётся через .call(view, ...)
  const original = view.calculateExtent;
  originalCalculateExtent = original;
  view.calculateExtent = (size?: number[]) => {
    if (size) {
      const diagonal = Math.ceil(Math.sqrt(size[0] ** 2 + size[1] ** 2));
      return original.call(view, [diagonal, diagonal]);
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

export const singleFingerRotation: IFeatureModule = {
  id: MODULE_ID,
  name: {
    en: 'Single-Finger Map Rotation',
    ru: 'Вращение карты одним пальцем',
  },
  description: {
    en: 'Rotate map with circular finger gesture in FW mode',
    ru: 'Вращение карты круговым жестом одного пальца в режиме следования за игроком',
  },
  defaultEnabled: true,
  category: 'map',
  init() {
    // Защитный сброс на случай повторной инициализации: предыдущий view и
    // dragPanControl уже не актуальны, а ссылки на них привели бы к попытке
    // restore через мёртвый объект.
    originalCalculateExtent = null;
    dragPanControl = null;
    return getOlMap().then((olMap) => {
      map = olMap;
      // .ol-viewport создаётся конструктором ol.Map — гарантированно есть
      // в DOM к моменту резолва getOlMap(). waitForElement не используем,
      // чтобы не зависеть от его таймаута: если авторизация в игре длится
      // дольше 10с, waitForElement реджектится и модуль не инициализируется.
      const viewportElement = $('.ol-viewport');
      if (viewportElement instanceof HTMLElement) {
        viewport = viewportElement;
      }
    });
  },
  enable() {
    if (!map) return;
    installCalculateExtentWrapper();
    if (dragPanControl === null) {
      dragPanControl = createDragPanControl(map);
    }
    addListeners();
  },
  disable() {
    removeListeners();
    dragPanControl?.restore();
    dragPanControl = null;
    resetGesture();
    restoreCalculateExtentWrapper();
  },
};
