/**
 * Capture the OL Map instance created by the game.
 *
 * The game stores `map` in a local variable (not on `window`).
 * We intercept `ol.Map.prototype.getView` — it is called during
 * map construction, so the capture happens almost immediately.
 *
 * Since the game script loads as a dynamic `type="module"`, `window.ol`
 * may not be available yet at `document-idle`. We handle both cases:
 * - ol already loaded → hook prototype immediately
 * - ol not yet loaded → intercept `window.ol` assignment via defineProperty
 */

export interface IOlView {
  padding: number[];
  getCenter(): number[] | undefined;
  setCenter(center: number[] | undefined): void;
  calculateExtent(size?: number[]): number[];
  changed(): void;
  getRotation(): number;
  setRotation(rotation: number): void;
  adjustRotation?(delta: number, anchor?: number[]): void;
  getZoom?(): number | undefined;
  setZoom?(zoom: number): void;
  getResolution?(): number | undefined;
  setResolution?(resolution: number): void;
  beginInteraction?(): void;
  endInteraction?(duration?: number): void;
  on?(type: string, listener: () => void): void;
  un?(type: string, listener: () => void): void;
}

export interface IOlFeature {
  getGeometry(): { getCoordinates(): number[] };
  getId(): string | number | undefined;
  setId(id: string): void;
  setStyle(style: unknown): void;
  // Возвращает текущий стиль фичи. На момент создания фичи может быть null,
  // далее - то, что передавалось в setStyle (одиночный Style, массив или
  // function). Тип unknown - стиль это структура из ol.style.* без устойчивого
  // публичного TS-интерфейса в этом проекте.
  getStyle?(): unknown;
  get?(key: string): unknown;
  set?(key: string, value: unknown): void;
  getProperties?(): Record<string, unknown>;
  // Методы EventTarget OL (унаследованы от ol.events.Target). Любая фича их
  // имеет; объявлены опциональными на случай моков в тестах, где их нет.
  on?(type: string, listener: () => void): void;
  un?(type: string, listener: () => void): void;
  // Уведомляет OL renderer-cache об инвалидации feature: следующий render
  // пересчитает execution plan и применит свежие style/renderer. Без явного
  // вызова мутации, не идущие через setStyle (например, style.setRenderer
  // in-place), не попадают в plan до внешнего trigger'а (move, zoom).
  changed?(): void;
}

export interface IOlVectorSource {
  getFeatures(): IOlFeature[];
  addFeature(feature: IOlFeature): void;
  removeFeature?(feature: IOlFeature): void;
  // Поиск feature по идентификатору; в OL API стандартный метод VectorSource.
  // Используется при адресном обновлении state одной точки (после discover,
  // showInfo и т. п.) - O(1) против O(n) перебора getFeatures().
  getFeatureById?(id: string | number): IOlFeature | null;
  clear(): void;
  // Сигнатура обработчика - `(...args: unknown[]) => void`, чтобы принимать
  // как listener'ы без параметров (`change`-event), так и с event-объектом
  // (`addfeature` передаёт `{type, feature}`). Контравариантность по
  // параметрам: обработчик с `unknown[]` совместим с любой более узкой
  // подписью без cast'а на стороне вызывающего.
  on(type: string, listener: (...args: unknown[]) => void): void;
  un(type: string, listener: (...args: unknown[]) => void): void;
  // Принудительная перерисовка слоя без изменения состава фич - используется
  // когда мы поменяли свойства уже добавленных фич (через feature.set()) и
  // хотим, чтобы стилевая функция была вызвана повторно с новыми props.
  changed?(): void;
}

export interface IOlTileSource {
  readonly __brand?: 'OlTileSource';
}

export interface IOlLayer {
  get(key: string): unknown;
  getSource(): IOlVectorSource | null;
  setVisible?(visible: boolean): void;
  getVisible?(): boolean;
}

