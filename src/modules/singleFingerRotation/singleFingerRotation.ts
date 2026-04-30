import type { IFeatureModule } from '../../core/moduleRegistry';
import type { IDragPanControl, IOlMap, IOlView } from '../../core/olMap';
import { createDragPanControl, getOlMap } from '../../core/olMap';
import { $ } from '../../core/dom';

const MODULE_ID = 'singleFingerRotation';

// Окно double-tap (ms) и максимальный сдвиг между первым и вторым тапом (px),
// после которого second-touchstart считается началом нативного жеста ngrsZoom
// (в SBG 0.6.1 — `ol.interaction.DblClickDragZoom`, refs/game-beta/script.js:782).
// Значения совпадают с теми, что использовала наша прошлая реализация ngrsZoom
// (см. удалённый коммит a086ca6).
const NGRS_DOUBLE_TAP_GAP_MS = 300;
const NGRS_DOUBLE_TAP_DISTANCE_PX = 30;

let viewport: HTMLElement | null = null;
let map: IOlMap | null = null;
let dragPanControl: IDragPanControl | null = null;
let latestPoint: [number, number] | null = null;
let pendingDelta = 0;
let frameRequestId: number | null = null;
// State machine для подавления rotation во время нативного жеста ngrsZoom:
// `lastTapEndTime`/`lastTapEndX/Y` — момент и координата последнего touchend.
// Когда новый touchstart попадает в окно double-tap (и близко к месту), ставим
// `suppressedAfterDoubleTap = true` — вся последующая серия touch до touchend
// игнорируется: ни rotation, ни DragPan-disable. Это повторяет поведение нашей
// прошлой реализации (ngrsZoom + singleFingerRotation), где после двойного тапа
// карту нельзя было поворачивать в принципе. Анализ направления первого move
// (вертикаль/горизонталь) ненадёжен: пользовательский drag для зума может
// начинаться с лёгкого горизонтального дрейфа пальца, и late-активация rotation
// тогда срабатывает ошибочно.
let lastTapEndTime = 0;
let lastTapEndX = 0;
let lastTapEndY = 0;
let suppressedAfterDoubleTap = false;
// Сохранённая ссылка на оригинальный view.calculateExtent, чтобы корректно
// восстановить его в disable(). null, когда обёртка не установлена.
let originalCalculateExtent: IOlView['calculateExtent'] | null = null;
// true, если на enable обнаружили нативный FixedPointRotate и подавились.
// disable должен пропустить отписку listener'ов и destroy dragPanControl,
// потому что они никогда не вешались.
let suppressedByNativeRotation = false;

/**
 * Проверяет, активен ли в игре нативный жест вращения (FixedPointRotate
 * добавлен в SBG 0.6.1 — refs/game-beta/script.js:711). Сигнал — значение
 * `view.constrainRotation === false`: дефолт OL — true (rotation снапится к
 * 0/90/180/270), SBG 0.6.1 ставит false, чтобы FixedPointRotate мог свободно
 * вращать карту. Если хотфикс игры откатил FixedPointRotate, OL `View`
 * пересоздан с дефолтным `constrainRotation: true` — наш модуль активируется.
 *
 * Метод `getConstrainRotation` — публичный API OL, стабильное имя при
 * минификации и в разных версиях библиотеки.
 */
export function isNativeFixedPointRotateActive(target: IOlMap): boolean {
  const view = target.getView();
  if (typeof view.getConstrainRotation !== 'function') return false;
  return !view.getConstrainRotation();
}

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

function activateRotationFromPoint(x: number, y: number): void {
  latestPoint = [x, y];
  dragPanControl?.disable();
}

