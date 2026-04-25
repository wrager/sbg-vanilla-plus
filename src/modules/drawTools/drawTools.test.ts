import type {
  IOlFeature,
  IOlInteraction,
  IOlLayer,
  IOlMap,
  IOlView,
  IOlVectorSource,
} from '../../core/olMap';

jest.mock('../../core/olMap', () => {
  const actual = jest.requireActual<typeof import('../../core/olMap')>('../../core/olMap');
  return {
    ...actual,
    getOlMap: jest.fn(),
  };
});

import { getOlMap } from '../../core/olMap';
import { drawTools } from './drawTools';

const mockGetOlMap = getOlMap as jest.MockedFunction<typeof getOlMap>;

class FakeLineString {
  private coordinates: number[][];

  constructor(coordinates: number[][]) {
    this.coordinates = coordinates;
  }

  getType(): 'LineString' {
    return 'LineString';
  }

  getCoordinates(): number[][] {
    return this.coordinates;
  }

  setCoordinates(coordinates: number[][]): void {
    this.coordinates = coordinates;
  }
}

class FakePolygon {
  private coordinates: number[][][];

  constructor(coordinates: number[][][]) {
    this.coordinates = coordinates;
  }

  getType(): 'Polygon' {
    return 'Polygon';
  }

  getCoordinates(): number[][][] {
    return this.coordinates;
  }

  setCoordinates(coordinates: number[][][]): void {
    this.coordinates = coordinates;
  }
}

class FakeFeature implements IOlFeature {
  private geometry: { getCoordinates(): number[] };
  private props = new Map<string, unknown>();

  constructor(options?: Record<string, unknown>) {
    const geometry = options?.geometry;
    if (
      typeof geometry === 'object' &&
      geometry !== null &&
      'getCoordinates' in geometry &&
      typeof geometry.getCoordinates === 'function'
    ) {
      this.geometry = geometry as { getCoordinates(): number[] };
      return;
    }

    this.geometry = { getCoordinates: () => [0, 0] };
  }

  getGeometry(): { getCoordinates(): number[] } {
    return this.geometry;
  }

  getId(): string | number | undefined {
    return undefined;
  }

  setId(): void {}

  setStyle(): void {}

  get(key: string): unknown {
    return this.props.get(key);
  }

  set(key: string, value: unknown): void {
    this.props.set(key, value);
  }
}

function makeVectorSource(): IOlVectorSource & { removeFeature: (feature: IOlFeature) => void } {
  const features: IOlFeature[] = [];
  return {
    getFeatures: () => features,
    addFeature: (feature) => {
      features.push(feature);
    },
    removeFeature: (feature) => {
      const index = features.indexOf(feature);
      if (index >= 0) features.splice(index, 1);
    },
    clear: () => {
      features.length = 0;
    },
    on: jest.fn(),
    un: jest.fn(),
  };
}

function makeView(): IOlView {
  return {
    padding: [0, 0, 0, 0],
    getCenter: () => undefined,
    setCenter: () => {},
    calculateExtent: () => [0, 0, 0, 0],
    changed: () => {},
    getRotation: () => 0,
    setRotation: () => {},
  };
}

function makeMap(layers: IOlLayer[]): IOlMap {
  return {
    getView: () => makeView(),
    getSize: () => [800, 600],
    getLayers: () => ({ getArray: () => layers }),
    getInteractions: () => ({ getArray: () => [] }),
    addLayer: jest.fn(),
    removeLayer: jest.fn(),
    addInteraction: jest.fn(),
    removeInteraction: jest.fn(),
    updateSize: jest.fn(),
    on: jest.fn(),
    un: jest.fn(),
    forEachFeatureAtPixel: jest.fn(),
    getPixelFromCoordinate: (coordinate: number[]) => coordinate,
  };
}

function makePointsLayer(portalCoordinates: number[][] = [[100, 100]]): IOlLayer {
  const source = makeVectorSource();
  for (const coord of portalCoordinates) {
    source.addFeature(new FakeFeature({ geometry: { getCoordinates: () => coord } }));
  }
  return {
    get: (key: string) => (key === 'name' ? 'points' : undefined),
    getSource: () => source,
  };
}