export function hasTileSource(layer: IOlLayer): layer is IOlLayer & {
  setSource(source: unknown): void;
} {
  return 'setSource' in layer && typeof (layer as Record<string, unknown>).setSource === 'function';
}

export interface IOlInteraction {
  setActive(active: boolean): void;
  getActive(): boolean;
}

export interface IOlMapEvent {
  type: string;
  pixel: number[];
  originalEvent: Record<string, unknown>;
}

export interface IForEachFeatureAtPixelOptions {
  hitTolerance?: number;
  layerFilter?: (layer: IOlLayer) => boolean;
}

export interface IOlMap {
  getView(): IOlView;
  getSize(): number[] | undefined;
  getLayers(): { getArray(): IOlLayer[] };
  getInteractions(): { getArray(): IOlInteraction[] };
  addLayer(layer: IOlLayer): void;
  removeLayer(layer: IOlLayer): void;
  addInteraction?(interaction: IOlInteraction): void;
  removeInteraction?(interaction: IOlInteraction): void;
  updateSize(): void;
  getPixelFromCoordinate?(coordinate: number[]): number[];
  getCoordinateFromPixel?(pixel: number[]): number[];
  dispatchEvent?(event: IOlMapEvent): void;
  on?(type: string, listener: (event: IOlMapEvent) => void): void;
  un?(type: string, listener: (event: IOlMapEvent) => void): void;
  forEachFeatureAtPixel?(
    pixel: number[],
    callback: (feature: IOlFeature, layer: IOlLayer) => void,
    options?: IForEachFeatureAtPixelOptions,
  ): void;
}

interface IOlGlobal {
  Map: { prototype: { getView: () => IOlView } };
  layer?: { Vector?: new (opts: Record<string, unknown>) => IOlLayer };
  source?: {
    Vector?: new () => IOlVectorSource;
    XYZ?: new (opts: {
      url?: string;
      crossOrigin?: string;
      attributions?: string;
    }) => IOlTileSource;
  };
  style?: {
    Style?: new (opts: Record<string, unknown>) => unknown;
    Text?: new (opts: Record<string, unknown>) => unknown;
    Fill?: new (opts: Record<string, unknown>) => unknown;
    Stroke?: new (opts: Record<string, unknown>) => unknown;
    Circle?: new (opts: Record<string, unknown>) => unknown;
    Icon?: new (opts: Record<string, unknown>) => unknown;
  };
  Feature?: new (opts?: Record<string, unknown>) => IOlFeature;
  geom?: {
    Point?: new (coords: number[]) => { getCoordinates(): number[] };
    LineString?: new (coords: number[][]) => { getCoordinates(): number[][] };
    Polygon?: new (coords: number[][][]) => { getCoordinates(): number[][][] };
  };
  sphere?: { getLength(geometry: unknown): number };
  proj?: {
    fromLonLat?(coordinate: number[]): number[];
    toLonLat?(coordinate: number[]): number[];
  };
  interaction?: {
    DoubleClickZoom?: new () => IOlInteraction;
    DragPan?: new () => IOlInteraction;
    Draw?: new (opts: Record<string, unknown>) => IOlInteraction;
    Modify?: new (opts: Record<string, unknown>) => IOlInteraction;
    Snap?: new (opts: Record<string, unknown>) => IOlInteraction;
  };
}

function isOlGlobal(val: unknown): val is IOlGlobal {
  return (
    typeof val === 'object' &&
    val !== null &&
    'Map' in val &&
    (typeof val.Map === 'object' || typeof val.Map === 'function') &&
    val.Map !== null &&
    'prototype' in val.Map &&
    typeof val.Map.prototype === 'object' &&
    val.Map.prototype !== null &&
    'getView' in val.Map.prototype &&
    typeof val.Map.prototype.getView === 'function'
  );
}

declare global {
  interface Window {
    ol?: IOlGlobal;
  }
}

export function isDragPan(interaction: IOlInteraction): boolean {
  const DragPan = window.ol?.interaction?.DragPan;
  return DragPan !== undefined && interaction instanceof DragPan;
}

