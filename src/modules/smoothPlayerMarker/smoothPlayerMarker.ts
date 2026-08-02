/**
 * Плавное движение маркера игрока.
 *
 * Игра ставит маркер в новую точку мгновенно из watchPosition
 * (refs/game/script.js:2551-2567), поэтому раз в секунду маркер, круги радиуса
 * и карта в режиме следования прыгают на длину шага.
 *
 * Сглаживается только рендер: геометрия player_feature остаётся ровно на
 * последнем реальном фиксе, потому что игра отправляет её на сервер в каждом
 * действии и по ней считает досягаемость точек. Интерполируются геометрии
 * стилей (иконка и три круга) и центр карты.
 *
 * Источник фиксов - игровое событие playermove: игра диспатчит его внутри
 * movePlayer уже после записи координат, поэтому цель читается прямо из фичи.
 */

import type { IFeatureModule } from '../../core/moduleRegistry';
import { POINT_POPUP_SELECTOR } from '../../core/pointPopup';
import { getGeodeticDistance } from '../../core/nextPointPicker';
import { findLayerByName, getOlMap } from '../../core/olMap';
import type { IOlFeature, IOlPointGeometry, IOlVectorSource, IOlView } from '../../core/olMap';
import { createMarkerInterpolation } from './markerInterpolation';
import type { IMarkerInterpolation } from './markerInterpolation';
import {
  applyRenderedPosition,
  createInterpolatedPoint,
  resolvePlayerMarkerStyles,
  restoreNativeRendering,
} from './playerMarkerStyles';
import type { IPlayerMarkerStyles } from './playerMarkerStyles';

const MODULE_ID = 'smoothPlayerMarker';

const PLAYER_LAYER_NAME = 'player';
const PLAYER_MOVE_EVENT = 'playermove';
const NAVI_FLOATER_SELECTOR = '.navi-floater';

/** Ниже этого порога линейный ход неотличим от прыжка. */
const MIN_ANIMATION_DURATION_MS = 200;
/** Потолок отставания рендера от игровой позиции при длинных паузах GPS. */
const MAX_ANIMATION_DURATION_MS = 2000;
/** Больше - срыв GPS или выезд из туннеля: слайд читался бы как глитч. */
const TELEPORT_DISTANCE_METERS = 100;
/** Отсекает шум round-trip координат в перерисовочных вызовах movePlayer. */
const SAME_TARGET_EPSILON = 0.01;
/** Опознание "это тот самый setCenter из movePlayer". */
const CENTER_MATCH_EPSILON = 0.001;
/** Кадры с субпиксельным сдвигом не рисуем: движения всё равно не видно. */
const MIN_RENDER_STEP_PIXELS = 0.5;

let view: IOlView | null = null;
let playerSource: IOlVectorSource | null = null;
let eventTarget: Element | null = null;

let interpolation: IMarkerInterpolation | null = null;
let styles: IPlayerMarkerStyles | null = null;
let interpolatedPoint: IOlPointGeometry | null = null;

let frameHandle: number | null = null;
let originalSetCenter: IOlView['setCenter'] | null = null;

/** Открыто на время синхронного хвоста movePlayer после dispatch playermove. */
let insideFixWindow = false;
/** Координата последнего реального фикса - по ней узнаём игровой setCenter. */
let fixCoordinate: number[] | null = null;
/** Игра отцентровала карту на этом фиксе, значит следование включено. */
let followActive = false;
/** Координата, записанная в стили последним применённым кадром. */
let appliedCoordinate: number[] | null = null;

let failureReported = false;
// Модуль включён по умолчанию, поэтому enable ждёт захвата карты. Токен
// отменяет установку перехватов, если модуль выключили за время ожидания.
let enableToken = 0;

function now(): number {
  return performance.now();
}

function reportFailure(error: unknown): void {
  // Фиксы идут раз в секунду: повтор вытеснил бы полезные строки из журнала
  // ошибок. Флаг сбрасывается на следующем enable.
  if (failureReported) return;
  failureReported = true;
  console.error(`[SVP ${MODULE_ID}] плавное движение маркера отключено:`, error);
}