function onTouchStart(event: TouchEvent): void {
  if (event.targetTouches.length > 1) {
    resetGesture();
    suppressedAfterDoubleTap = false;
    return;
  }
  if (!isFollowActive()) return;
  if (!(event.target instanceof HTMLCanvasElement)) return;

  const touch = event.targetTouches[0];
  // Date.now() вместо event.timeStamp: jest fake timers не контролируют
  // performance.now() / event.timeStamp (read-only), а Date.now() — да.
  const dt = Date.now() - lastTapEndTime;
  const distance = Math.hypot(touch.clientX - lastTapEndX, touch.clientY - lastTapEndY);

  if (dt <= NGRS_DOUBLE_TAP_GAP_MS && distance <= NGRS_DOUBLE_TAP_DISTANCE_PX) {
    // Второй тап в окне double-tap: вся последующая серия touch — это
    // нативный ngrsZoom (или одиночный двойной тап без drag). Rotation НЕ
    // активируется ни в каком сценарии. Ранее была попытка late-активации
    // при горизонтальном drag, но первый ход пальца при зуме часто имеет
    // лёгкий горизонтальный дрейф — late-rotation срабатывала ошибочно.
    // Прошлая реализация (ngrsZoom + singleFingerRotation) подавляла серию
    // целиком, и пользователю это было ожидаемо.
    suppressedAfterDoubleTap = true;
    return;
  }

  suppressedAfterDoubleTap = false;
  activateRotationFromPoint(touch.clientX, touch.clientY);
}

function onTouchMove(event: TouchEvent): void {
  if (suppressedAfterDoubleTap) {
    // Серия после double-tap — отдаём управление нативному жесту полностью.
    return;
  }

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
  // Date.now() вместо event.timeStamp — см. комментарий в onTouchStart.
  if (suppressedAfterDoubleTap) {
    // Двойной тап завершён — цепочка double-tap-detection «использована».
    // Сбрасываем lastTapEndTime в 0, чтобы следующий touchstart НЕ попал в
    // double-tap-окно как «третий тап» от того же события.
    suppressedAfterDoubleTap = false;
    lastTapEndTime = 0;
  } else if (latestPoint) {
    // Одиночный тап (с rotation или без) — запоминаем для следующего
    // double-tap detection на новом touchstart.
    lastTapEndTime = Date.now();
    lastTapEndX = latestPoint[0];
    lastTapEndY = latestPoint[1];
  }
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
    en: 'Rotate the map with a circular single-finger gesture in follow mode.',
    ru: 'Вращение карты круговым жестом одного пальца в режиме следования за игроком.',
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
    if (isNativeFixedPointRotateActive(map)) {
      // Тихо подавляемся: console.info вместо warn, чтобы не пугать пользователя
      // в DevTools — это не ошибка, а штатная работа на 0.6.1+ без хотфикса.
      //
      // Детект однократный, по состоянию на момент enable. Если игра в runtime
      // переключит constrainRotation (как уже было однажды: SBG 0.6.1 ставил
      // false, потом хотфикс откатил FixedPointRotate и вернул дефолт true), мы
      // не отреагируем без перезапуска модуля. Симптом «модуль не работает» или
      // «работает параллельно с нативом» лечится перезагрузкой страницы — наш
      // enable вызовется заново и переоценит состояние.
      console.info(
        '[SVP] singleFingerRotation: обнаружен нативный FixedPointRotate, модуль подавлен',
      );
      suppressedByNativeRotation = true;
      return;
    }
    suppressedByNativeRotation = false;
    installCalculateExtentWrapper();
    if (dragPanControl === null) {
      dragPanControl = createDragPanControl(map);
    }
    addListeners();
  },
  disable() {
    if (suppressedByNativeRotation) {
      // На enable мы ничего не вешали — нечего и снимать.
      suppressedByNativeRotation = false;
      return;
    }
    removeListeners();
    dragPanControl?.restore();
    dragPanControl = null;
    resetGesture();
    restoreCalculateExtentWrapper();
    // Сбрасываем state-machine ngrsZoom detection: при повторном enable первый
    // touchstart должен активировать rotation без задержки на «возможный
    // double-tap», чьё первое касание было до disable.
    suppressedAfterDoubleTap = false;
    lastTapEndTime = 0;
    lastTapEndX = 0;
    lastTapEndY = 0;
  },
};