export function findDragPanInteractions(map: IOlMap): IOlInteraction[] {
  return map.getInteractions().getArray().filter(isDragPan);
}

export interface IDragPanControl {
  disable(): void;
  restore(): void;
}

/** Создаёт изолированный контроллер DragPan для модуля. Каждый модуль держит свой экземпляр. */
export function createDragPanControl(map: IOlMap): IDragPanControl {
  let disabled: IOlInteraction[] = [];
  return {
    disable() {
      disabled = findDragPanInteractions(map);
      for (const interaction of disabled) {
        interaction.setActive(false);
      }
    },
    restore() {
      for (const interaction of disabled) {
        interaction.setActive(true);
      }
      disabled = [];
    },
  };
}

export function findLayerByName(map: IOlMap, name: string): IOlLayer | null {
  for (const layer of map.getLayers().getArray()) {
    if (layer.get('name') === name) return layer;
  }
  return null;
}

/**
 * Перехватчик единой обёртки `map.forEachFeatureAtPixel`. Может преобразовать
 * `options` перед вызовом нативного метода и/или скрыть отдельные попадания от
 * callback'а вызывающей стороны.
 */
export interface IForEachFeatureAtPixelInterceptor {
  /** Преобразует `options` перед передачей в нативный метод (hitTolerance, layerFilter). */
  transformOptions?(
    options: IForEachFeatureAtPixelOptions | undefined,
  ): IForEachFeatureAtPixelOptions | undefined;
  /**
   * Возвращает `false`, чтобы скрыть попадание `(feature, layer)` от callback'а
   * вызывающей стороны. `layer` по контракту OpenLayers может быть `null`
   * (unmanaged-слои, sketch-оверлеи интеракций Draw/Modify).
   */
  filterHit?(feature: IOlFeature, layer: IOlLayer | null): boolean;
}

type ForEachFeatureAtPixel = NonNullable<IOlMap['forEachFeatureAtPixel']>;

const forEachFeatureInterceptors: IForEachFeatureAtPixelInterceptor[] = [];
let interceptedMap: IOlMap | null = null;
let nativeForEachFeatureAtPixel: ForEachFeatureAtPixel | null = null;

function installForEachFeatureAtPixelWrapper(map: IOlMap): void {
  if (!map.forEachFeatureAtPixel) return;
  const callNative = map.forEachFeatureAtPixel.bind(map);
  nativeForEachFeatureAtPixel = callNative;
  interceptedMap = map;
  map.forEachFeatureAtPixel = (pixel, callback, options) => {
    let effectiveOptions = options;
    for (const interceptor of forEachFeatureInterceptors) {
      if (interceptor.transformOptions) {
        effectiveOptions = interceptor.transformOptions(effectiveOptions);
      }
    }
    callNative(
      pixel,
      (feature, layer) => {
        for (const interceptor of forEachFeatureInterceptors) {
          if (interceptor.filterHit && !interceptor.filterHit(feature, layer)) return;
        }
        callback(feature, layer);
      },
      effectiveOptions,
    );
  };
}

function uninstallForEachFeatureAtPixelWrapper(): void {
  if (interceptedMap && nativeForEachFeatureAtPixel) {
    interceptedMap.forEachFeatureAtPixel = nativeForEachFeatureAtPixel;
  }
  interceptedMap = null;
  nativeForEachFeatureAtPixel = null;
}

/**
 * Регистрирует перехватчик единой обёртки `map.forEachFeatureAtPixel`.
 *
 * Несколько модулей (`largerPointTapArea`, `drawTools`) меняют поведение
 * `forEachFeatureAtPixel`. Независимые обёртки по схеме save/restore не
 * композируются: `disable()` одного модуля безусловно затирает обёртку
 * другого. Поэтому метод оборачивается ровно один раз - при регистрации
 * первого перехватчика; каждый следующий лишь добавляется в реестр.
 * `unregister` убирает только свой перехватчик; когда реестр пустеет,
 * восстанавливается нативный метод. Тот же приём - `olControlStack`.
 *
 * Если у карты нет `forEachFeatureAtPixel`, перехватчик не регистрируется и
 * `unregister` - no-op.
 */