function getPlayerFeature(): IOlFeature | null {
  return playerSource?.getFeatures()[0] ?? null;
}

function ensureStyles(feature: IOlFeature): boolean {
  if (styles && interpolatedPoint) return true;
  const resolved = resolvePlayerMarkerStyles(feature);
  if (!resolved) {
    reportFailure(new Error('структура стилей маркера игрока не распознана'));
    return false;
  }
  const point = createInterpolatedPoint(feature.getGeometry().getCoordinates());
  if (!point) {
    reportFailure(new Error('ol.geom.Point недоступен'));
    return false;
  }
  styles = resolved;
  interpolatedPoint = point;
  return true;
}

function stopFrameLoop(): void {
  if (frameHandle === null) return;
  cancelAnimationFrame(frameHandle);
  frameHandle = null;
}

function startFrameLoop(): void {
  if (frameHandle !== null) return;
  frameHandle = requestAnimationFrame(onFrame);
}

function rollbackToNative(): void {
  stopFrameLoop();
  try {
    const feature = getPlayerFeature();
    if (feature && styles) restoreNativeRendering(feature, styles);
  } catch {
    // Уже в аварийном пути: глубже разбираться не с чем.
  }
  interpolation?.reset();
  appliedCoordinate = null;
  followActive = false;
}

function movedPixels(from: number[], to: number[]): number {
  const resolution = view?.getResolution?.();
  if (!resolution) return Infinity;
  return Math.hypot(to[0] - from[0], to[1] - from[1]) / resolution;
}

function applyFrame(coordinate: number[], final: boolean): void {
  const feature = getPlayerFeature();
  if (!feature || !styles || !interpolatedPoint) return;

  const skipped =
    !final &&
    appliedCoordinate !== null &&
    movedPixels(appliedCoordinate, coordinate) < MIN_RENDER_STEP_PIXELS;
  if (!skipped) {
    applyRenderedPosition(feature, styles, interpolatedPoint, coordinate);
    appliedCoordinate = coordinate;
  }

  if (!followActive || !view || !originalSetCenter) return;
  // Жест пользователя главнее следования: отпускаем центр до нового фикса,
  // как это делает и сама игра.
  if (view.getInteracting?.()) {
    followActive = false;
    return;
  }
  // Мимо собственной обёртки, иначе получилась бы рекурсия.
  originalSetCenter.call(view, coordinate);
}

function onFrame(): void {
  frameHandle = null;
  if (!interpolation) return;
  try {
    const timestamp = now();
    const coordinate = interpolation.sample(timestamp);
    if (!coordinate) return;
    const animating = interpolation.isAnimating(timestamp);
    applyFrame(coordinate, !animating);
    if (animating) startFrameLoop();
  } catch (error) {
    reportFailure(error);
    rollbackToNative();
  }
}

function openFixWindow(): void {
  insideFixWindow = true;
  // Микротаск выполнится после всего синхронного хвоста movePlayer, поэтому
  // посторонние setCenter (закрытие слайдера рисования и т. п.) в окно не
  // попадают - они идут отдельной задачей.
  queueMicrotask(() => {
    insideFixWindow = false;
  });
}

function handlePlayerMove(): void {
  openFixWindow();
  followActive = false;

  try {
    if (!interpolation) return;
    const feature = getPlayerFeature();
    // Источник пуст, если игра очистила слой после ошибки геолокации.
    if (!feature) return;

    const target = feature.getGeometry().getCoordinates();
    fixCoordinate = target;
    if (!ensureStyles(feature)) return;

    const result = interpolation.pushFix(target, now());
    if (result.kind === 'redraw') return;
    if (result.durationMs === 0) {
      stopFrameLoop();
      applyFrame(target, true);
      return;
    }
    startFrameLoop();
  } catch (error) {
    reportFailure(error);
    rollbackToNative();
  }
}

function isSameCoordinate(a: number[], b: number[]): boolean {
  return (
    Math.abs(a[0] - b[0]) <= CENTER_MATCH_EPSILON && Math.abs(a[1] - b[1]) <= CENTER_MATCH_EPSILON
  );
}

