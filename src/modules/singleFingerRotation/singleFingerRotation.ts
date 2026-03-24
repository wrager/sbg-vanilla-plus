import type { IFeatureModule } from '../../core/moduleRegistry';
import type { IOlInteraction, IOlMap } from '../../core/olMap';
import { findDragPanInteractions, getOlMap } from '../../core/olMap';
import { $ } from '../../core/dom';

const MODULE_ID = 'singleFingerRotation';

let viewport: HTMLElement | null = null;
let map: IOlMap | null = null;
let latestPoint: [number, number] | null = null;
let inflateExtent = false;
let enabled = false;
let disabledDragPanInteractions: IOlInteraction[] = [];

function isFollowActive(): boolean {
  return localStorage.getItem('follow') === 'true';
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

function disableDragPan(): void {
  if (!map) return;
  disabledDragPanInteractions = findDragPanInteractions(map);
  for (const interaction of disabledDragPanInteractions) {
    interaction.setActive(false);
  }
}

function restoreDragPan(): void {
  for (const interaction of disabledDragPanInteractions) {
    interaction.setActive(true);
  }
  disabledDragPanInteractions = [];
}

function resetGesture(): void {
  latestPoint = null;
  restoreDragPan();
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
  disableDragPan();
}

function onTouchMove(event: TouchEvent): void {
  if (!latestPoint) return;

  event.preventDefault();

  const touch = event.targetTouches[0];
  const currentAngle = angleFromCenter(touch.clientX, touch.clientY);
  const previousAngle = angleFromCenter(latestPoint[0], latestPoint[1]);
  const delta = normalizeAngleDelta(currentAngle - previousAngle);

  applyRotation(delta);
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
    restoreDragPan();
    resetGesture();
  },
};