describe('drawTools module', () => {
  let lastModifyOptions: Record<string, unknown> | null = null;
  let lastDrawInteraction: {
    on: jest.Mock;
    un: jest.Mock;
    abortDrawing: jest.Mock;
  } | null = null;
  let lastModifyInteraction: { on: jest.Mock; un: jest.Mock } | null = null;
  let lastDrawOptions: Record<string, unknown> | null = null;
  let capturedDrawSource: ReturnType<typeof makeVectorSource> | null = null;
  let currentMap: IOlMap | null = null;

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="map"></div>
      <div class="info popup hidden" data-guid=""></div>
      <div class="region-picker ol-unselectable ol-control">
        <button type="button">Δ</button>
      </div>
    `;

    const vectorSourceCtor = jest.fn().mockImplementation(() => {
      capturedDrawSource = makeVectorSource();
      return capturedDrawSource;
    });
    const vectorLayerCtor = jest.fn().mockImplementation((options: Record<string, unknown>) => {
      return {
        get: (key: string) => (key === 'name' ? options.name : undefined),
        getSource: () => options.source as IOlVectorSource,
      } as IOlLayer;
    });

    const drawCtor = jest.fn().mockImplementation((options: Record<string, unknown>) => {
      lastDrawOptions = options;
      const interaction = {
        on: jest.fn(),
        un: jest.fn(),
        abortDrawing: jest.fn(),
        setActive: jest.fn(),
        getActive: jest.fn(() => true),
      };
      lastDrawInteraction = interaction;
      return interaction;
    });

    const modifyCtor = jest.fn().mockImplementation((options: Record<string, unknown>) => {
      lastModifyOptions = options;
      const interaction = {
        on: jest.fn(),
        un: jest.fn(),
        setActive: jest.fn(),
        getActive: jest.fn(() => true),
      };
      lastModifyInteraction = interaction;
      return interaction;
    });

    class FakeStyle {
      readonly options: Record<string, unknown>;
      constructor(options: Record<string, unknown>) {
        this.options = options;
      }
    }

    class FakeStroke {
      readonly options: Record<string, unknown>;
      constructor(options: Record<string, unknown>) {
        this.options = options;
      }
    }

    class FakeFill {
      readonly options: Record<string, unknown>;
      constructor(options: Record<string, unknown>) {
        this.options = options;
      }
    }

    window.ol = {
      Map: { prototype: { getView: jest.fn() } },
      source: {
        Vector: vectorSourceCtor as unknown as new () => IOlVectorSource,
      },
      layer: {
        Vector: vectorLayerCtor as unknown as new (opts: Record<string, unknown>) => IOlLayer,
      },
      interaction: {
        Draw: drawCtor as unknown as new (opts: Record<string, unknown>) => IOlInteraction,
        Modify: modifyCtor as unknown as new (opts: Record<string, unknown>) => IOlInteraction,
      },
      Feature: FakeFeature as unknown as new (opts?: Record<string, unknown>) => IOlFeature,
      geom: {
        LineString: FakeLineString as unknown as new (coords: number[][]) => {
          getCoordinates(): number[][];
        },
        Polygon: FakePolygon as unknown as new (coords: number[][][]) => {
          getCoordinates(): number[][][];
        },
      },
      style: {
        Style: FakeStyle as unknown as new (opts: Record<string, unknown>) => unknown,
        Stroke: FakeStroke as unknown as new (opts: Record<string, unknown>) => unknown,
        Fill: FakeFill as unknown as new (opts: Record<string, unknown>) => unknown,
      },
      proj: {
        fromLonLat: (coordinate: number[]) => coordinate,
        toLonLat: (coordinate: number[]) => coordinate,
      },
    };

    currentMap = makeMap([makePointsLayer()]);
    mockGetOlMap.mockResolvedValue(currentMap);
    lastModifyOptions = null;
    lastDrawInteraction = null;
    lastModifyInteraction = null;
    lastDrawOptions = null;
    capturedDrawSource = null;
  });

  afterEach(() => {
    void drawTools.disable();
    localStorage.removeItem('svp_drawTools');
    delete window.ol;
    jest.clearAllMocks();
  });

  test('has map metadata and enabled by default', () => {
    expect(drawTools.id).toBe('drawTools');
    expect(drawTools.category).toBe('map');
    expect(drawTools.defaultEnabled).toBe(true);
  });

  test('enable mounts OL-control after region-picker and opens toolbar on click', async () => {
    await drawTools.enable();

    const button = document.getElementById('svp-draw-tools-menu-button');
    const control = document.querySelector('.svp-draw-tools-control');
    const picker = document.querySelector('.region-picker');
    const toolbar = document.querySelector('.svp-draw-tools-toolbar');

    expect(button).not.toBeNull();
    expect(control).not.toBeNull();
    expect(toolbar).not.toBeNull();
    // Control должен стоять сразу после picker'а (стабильный порядок: наша
    // кнопка первая среди svp-controls после region-picker).
    expect(picker?.nextElementSibling).toBe(control);

    button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(toolbar?.classList.contains('svp-draw-tools-toolbar-open')).toBe(true);
  });

  test('every toolbar button renders with an SVG icon', async () => {
    await drawTools.enable();

    const buttons = document.querySelectorAll<HTMLButtonElement>('.svp-draw-tools-tool-button');
    expect(buttons).toHaveLength(9);
    for (const button of buttons) {
      expect(button.querySelector('svg')).not.toBeNull();
      expect(button.textContent).toBe('');
    }
  });

  describe('toolbar outside-click close', () => {
    async function openToolbar(): Promise<void> {
      await drawTools.enable();
      const dtButton = document.getElementById('svp-draw-tools-menu-button');
      dtButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    }

    function isOpen(): boolean {
      return (
        document
          .querySelector('.svp-draw-tools-toolbar')
          ?.classList.contains('svp-draw-tools-toolbar-open') === true
      );
    }

    test('click on toolbar itself keeps it open', async () => {
      await openToolbar();
      expect(isOpen()).toBe(true);

      const lineButton = document.querySelectorAll<HTMLButtonElement>(
        '.svp-draw-tools-tool-button',
      )[0];
      lineButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      expect(isOpen()).toBe(true);
    });

    test('click on map keeps toolbar open (drawing/panning continues)', async () => {
      await openToolbar();
      expect(isOpen()).toBe(true);

      const map = document.getElementById('map');
      map?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      expect(isOpen()).toBe(true);
    });

    test('click outside toolbar and map closes toolbar', async () => {
      await openToolbar();
      expect(isOpen()).toBe(true);

      const stranger = document.createElement('div');
      document.body.appendChild(stranger);
      stranger.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      expect(isOpen()).toBe(false);
    });

    test('click on DT button toggles toolbar (open → close)', async () => {
      await openToolbar();
      expect(isOpen()).toBe(true);

      const dtButton = document.getElementById('svp-draw-tools-menu-button');
      dtButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      expect(isOpen()).toBe(false);
    });

    test('opening point popup closes toolbar (game removes hidden from .info.popup)', async () => {
      await openToolbar();
      expect(isOpen()).toBe(true);

      // Имитируем поведение игры: клик по точке на карте, затем игра убирает
      // hidden у .info.popup, чтобы показать попап. MutationObserver должен
      // поймать переход и закрыть тулбар.
      const map = document.getElementById('map');
      map?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(isOpen()).toBe(true); // map-click сам по себе не закрывает

      const popup = document.querySelector('.info.popup');
      popup?.classList.remove('hidden');

      // MutationObserver работает асинхронно — дать microtask'у прокрутиться
      await Promise.resolve();
      expect(isOpen()).toBe(false);
    });

    test('closing popup back does not reopen toolbar', async () => {
      await openToolbar();
      const popup = document.querySelector('.info.popup');
      popup?.classList.remove('hidden');
      await Promise.resolve();
      expect(isOpen()).toBe(false);

      // Закрытие попапа (hidden обратно) — тулбар не должен сам открыться
      popup?.classList.add('hidden');
      await Promise.resolve();
      expect(isOpen()).toBe(false);
    });

    test('disable removes outside-click listener', async () => {
      await openToolbar();
      void drawTools.disable();

      // Тулбара уже нет — но и наш document-listener не должен мешать другим.
      // Проверка: после disable() click по document.body не падает с ошибкой
      // (referenced toolbar/controlElement = null после cleanup).
      expect(() =>
        document.body.dispatchEvent(new MouseEvent('click', { bubbles: true })),
      ).not.toThrow();
    });
  });

  test('disable removes OL-control and toolbar', async () => {
    await drawTools.enable();
    void drawTools.disable();

    expect(document.getElementById('svp-draw-tools-menu-button')).toBeNull();
    expect(document.querySelector('.svp-draw-tools-control')).toBeNull();
    expect(document.querySelector('.svp-draw-tools-toolbar')).toBeNull();
    expect(document.getElementById('svp-drawTools')).toBeNull();
  });

  test('disable while waitForElement is in flight cleans up mounted UI', async () => {
    // region-picker отсутствует на момент enable() — mountOlControl застрянет в waitForElement
    document.body.innerHTML = '';

    const enablePromise = drawTools.enable();
    // Дать microtask'у прокрутиться, чтобы mountToolbar успел
    await Promise.resolve();

    expect(document.querySelector('.svp-draw-tools-toolbar')).not.toBeNull();
    expect(document.querySelector('.svp-draw-tools-control')).toBeNull();

    // disable во время ожидания region-picker
    void drawTools.disable();
    expect(document.querySelector('.svp-draw-tools-toolbar')).toBeNull();

    // Теперь возвращаем region-picker — MutationObserver разрешит waitForElement
    const picker = document.createElement('div');
    picker.className = 'region-picker ol-unselectable ol-control';
    const pickerBtn = document.createElement('button');
    picker.appendChild(pickerBtn);
    document.body.appendChild(picker);

    await enablePromise;

    // После резолюции: ни кнопки, ни toolbar в DOM не должно остаться
    expect(document.querySelector('.svp-draw-tools-control')).toBeNull();
    expect(document.querySelector('.svp-draw-tools-toolbar')).toBeNull();
    expect(document.getElementById('svp-drawTools')).toBeNull();
  });

  test('rapid enable→disable→enable: stale enable does not duplicate or break newer mounts', async () => {
    // region-picker отсутствует — оба enable застрянут в waitForElement
    document.body.innerHTML = '';

    const enable1 = drawTools.enable();
    await Promise.resolve();

    void drawTools.disable();
    expect(document.querySelector('.svp-draw-tools-toolbar')).toBeNull();

    const enable2 = drawTools.enable();
    await Promise.resolve();

    // После второго enable: ровно один toolbar, контрола ещё нет
    expect(document.querySelectorAll('.svp-draw-tools-toolbar')).toHaveLength(1);
    expect(document.querySelectorAll('.svp-draw-tools-control')).toHaveLength(0);

    // Возвращаем region-picker — оба waitForElement резолвятся
    const picker = document.createElement('div');
    picker.className = 'region-picker ol-unselectable ol-control';
    const pickerBtn = document.createElement('button');
    picker.appendChild(pickerBtn);
    document.body.appendChild(picker);

    await enable1;
    await enable2;

    // Только UI второго enable должен остаться: один control, один toolbar
    expect(document.querySelectorAll('.svp-draw-tools-control')).toHaveLength(1);
    expect(document.querySelectorAll('.svp-draw-tools-toolbar')).toHaveLength(1);
  });

  describe('paste import error toasts', () => {
    function clickPaste(): void {
      const pasteButton = document.querySelectorAll<HTMLButtonElement>(
        '.svp-draw-tools-tool-button',
      )[6]; // L, P, Edit, Delete, Snap, Copy, Paste(6), Reset, Close
      pasteButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    }

    function setupPrompt(returnValue: string | null): jest.SpyInstance {
      return jest.spyOn(window, 'prompt').mockReturnValue(returnValue);
    }

    test('invalid color: toast shows path and offending value', async () => {
      await drawTools.enable();
      const promptSpy = setupPrompt(
        JSON.stringify([
          {
            type: 'polyline',
            latLngs: [
              { lat: 55.75, lng: 37.61 },
              { lat: 55.76, lng: 37.62 },
            ],
            color: '#zzz',
          },
        ]),
      );

      clickPaste();

      const toast = document.querySelector('.svp-toast');
      expect(toast).not.toBeNull();
      expect(toast?.textContent).toContain('items[0]');
      expect(toast?.textContent).toContain('"#zzz"');

      promptSpy.mockRestore();
    });

    test('polygon too few points: toast shows path and the count', async () => {
      await drawTools.enable();
      const promptSpy = setupPrompt(
        JSON.stringify([
          {
            type: 'polygon',
            latLngs: [
              { lat: 55.75, lng: 37.61 },
              { lat: 55.76, lng: 37.62 },
            ],
          },
        ]),
      );

      clickPaste();

      const toast = document.querySelector('.svp-toast');
      expect(toast?.textContent).toContain('items[0]');
      expect(toast?.textContent).toContain(' 2');

      promptSpy.mockRestore();
    });

    test('unsupported type: toast shows path and quoted type value', async () => {
      await drawTools.enable();
      const promptSpy = setupPrompt(
        JSON.stringify([{ type: 'marker', latLng: { lat: 55.75, lng: 37.61 } }]),
      );

      clickPaste();

      const toast = document.querySelector('.svp-toast');
      expect(toast?.textContent).toContain('items[0]');
      expect(toast?.textContent).toContain('"marker"');

      promptSpy.mockRestore();
    });

    test('invalid coordinates: toast shows path and the bad coordinate object', async () => {
      await drawTools.enable();
      const promptSpy = setupPrompt(
        JSON.stringify([
          {
            type: 'polyline',
            latLngs: [
              { lat: 55.75, lng: 37.61 },
              { lat: 'oops', lng: 37.62 },
            ],
          },
        ]),
      );

      clickPaste();

      const toast = document.querySelector('.svp-toast');
      expect(toast?.textContent).toContain('items[0]');
      expect(toast?.textContent).toContain('"oops"');

      promptSpy.mockRestore();
    });

    test('invalid JSON: toast does not crash and shows generic message', async () => {
      await drawTools.enable();
      const promptSpy = setupPrompt('{not json');

      clickPaste();

      const toast = document.querySelector('.svp-toast');
      expect(toast).not.toBeNull();
      expect((toast?.textContent ?? '').toLowerCase()).toContain('json');

      promptSpy.mockRestore();
    });

    test('russian locale: toast contains russian text', async () => {
      localStorage.setItem('settings', JSON.stringify({ lang: 'ru' }));
      await drawTools.enable();
      const promptSpy = setupPrompt(
        JSON.stringify([
          {
            type: 'polygon',
            latLngs: [
              { lat: 55.75, lng: 37.61 },
              { lat: 55.76, lng: 37.62 },
            ],
          },
        ]),
      );

      clickPaste();

      const toast = document.querySelector('.svp-toast');
      expect(toast?.textContent).toContain('Импорт не удался');
      expect(toast?.textContent).toContain('треугольник');
      expect(toast?.textContent).toContain('items[0]');

      promptSpy.mockRestore();
      localStorage.removeItem('settings');
    });
  });

  test('edit mode disables inserting new vertices on segments', async () => {
    await drawTools.enable();

    const toolbarButtons = document.querySelectorAll<HTMLButtonElement>(
      '.svp-draw-tools-tool-button',
    );
    // Порядок: L, P, Edit, Delete, Snap, Copy, Paste, Reset, Close
    const editButton = toolbarButtons[2];
    editButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(lastModifyOptions).not.toBeNull();
    if (!lastModifyOptions) {
      throw new Error('Modify options were not captured');
    }
    const insertVertexCondition = lastModifyOptions.insertVertexCondition;
    expect(typeof insertVertexCondition).toBe('function');
    expect((insertVertexCondition as () => boolean)()).toBe(false);
  });

  test('Escape cancels unfinished drawing', async () => {
    await drawTools.enable();

    const toolbarButtons = document.querySelectorAll<HTMLButtonElement>(
      '.svp-draw-tools-tool-button',
    );
    const lineButton = toolbarButtons[0];
    lineButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(lastDrawInteraction).not.toBeNull();
    if (!lastDrawInteraction) throw new Error('Draw interaction was not captured');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(lastDrawInteraction.abortDrawing).toHaveBeenCalledTimes(1);
  });

  test('right click does not cancel unfinished drawing', async () => {
    await drawTools.enable();

    const toolbarButtons = document.querySelectorAll<HTMLButtonElement>(
      '.svp-draw-tools-tool-button',
    );
    const lineButton = toolbarButtons[0];
    lineButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(lastDrawInteraction).not.toBeNull();
    if (!lastDrawInteraction) throw new Error('Draw interaction was not captured');

    document.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));

    expect(lastDrawInteraction.abortDrawing).not.toHaveBeenCalled();
  });

  test('line mode creates Draw interaction with maxPoints=2', async () => {
    await drawTools.enable();

    const toolbarButtons = document.querySelectorAll<HTMLButtonElement>(
      '.svp-draw-tools-tool-button',
    );
    const lineButton = toolbarButtons[0];
    lineButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(lastDrawOptions).not.toBeNull();
    if (!lastDrawOptions) throw new Error('Draw options were not captured');

    expect(lastDrawOptions.type).toBe('LineString');
    expect(lastDrawOptions.maxPoints).toBe(2);
  });

  test('polygon mode creates Draw interaction with maxPoints=3', async () => {
    await drawTools.enable();

    const toolbarButtons = document.querySelectorAll<HTMLButtonElement>(
      '.svp-draw-tools-tool-button',
    );
    const polygonButton = toolbarButtons[1];
    polygonButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(lastDrawOptions).not.toBeNull();
    if (!lastDrawOptions) throw new Error('Draw options were not captured');

    expect(lastDrawOptions.type).toBe('Polygon');
    expect(lastDrawOptions.maxPoints).toBe(3);
  });

  describe('persistence and serialization', () => {
    test('broken JSON in storage: enable does not throw, key is reset to []', async () => {
      localStorage.setItem('svp_drawTools', '{not json');

      await drawTools.enable();

      expect(localStorage.getItem('svp_drawTools')).toBe('[]');
      if (!capturedDrawSource) throw new Error('Draw source was not captured');
      expect(capturedDrawSource.getFeatures()).toHaveLength(0);
    });

    test('validation error in storage (polygon with 2 points): key is reset to []', async () => {
      localStorage.setItem(
        'svp_drawTools',
        JSON.stringify([
          {
            type: 'polygon',
            latLngs: [
              { lat: 0, lng: 0 },
              { lat: 1, lng: 1 },
            ],
          },
        ]),
      );

      await drawTools.enable();

      expect(localStorage.getItem('svp_drawTools')).toBe('[]');
      if (!capturedDrawSource) throw new Error('Draw source was not captured');
      expect(capturedDrawSource.getFeatures()).toHaveLength(0);
    });

    test('polygon import: 3 latLngs become a 4-coordinate closed ring in OL', async () => {
      localStorage.setItem(
        'svp_drawTools',
        JSON.stringify([
          {
            type: 'polygon',
            latLngs: [
              { lat: 0, lng: 0 },
              { lat: 0, lng: 200 },
              { lat: 170, lng: 100 },
            ],
            color: '#abcdef',
          },
        ]),
      );

      await drawTools.enable();

      if (!capturedDrawSource) throw new Error('Draw source was not captured');
      const features = capturedDrawSource.getFeatures();
      expect(features).toHaveLength(1);

      const geom = features[0].getGeometry() as unknown as FakePolygon;
      const ring = geom.getCoordinates()[0];
      expect(ring).toHaveLength(4);
      expect(ring[3]).toEqual(ring[0]);
      expect(features[0].get?.('color')).toBe('#abcdef');
    });

    test('save round-trip: polygon stored without closing vertex (modifyend → 3 latLngs)', async () => {
      localStorage.setItem(
        'svp_drawTools',
        JSON.stringify([
          {
            type: 'polygon',
            latLngs: [
              { lat: 0, lng: 0 },
              { lat: 0, lng: 200 },
              { lat: 170, lng: 100 },
            ],
          },
        ]),
      );

      await drawTools.enable();

      // Активируем edit-режим — создастся Modify interaction
      const editButton = document.querySelectorAll<HTMLButtonElement>(
        '.svp-draw-tools-tool-button',
      )[2];
      editButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      if (!lastModifyInteraction) throw new Error('Modify interaction was not captured');
      const modifyOnCalls = lastModifyInteraction.on.mock.calls as Array<[string, () => void]>;
      const modifyEndCall = modifyOnCalls.find((call) => call[0] === 'modifyend');
      expect(modifyEndCall).toBeDefined();
      modifyEndCall?.[1]();

      const stored = JSON.parse(localStorage.getItem('svp_drawTools') ?? '[]') as Array<{
        type: string;
        latLngs: unknown[];
      }>;
      expect(stored).toHaveLength(1);
      expect(stored[0].type).toBe('polygon');
      expect(stored[0].latLngs).toHaveLength(3);
    });

    test('drawend handler assigns currentColor to created feature and saves', async () => {
      await drawTools.enable();

      const lineButton = document.querySelectorAll<HTMLButtonElement>(
        '.svp-draw-tools-tool-button',
      )[0];
      lineButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      if (!lastDrawInteraction) throw new Error('Draw interaction was not captured');
      const drawOnCalls = lastDrawInteraction.on.mock.calls as Array<
        [string, (event: Record<string, unknown>) => void]
      >;
      const drawEndCall = drawOnCalls.find((call) => call[0] === 'drawend');
      expect(drawEndCall).toBeDefined();
      const handler = drawEndCall?.[1];
      if (!handler) throw new Error('drawend handler was not registered');

      // Симулируем завершение рисования: фича без цвета
      const lineGeom = new FakeLineString([
        [0, 0],
        [10, 0],
      ]);
      const feature = new FakeFeature({ geometry: lineGeom });
      if (!capturedDrawSource) throw new Error('Draw source was not captured');
      capturedDrawSource.addFeature(feature);
      handler({ feature });

      // currentColor по умолчанию — DEFAULT_COLOR (#a24ac3)
      expect(feature.get('color')).toBe('#a24ac3');

      const stored = JSON.parse(localStorage.getItem('svp_drawTools') ?? '[]') as Array<{
        type: string;
        color?: string;
      }>;
      expect(stored).toHaveLength(1);
      expect(stored[0].type).toBe('polyline');
      expect(stored[0].color).toBe('#a24ac3');
    });
  });

  describe('delete mode', () => {
    test('click on draw-layer feature removes it from source and saves', async () => {
      localStorage.setItem(
        'svp_drawTools',
        JSON.stringify([
          {
            type: 'polyline',
            latLngs: [
              { lat: 0, lng: 0 },
              { lat: 0, lng: 10 },
            ],
          },
        ]),
      );

      await drawTools.enable();
      if (!capturedDrawSource) throw new Error('Draw source was not captured');
      expect(capturedDrawSource.getFeatures()).toHaveLength(1);
      const feature = capturedDrawSource.getFeatures()[0];

      // Включаем delete-mode — навешивается map.on('click', handler)
      const deleteButton = document.querySelectorAll<HTMLButtonElement>(
        '.svp-draw-tools-tool-button',
      )[3];
      deleteButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      if (!currentMap) throw new Error('Map was not captured');
      const mapOn = currentMap.on as unknown as jest.Mock;
      const mapOnCalls = mapOn.mock.calls as Array<
        [string, (event: Record<string, unknown>) => void]
      >;
      const clickCall = mapOnCalls.find((call) => call[0] === 'click');
      expect(clickCall).toBeDefined();
      const clickHandler = clickCall?.[1];
      if (!clickHandler) throw new Error('click handler was not registered');

      // forEachFeatureAtPixel должен передать клик-обработчику нашу фичу
      const forEachMock = currentMap.forEachFeatureAtPixel as unknown as jest.Mock;
      forEachMock.mockImplementation((pixel: number[], callback: (f: IOlFeature) => void) => {
        void pixel;
        callback(feature);
      });

      clickHandler({ pixel: [50, 50], originalEvent: {}, type: 'click' });

      expect(capturedDrawSource.getFeatures()).toHaveLength(0);
      const stored = JSON.parse(localStorage.getItem('svp_drawTools') ?? 'null') as unknown[];
      expect(stored).toEqual([]);
    });
  });

  describe('snap behavior', () => {
    function clickSnapButton(): void {
      // Order: L(0), P(1), Edit(2), Delete(3), Snap(4), ...
      const toolbarButtons = document.querySelectorAll<HTMLButtonElement>(
        '.svp-draw-tools-tool-button',
      );
      toolbarButtons[4].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    }

    test('each line vertex snaps to its own nearest portal within 100px', async () => {
      const olMap = makeMap([
        makePointsLayer([
          [10, 0],
          [220, 0],
        ]),
      ]);
      mockGetOlMap.mockResolvedValue(olMap);
      await drawTools.enable();

      const lineGeom = new FakeLineString([
        [0, 0],
        [200, 0],
      ]);
      if (!capturedDrawSource) throw new Error('Draw source was not captured');
      capturedDrawSource.addFeature(new FakeFeature({ geometry: lineGeom }));

      clickSnapButton();

      expect(lineGeom.getCoordinates()).toEqual([
        [10, 0],
        [220, 0],
      ]);
    });

    test('vertex outside 100px radius is not moved', async () => {
      const olMap = makeMap([makePointsLayer([[10, 0]])]);
      mockGetOlMap.mockResolvedValue(olMap);
      await drawTools.enable();

      const lineGeom = new FakeLineString([
        [0, 0],
        [500, 0],
      ]);
      if (!capturedDrawSource) throw new Error('Draw source was not captured');
      capturedDrawSource.addFeature(new FakeFeature({ geometry: lineGeom }));

      clickSnapButton();

      expect(lineGeom.getCoordinates()).toEqual([
        [10, 0],
        [500, 0],
      ]);
    });

    test('vertex with smaller distance claims portal; other vertex uses second-nearest', async () => {
      // Portal at [10,0] and [80,0]
      // Vertex [0,0]: distances -> [10,0]=10, [80,0]=80
      // Vertex [15,0]: distances -> [10,0]=5, [80,0]=65
      // [15,0] has best distance (5) -> claims [10,0]
      // [0,0] skips claimed [10,0] -> takes [80,0] (distance 80)
      const olMap = makeMap([
        makePointsLayer([
          [10, 0],
          [80, 0],
        ]),
      ]);
      mockGetOlMap.mockResolvedValue(olMap);
      await drawTools.enable();

      const lineGeom = new FakeLineString([
        [0, 0],
        [15, 0],
      ]);
      if (!capturedDrawSource) throw new Error('Draw source was not captured');
      capturedDrawSource.addFeature(new FakeFeature({ geometry: lineGeom }));

      clickSnapButton();

      const coords = lineGeom.getCoordinates();
      expect(coords[0]).toEqual([80, 0]); // [0,0] -> second-nearest portal
      expect(coords[1]).toEqual([10, 0]); // [15,0] -> nearest portal
    });

    test('polygon vertices snap to distinct portals without re-using claimed ones', async () => {
      // Closed triangle ring: [[0,0],[200,0],[100,170],[0,0]]
      // Portals at [10,0], [210,0], [110,170]
      const olMap = makeMap([
        makePointsLayer([
          [10, 0],
          [210, 0],
          [110, 170],
        ]),
      ]);
      mockGetOlMap.mockResolvedValue(olMap);
      await drawTools.enable();

      const polygonGeom = new FakePolygon([
        [
          [0, 0],
          [200, 0],
          [100, 170],
          [0, 0],
        ],
      ]);
      if (!capturedDrawSource) throw new Error('Draw source was not captured');
      capturedDrawSource.addFeature(new FakeFeature({ geometry: polygonGeom }));

      clickSnapButton();

      const ring = polygonGeom.getCoordinates()[0];
      // Three unique vertices snapped, ring re-closed
      expect(ring[0]).toEqual([10, 0]);
      expect(ring[1]).toEqual([210, 0]);
      expect(ring[2]).toEqual([110, 170]);
      expect(ring[3]).toEqual(ring[0]); // closed ring
    });

    test('polygon vertex with no unclaimed portal in radius stays in place', async () => {
      // Portals at [10,0] and [210,0]; third vertex at [1000,1000] is out of range
      const olMap = makeMap([
        makePointsLayer([
          [10, 0],
          [210, 0],
        ]),
      ]);
      mockGetOlMap.mockResolvedValue(olMap);
      await drawTools.enable();

      const polygonGeom = new FakePolygon([
        [
          [0, 0],
          [200, 0],
          [1000, 1000],
          [0, 0],
        ],
      ]);
      if (!capturedDrawSource) throw new Error('Draw source was not captured');
      capturedDrawSource.addFeature(new FakeFeature({ geometry: polygonGeom }));

      clickSnapButton();

      const ring = polygonGeom.getCoordinates()[0];
      expect(ring[0]).toEqual([10, 0]);
      expect(ring[1]).toEqual([210, 0]);
      expect(ring[2]).toEqual([1000, 1000]); // out of range, not moved
      expect(ring[3]).toEqual(ring[0]);
    });
  });

  describe('copy', () => {
    function clickCopyButton(): void {
      // Order: L(0), P(1), Edit(2), Delete(3), Snap(4), Copy(5), Paste(6), Reset(7), Close(8)
      const buttons = document.querySelectorAll<HTMLButtonElement>('.svp-draw-tools-tool-button');
      buttons[5].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    }

    afterEach(() => {
      Reflect.deleteProperty(navigator, 'clipboard');
    });

    test('writes IITC JSON to clipboard and shows success toast', async () => {
      localStorage.setItem(
        'svp_drawTools',
        JSON.stringify([
          {
            type: 'polyline',
            latLngs: [
              { lat: 0, lng: 0 },
              { lat: 0, lng: 10 },
            ],
          },
        ]),
      );
      await drawTools.enable();

      const writeText = jest.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText },
        configurable: true,
      });

      clickCopyButton();

      // Дождаться завершения copyDrawPlan (writeText resolves -> showToast)
      await new Promise<void>((resolve) => setTimeout(resolve, 0));

      expect(writeText).toHaveBeenCalledTimes(1);
      const writeCalls = writeText.mock.calls as Array<[string]>;
      const parsed = JSON.parse(writeCalls[0][0]) as Array<{ type: string }>;
      expect(parsed).toHaveLength(1);
      expect(parsed[0].type).toBe('polyline');

      const toast = document.querySelector('.svp-toast');
      expect(toast?.textContent).toContain('Copied');
    });

    async function setupRejectedClipboard(): Promise<void> {
      localStorage.setItem(
        'svp_drawTools',
        JSON.stringify([
          {
            type: 'polyline',
            latLngs: [
              { lat: 0, lng: 0 },
              { lat: 0, lng: 10 },
            ],
          },
        ]),
      );
      await drawTools.enable();

      const writeText = jest.fn().mockRejectedValue(new Error('denied'));
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText },
        configurable: true,
      });
    }

    function getCopyModalTextarea(): HTMLTextAreaElement | null {
      return document.querySelector<HTMLTextAreaElement>('.svp-draw-tools-copy-textarea');
    }

    test('falls back to modal with textarea when clipboard rejects', async () => {
      await setupRejectedClipboard();

      clickCopyButton();
      await new Promise<void>((resolve) => setTimeout(resolve, 0));

      const overlay = document.querySelector('.svp-draw-tools-copy-modal-overlay');
      expect(overlay).not.toBeNull();
      const textarea = getCopyModalTextarea();
      expect(textarea).not.toBeNull();
      const parsed = JSON.parse(textarea?.value ?? 'null') as Array<{ type: string }>;
      expect(parsed[0].type).toBe('polyline');
    });

    test('close button removes copy fallback modal', async () => {
      await setupRejectedClipboard();

      clickCopyButton();
      await new Promise<void>((resolve) => setTimeout(resolve, 0));

      const closeButton = document.querySelector<HTMLButtonElement>(
        '.svp-draw-tools-copy-modal-close',
      );
      expect(closeButton).not.toBeNull();
      closeButton?.click();

      expect(document.querySelector('.svp-draw-tools-copy-modal-overlay')).toBeNull();
    });

    test('overlay click outside modal removes copy fallback modal', async () => {
      await setupRejectedClipboard();

      clickCopyButton();
      await new Promise<void>((resolve) => setTimeout(resolve, 0));

      const overlay = document.querySelector<HTMLDivElement>('.svp-draw-tools-copy-modal-overlay');
      overlay?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      expect(document.querySelector('.svp-draw-tools-copy-modal-overlay')).toBeNull();
    });

    test('Escape closes copy fallback modal', async () => {
      await setupRejectedClipboard();

      clickCopyButton();
      await new Promise<void>((resolve) => setTimeout(resolve, 0));

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

      expect(document.querySelector('.svp-draw-tools-copy-modal-overlay')).toBeNull();
    });

    test('repeat copy click while modal open keeps exactly one overlay', async () => {
      await setupRejectedClipboard();

      clickCopyButton();
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      clickCopyButton();
      await new Promise<void>((resolve) => setTimeout(resolve, 0));

      expect(document.querySelectorAll('.svp-draw-tools-copy-modal-overlay')).toHaveLength(1);
    });

    test('disable while modal open removes overlay', async () => {
      await setupRejectedClipboard();

      clickCopyButton();
      await new Promise<void>((resolve) => setTimeout(resolve, 0));

      void drawTools.disable();

      expect(document.querySelector('.svp-draw-tools-copy-modal-overlay')).toBeNull();
    });
  });
});