/** true - центрирование обработано нами, оригинал вызывать не нужно. */
function redirectFollowCenter(center: number[] | undefined): boolean {
  if (!insideFixWindow || !center || !fixCoordinate || !interpolation || !view) return false;
  if (!isSameCoordinate(center, fixCoordinate)) return false;

  // Игра центрует карту на фиксе, значит следование включено - какими бы ни
  // были игровые условия follow. Наблюдаем результат, а не повторяем формулу.
  followActive = true;

  const timestamp = now();
  if (!interpolation.isAnimating(timestamp)) return false;
  const rendered = interpolation.sample(timestamp);
  if (!rendered) return false;

  // Пользователь угнал карту далеко: возвращаем игре мгновенный доворот,
  // иначе центр полз бы к игроку через полкарты.
  const currentCenter = view.getCenter();
  if (currentCenter && getGeodeticDistance(currentCenter, center) > TELEPORT_DISTANCE_METERS) {
    return false;
  }

  originalSetCenter?.call(view, rendered);
  return true;
}

function installCenterWrapper(targetView: IOlView): void {
  if (originalSetCenter) return;
  // Сохраняем ссылку без bind, чтобы disable восстановил ровно её.
  // eslint-disable-next-line @typescript-eslint/unbound-method -- контекст явно передаётся через .call(targetView, ...)
  const original = targetView.setCenter;
  originalSetCenter = original;
  targetView.setCenter = (center: number[] | undefined): void => {
    let handled = false;
    try {
      handled = redirectFollowCenter(center);
    } catch (error) {
      reportFailure(error);
    }
    if (!handled) original.call(targetView, center);
  };
}

function restoreCenterWrapper(): void {
  if (view && originalSetCenter) view.setCenter = originalSetCenter;
  originalSetCenter = null;
}

export const smoothPlayerMarker: IFeatureModule = {
  id: MODULE_ID,
  name: { en: 'Smooth player marker', ru: 'Плавное движение маркера' },
  description: {
    en: 'The player marker and the map in follow mode move smoothly between GPS updates',
    ru: 'Маркер игрока и карта в режиме следования движутся плавно между обновлениями GPS',
  },
  defaultEnabled: true,
  category: 'map',

  init() {},

  enable() {
    const myToken = ++enableToken;
    failureReported = false;
    interpolation = createMarkerInterpolation({
      distanceMeters: getGeodeticDistance,
      minDurationMs: MIN_ANIMATION_DURATION_MS,
      maxDurationMs: MAX_ANIMATION_DURATION_MS,
      teleportDistanceMeters: TELEPORT_DISTANCE_METERS,
      sameTargetEpsilon: SAME_TARGET_EPSILON,
    });

    return getOlMap().then((olMap) => {
      if (myToken !== enableToken) return;

      const source = findLayerByName(olMap, PLAYER_LAYER_NAME)?.getSource() ?? null;
      if (!source) {
        console.warn(`[SVP ${MODULE_ID}] слой игрока не найден, сглаживание не включено`);
        return;
      }

      const target =
        document.querySelector(POINT_POPUP_SELECTOR) ??
        document.querySelector(NAVI_FLOATER_SELECTOR);
      if (!target) {
        console.warn(`[SVP ${MODULE_ID}] приёмник события playermove не найден`);
        return;
      }

      view = olMap.getView();
      playerSource = source;
      eventTarget = target;
      eventTarget.addEventListener(PLAYER_MOVE_EVENT, handlePlayerMove);
      installCenterWrapper(view);
    });
  },

  disable() {
    enableToken++;
    stopFrameLoop();
    eventTarget?.removeEventListener(PLAYER_MOVE_EVENT, handlePlayerMove);

    try {
      const feature = getPlayerFeature();
      if (feature && styles) restoreNativeRendering(feature, styles);
    } catch (error) {
      reportFailure(error);
    }

    restoreCenterWrapper();
    interpolation?.reset();
    interpolation = null;
    view = null;
    playerSource = null;
    eventTarget = null;
    styles = null;
    interpolatedPoint = null;
    fixCoordinate = null;
    appliedCoordinate = null;
    followActive = false;
    insideFixWindow = false;
  },
};