export function registerForEachFeatureAtPixelInterceptor(
  map: IOlMap,
  interceptor: IForEachFeatureAtPixelInterceptor,
): () => void {
  if (!map.forEachFeatureAtPixel) return () => {};
  if (forEachFeatureInterceptors.length === 0) {
    installForEachFeatureAtPixelWrapper(map);
  }
  forEachFeatureInterceptors.push(interceptor);
  return () => {
    const index = forEachFeatureInterceptors.indexOf(interceptor);
    if (index === -1) return;
    forEachFeatureInterceptors.splice(index, 1);
    if (forEachFeatureInterceptors.length === 0) {
      uninstallForEachFeatureAtPixelWrapper();
    }
  };
}

let captured: IOlMap | null = null;
const resolvers: ((map: IOlMap) => void)[] = [];
let hooked = false;
let proxyInstalled = false;

const DIAG_DELAY = 5_000;

export function getOlMap(): Promise<IOlMap> {
  if (captured) return Promise.resolve(captured);
  return new Promise((resolve) => {
    resolvers.push(resolve);
  });
}

/**
 * Синхронный аксессор к уже захваченной карте. Возвращает null, если карта
 * ещё не захвачена (window.ol не подгружен или ol.Map ещё не сконструирован).
 * Подходит для сценариев, где async API getOlMap избыточен: разовое чтение
 * данных feature по GUID в синхронном callback'е (например, при формировании
 * текста тоста), где задержка вызова на await getOlMap была бы видна
 * пользователю как лаг.
 */
export function getCapturedOlMap(): IOlMap | null {
  return captured;
}

function hookGetView(ol: IOlGlobal): void {
  hooked = true;
  const proto = ol.Map.prototype;
  const orig = proto.getView;

  proxyInstalled = true;
  proto.getView = new Proxy(orig, {
    apply(_target, thisArg: IOlMap) {
      proto.getView = orig;
      proxyInstalled = false;
      captured = thisArg;
      for (const r of resolvers) r(thisArg);
      resolvers.length = 0;
      return orig.call(thisArg);
    },
  });
}

function logDiagnostics(): void {
  if (captured) return;

  const olAvailable = isOlGlobal(window.ol);
  const viewportExists = document.querySelector('.ol-viewport') !== null;

  console.warn(
    '[SVP] OL Map не захвачен за %dс. Диагностика:' +
      ' window.ol=%s, hookGetView=%s, proxy=%s, viewport=%s',
    DIAG_DELAY / 1000,
    olAvailable ? 'есть' : 'нет',
    hooked ? 'вызван' : 'не вызван',
    proxyInstalled ? 'установлен' : 'снят',
    viewportExists ? 'есть' : 'нет',
  );

  // window.ol появился, но hookGetView не вызван — defineProperty не сработал
  if (olAvailable && !hooked) {
    console.warn('[SVP] Повторная попытка перехвата getView');
    hookGetView(window.ol as IOlGlobal);
  }
}

export function initOlMapCapture(): void {
  if (window.ol) {
    hookGetView(window.ol);
  } else {
    // ol not yet loaded — intercept when the game sets window.ol
    let olValue: IOlGlobal | undefined;
    Object.defineProperty(window, 'ol', {
      configurable: true,
      enumerable: true,
      get() {
        return olValue;
      },
      set(val: unknown) {
        // Restore as a normal data property first
        Object.defineProperty(window, 'ol', {
          configurable: true,
          enumerable: true,
          writable: true,
          value: val,
        });
        if (isOlGlobal(val)) {
          olValue = val;
          hookGetView(val);
        }
      },
    });
  }

  setTimeout(logDiagnostics, DIAG_DELAY);
}
