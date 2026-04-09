import type { IFeatureModule } from '../../core/moduleRegistry';
import type { IDragPanControl, IOlMap } from '../../core/olMap';
import { createDragPanControl, getOlMap } from '../../core/olMap';
import { $ } from '../../core/dom';

const MODULE_ID = 'singleFingerRotation';

let viewport: HTMLElement | null = null;
let map: IOlMap | null = null;
let dragPanControl: IDragPanControl | null = null;
let latestPoint: [number, number] | null = null;
let inflateExtent = false;
let enabled = false;
let pendingDelta = 0;
let frameRequestId: number | null = null;

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
    return getOlMap().then((olMap) => {
      map = olMap;
      dragPanControl = createDragPanControl(olMap);

      // .ol-viewport создаётся конструктором ol.Map — гарантированно есть
      // в DOM к моменту резолва getOlMap(). waitForElement не используем,
      // чтобы не зависеть от его таймаута: если авторизация в игре длится
      // дольше 10с, waitForElement реджектится и модуль не инициализируется.
      const viewportElement = $('.ol-viewport');
      if (viewportElement instanceof HTMLElement) {
        viewport = viewportElement;
      }

      // Игра запрашивает точки через view.calculateExtent(map.getSize()),
      // но перезапрашивает только при смещении центра >30м или изменении
      // зума — поворот не вызывает перезагрузку. Расширяем extent до
      // диагонали вьюпорта, чтобы загруженная область покрывала любой
      // угол поворота (аналогично shiftMapCenterDown для padding).
      // Wrapper создаётся один раз, переключается флагом в enable/disable.
      const view = olMap.getView();
      const originalCalculateExtent = view.calculateExtent.bind(view);
      view.calculateExtent = (size?: number[]) => {
        if (inflateExtent && size) {
          const diagonal = Math.ceil(Math.sqrt(size[0] ** 2 + size[1] ** 2));
          return originalCalculateExtent([diagonal, diagonal]);
        }
        return originalCalculateExtent(size);
      };

      if (enabled) {
        addListeners();
      }
    });
  },
  enable() {
    enabled = true;
    inflateExtent = true;
    addListeners();
  },
  disable() {
    enabled = false;
    inflateExtent = false;
    removeListeners();
    dragPanControl?.restore();
    resetGesture();
  },
};
