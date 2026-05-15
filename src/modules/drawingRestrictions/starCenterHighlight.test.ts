import { installStarCenterHighlight, uninstallStarCenterHighlight } from './starCenterHighlight';
import { STAR_CENTER_CHANGED_EVENT, clearStarCenter, setStarCenter } from './starCenter';
import type { IOlFeature, IOlLayer, IOlMap, IOlVectorSource } from '../../core/olMap';

// ── тестовые helpers ─────────────────────────────────────────────────────────

interface IFakeSource extends IOlVectorSource, Record<'_features' | '_listeners', unknown> {
  _features: IOlFeature[];
  _listeners: Map<string, ((...args: unknown[]) => void)[]>;
  emitAddFeature: (feature: IOlFeature) => void;
  emitRemoveFeature: (feature: IOlFeature) => void;
}

function makeFeature(id: string, coords: [number, number] = [0, 0]): IOlFeature {
  return {
    getId: () => id,
    setId: () => {},
    setStyle: () => {},
    getGeometry: () => ({ getCoordinates: () => coords }),
  };
}

function makeSource(features: IOlFeature[] = []): IFakeSource {
  const listeners = new Map<string, ((...args: unknown[]) => void)[]>();
  const featureList = [...features];
  return {
    _features: featureList,
    _listeners: listeners,
    getFeatures: () => featureList,
    addFeature: jest.fn((feature: IOlFeature) => {
      featureList.push(feature);
    }),
    clear: jest.fn(() => {
      featureList.length = 0;
    }),
    on(type: string, callback: (...args: unknown[]) => void) {
      const array = listeners.get(type) ?? [];
      array.push(callback);
      listeners.set(type, array);
    },
    un(type: string, callback: (...args: unknown[]) => void) {
      const array = listeners.get(type) ?? [];
      listeners.set(
        type,
        array.filter((listener) => listener !== callback),
      );
    },
    emitAddFeature(feature: IOlFeature) {
      const callbacks = listeners.get('addfeature') ?? [];
      callbacks.forEach((callback) => {
        callback({ feature });
      });
    },
    emitRemoveFeature(feature: IOlFeature) {
      const callbacks = listeners.get('removefeature') ?? [];
      callbacks.forEach((callback) => {
        callback({ feature });
      });
    },
  };
}

function makeLayer(source: IOlVectorSource | null): IOlLayer {
  return {
    get: () => 'points',
    getSource: () => source,
  };
}

function makeMap(): IOlMap & { _addedLayers: IOlLayer[] } {
  const addedLayers: IOlLayer[] = [];
  return {
    _addedLayers: addedLayers,
    addLayer: jest.fn((layer: IOlLayer) => {
      addedLayers.push(layer);
    }),
    removeLayer: jest.fn((layer: IOlLayer) => {
      const index = addedLayers.indexOf(layer);
      if (index >= 0) addedLayers.splice(index, 1);
    }),
    getView: () => ({
      padding: [0, 0, 0, 0],
      getCenter: () => undefined,
      setCenter: () => {},
      calculateExtent: () => [0, 0, 0, 0],
      changed: () => {},
      getRotation: () => 0,
      setRotation: () => {},
      getZoom: () => 16,
      on: () => {},
      un: () => {},
    }),
    getSize: () => [800, 600],
    getLayers: () => ({ getArray: () => [] }),
    getInteractions: () => ({ getArray: () => [] }),
    updateSize: () => {},
  };
}

function mockOl(): void {
  window.ol = {
    Map: { prototype: { getView: jest.fn() } },
    source: {
      Vector: jest.fn().mockImplementation(() => makeSource()) as unknown as new (
        opts?: unknown,
      ) => IOlVectorSource,
    },
    layer: {
      Vector: jest.fn().mockImplementation((opts: { source: IOlVectorSource }) => ({
        get: () => undefined,
        getSource: () => opts.source,
      })) as unknown as new (opts: Record<string, unknown>) => IOlLayer,
    },
    Feature: jest.fn().mockImplementation((opts: Record<string, unknown>) => ({
      getGeometry: () => opts.geometry,
      getId: () => undefined,
      setStyle: jest.fn(),
    })) as unknown as new (opts?: Record<string, unknown>) => IOlFeature,
    geom: {
      Point: jest.fn().mockImplementation((coords: number[]) => ({
        getCoordinates: () => coords,
      })) as unknown as new (coords: number[]) => { getCoordinates(): number[] },
    },
    style: {
      Style: jest
        .fn()
        .mockImplementation((options: Record<string, unknown>) => options) as unknown as new (
        opts: Record<string, unknown>,
      ) => unknown,
      Circle: jest
        .fn()
        .mockImplementation((options: Record<string, unknown>) => options) as unknown as new (
        opts: Record<string, unknown>,
      ) => unknown,
      Stroke: jest
        .fn()
        .mockImplementation((options: Record<string, unknown>) => options) as unknown as new (
        opts: Record<string, unknown>,
      ) => unknown,
      Fill: jest
        .fn()
        .mockImplementation((options: Record<string, unknown>) => options) as unknown as new (
        opts: Record<string, unknown>,
      ) => unknown,
    },
  };
}

// ── мок getOlMap / findLayerByName ───────────────────────────────────────────

const mapHolder: { current: IOlMap | null } = { current: null };
const sourceHolder: { current: IOlVectorSource | null } = { current: null };

jest.mock('../../core/olMap', () => ({
  getOlMap: () => Promise.resolve(mapHolder.current),
  findLayerByName: () => (sourceHolder.current ? makeLayer(sourceHolder.current) : null),
}));

function flushPromises(): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

beforeEach(() => {
  localStorage.clear();
  clearStarCenter();
  mapHolder.current = null;
  sourceHolder.current = null;
  mockOl();
});

afterEach(() => {
  uninstallStarCenterHighlight();
  localStorage.clear();
});

// ── Тесты ────────────────────────────────────────────────────────────────────

describe('buildHighlightStyle (косвенно через install + refreshOverlay)', () => {
  test('отсутствие window.ol.style — null → install продолжается, но overlay не создаётся', async () => {
    mapHolder.current = makeMap();
    const source = makeSource([makeFeature('center', [10, 20])]);
    sourceHolder.current = source;
    setStarCenter('center', '');

    // window.ol.style отсутствует полностью.
    if (window.ol) delete window.ol.style;

    installStarCenterHighlight();
    await flushPromises();

    // overlay layer всё-таки создаётся (Vector не затронут), но при refreshOverlay
    // buildHighlightStyle вернёт null → overlay feature не добавлен.
    const added = (mapHolder.current as ReturnType<typeof makeMap>)._addedLayers;
    expect(added.length).toBe(1);
    const overlaySource = added[0].getSource();
    expect(overlaySource?.getFeatures().length).toBe(0);
  });

  // 7.A.2/.3/.4 — missing Circle / Stroke / Fill → buildHighlightStyle null.
  test.each([['Circle'], ['Stroke'], ['Fill']])(
    'отсутствие window.ol.style.%s — overlay не добавляется',
    async (key) => {
      mapHolder.current = makeMap();
      const source = makeSource([makeFeature('center')]);
      sourceHolder.current = source;
      setStarCenter('center', '');

      if (window.ol?.style) {
        const style = window.ol.style as unknown as Record<string, unknown>;
        style[key] = undefined;
      }

      installStarCenterHighlight();
      await flushPromises();

      const added = (mapHolder.current as ReturnType<typeof makeMap>)._addedLayers;
      expect(added[0].getSource()?.getFeatures().length).toBe(0);
    },
  );

  // 7.A all-TRUE: нормальный случай.
  test('полный window.ol.style — overlay добавлен с корректным стилем', async () => {
    mapHolder.current = makeMap();
    const source = makeSource([makeFeature('center', [42, 11])]);
    sourceHolder.current = source;
    setStarCenter('center', '');

    installStarCenterHighlight();
    await flushPromises();

    const added = (mapHolder.current as ReturnType<typeof makeMap>)._addedLayers;
    const features = added[0].getSource()?.getFeatures();
    expect(features?.length).toBe(1);
  });
});

describe('install — graceful fallback', () => {
  // 7.K: !source.
  test('слой points отсутствует — warn + install прекращается (map не присваивается)', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mapHolder.current = makeMap();
    sourceHolder.current = null; // findLayerByName вернёт null → source undefined.

    installStarCenterHighlight();
    await flushPromises();

    expect(warn).toHaveBeenCalled();
    const added = (mapHolder.current as ReturnType<typeof makeMap>)._addedLayers;
    expect(added.length).toBe(0);
    warn.mockRestore();
  });

  // 7.L: !createOverlayLayer (OL Vector API недоступен).
  test('ol.layer.Vector недоступен — warn + install прекращается', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mapHolder.current = makeMap();
    sourceHolder.current = makeSource();

    if (window.ol) delete window.ol.layer;

    installStarCenterHighlight();
    await flushPromises();

    expect(warn).toHaveBeenCalled();
    const added = (mapHolder.current as ReturnType<typeof makeMap>)._addedLayers;
    expect(added.length).toBe(0);
    warn.mockRestore();
  });

  // 7.J: generation !== installGeneration (install → uninstall до резолва getOlMap).
  test('uninstall до резолва getOlMap — handlers не регистрируются', async () => {
    mapHolder.current = makeMap();
    sourceHolder.current = makeSource();
    installStarCenterHighlight();
    uninstallStarCenterHighlight();
    await flushPromises();
    const added = (mapHolder.current as ReturnType<typeof makeMap>)._addedLayers;
    expect(added.length).toBe(0);
  });

  test('getOlMap reject — warn без краша, pendingInstall сброшен', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.resetModules();
    // Временно подменяем мок getOlMap на reject.
    jest.doMock('../../core/olMap', () => ({
      getOlMap: () => Promise.reject(new Error('no map')),
      findLayerByName: () => null,
    }));
    const mod: {
      installStarCenterHighlight: () => void;
      uninstallStarCenterHighlight: () => void;
    } = await import('./starCenterHighlight');
    mod.installStarCenterHighlight();
    await flushPromises();
    expect(warn).toHaveBeenCalled();
    mod.uninstallStarCenterHighlight();
    warn.mockRestore();
    jest.dontMock('../../core/olMap');
    jest.resetModules();
  });
});

describe('refreshOverlay', () => {
  async function setupInstalled(
    features: IOlFeature[] = [],
  ): Promise<{ map: ReturnType<typeof makeMap>; pointsSource: IFakeSource }> {
    const map = makeMap();
    const pointsSource = makeSource(features);
    mapHolder.current = map;
    sourceHolder.current = pointsSource;
    installStarCenterHighlight();
    await flushPromises();
    return { map, pointsSource };
  }

  function getOverlayFeatures(map: ReturnType<typeof makeMap>): readonly IOlFeature[] {
    return map._addedLayers[0]?.getSource()?.getFeatures() ?? [];
  }

  // 7.C TRUE: guid === null → clear, выход.
  test('guid === null — overlay очищается и остаётся пустым', async () => {
    const { map, pointsSource } = await setupInstalled([makeFeature('center')]);
    setStarCenter('center', '');
    expect(getOverlayFeatures(map).length).toBe(1);

    clearStarCenter();
    void pointsSource; // для подавления unused
    expect(getOverlayFeatures(map).length).toBe(0);
  });

  // 7.D: !centerFeature — return (overlay пуст после clear).
  test('центр назначен, feature нет в source — overlay пуст', async () => {
    const { map } = await setupInstalled([makeFeature('other')]);
    setStarCenter('missing-guid', '');
    expect(getOverlayFeatures(map).length).toBe(0);
  });

  // 7.C FALSE & 7.D FALSE & 7.F FALSE: всё проходит → addFeature.
  test('центр в source, стиль валидный — overlay feature добавлен', async () => {
    const { map } = await setupInstalled([makeFeature('center', [100, 200])]);
    setStarCenter('center', '');
    expect(getOverlayFeatures(map).length).toBe(1);
  });

  // 7.E.1: !ol.Feature.
  test('ol.Feature недоступен — overlay не создаётся', async () => {
    const { map } = await setupInstalled([makeFeature('center')]);
    if (window.ol) delete window.ol.Feature;
    setStarCenter('center', '');
    expect(getOverlayFeatures(map).length).toBe(0);
  });

  // 7.E.2: !ol.geom.Point.
  test('ol.geom.Point недоступен — overlay не создаётся', async () => {
    const { map } = await setupInstalled([makeFeature('center')]);
    if (window.ol) delete window.ol.geom;
    setStarCenter('center', '');
    expect(getOverlayFeatures(map).length).toBe(0);
  });

  // Реакция на STAR_CENTER_CHANGED_EVENT (используется setStarCenter).
  test('dispatch STAR_CENTER_CHANGED_EVENT перерисовывает overlay', async () => {
    const { map } = await setupInstalled([makeFeature('a'), makeFeature('b')]);
    setStarCenter('a', '');
    expect(getOverlayFeatures(map).length).toBe(1);

    setStarCenter('b', '');
    // Overlay очищен и пересоздан с новыми координатами (1 feature для нового центра).
    expect(getOverlayFeatures(map).length).toBe(1);
  });

  // Реакция на source 'addfeature' для центра — refreshOverlay отрабатывает.
  test('emit addfeature для центра — refreshOverlay создаёт overlay', async () => {
    const { map, pointsSource } = await setupInstalled([]);
    setStarCenter('center', '');
    expect(getOverlayFeatures(map).length).toBe(0);

    const centerFeature = makeFeature('center');
    pointsSource._features.push(centerFeature);
    pointsSource.emitAddFeature(centerFeature);

    expect(getOverlayFeatures(map).length).toBe(1);
  });

  // 'addfeature' для не-центра не триггерит refreshOverlay (фильтр по getId).
  test('emit addfeature для другой точки — overlay не пересчитывается', async () => {
    const { map, pointsSource } = await setupInstalled([makeFeature('center')]);
    setStarCenter('center', '');
    expect(getOverlayFeatures(map).length).toBe(1);
    const initialFeature = getOverlayFeatures(map)[0];

    const otherFeature = makeFeature('other');
    pointsSource._features.push(otherFeature);
    pointsSource.emitAddFeature(otherFeature);

    // Overlay не пересчитан: тот же instance feature.
    expect(getOverlayFeatures(map).length).toBe(1);
    expect(getOverlayFeatures(map)[0]).toBe(initialFeature);
  });

  // 'removefeature' для центра очищает overlay.
  test('emit removefeature для центра — overlay очищается', async () => {
    const centerFeature = makeFeature('center');
    const { map, pointsSource } = await setupInstalled([centerFeature]);
    setStarCenter('center', '');
    expect(getOverlayFeatures(map).length).toBe(1);

    // Симулируем удаление feature из points-layer.
    const index = pointsSource._features.indexOf(centerFeature);
    if (index >= 0) pointsSource._features.splice(index, 1);
    pointsSource.emitRemoveFeature(centerFeature);

    // refreshOverlay при getStarCenterGuid() матчит feature с центром, но
    // findFeatureByGuid возвращает null - overlay clear() и feature не добавлена.
    expect(getOverlayFeatures(map).length).toBe(0);
  });
});

describe('findFeatureByGuid (через refreshOverlay)', () => {
  // 7.G TRUE: getId() === guid.
  test('feature с matching GUID найдена', async () => {
    const map = makeMap();
    const source = makeSource([makeFeature('other'), makeFeature('center', [5, 7])]);
    mapHolder.current = map;
    sourceHolder.current = source;
    setStarCenter('center', '');
    installStarCenterHighlight();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(map._addedLayers[0].getSource()?.getFeatures().length).toBe(1);
  });

  // 7.G FALSE: цикл проходит все features, никто не матчится.
  test('все getId() !== guid → overlay пуст', async () => {
    const map = makeMap();
    const source = makeSource([makeFeature('a'), makeFeature('b')]);
    mapHolder.current = map;
    sourceHolder.current = source;
    setStarCenter('missing', '');
    installStarCenterHighlight();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(map._addedLayers[0].getSource()?.getFeatures().length).toBe(0);
  });
});

describe('uninstall', () => {
  // 7.M all-pass: full uninstall удаляет layer.
  test('full uninstall удаляет overlay layer и все подписки', async () => {
    const map = makeMap();
    const source = makeSource([makeFeature('center')]);
    mapHolder.current = map;
    sourceHolder.current = source;
    setStarCenter('center', '');
    installStarCenterHighlight();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(map._addedLayers.length).toBe(1);

    uninstallStarCenterHighlight();

    expect(map._addedLayers.length).toBe(0);
    // addfeature/removefeature handlers отключены: dispatch не падает.
    expect(() => {
      source.emitAddFeature(makeFeature('center'));
      source.emitRemoveFeature(makeFeature('center'));
    }).not.toThrow();

    // STAR_CENTER_CHANGED_EVENT больше не должен влиять.
    setStarCenter('new', '');
    expect(map._addedLayers.length).toBe(0);
  });

  // 7.M FALSE: uninstall без успешного install (graceful) — не падает.
  test('uninstall без install не бросает', () => {
    expect(() => {
      uninstallStarCenterHighlight();
    }).not.toThrow();
  });

  // Проверка: uninstall после отсутствующего source — все null-checks работают.
  test('uninstall после неудачного install (нет source) — не падает', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mapHolder.current = makeMap();
    sourceHolder.current = null;

    installStarCenterHighlight();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(() => {
      uninstallStarCenterHighlight();
    }).not.toThrow();

    warn.mockRestore();
  });

  test('uninstall несколько раз подряд — не падает', async () => {
    const map = makeMap();
    const source = makeSource();
    mapHolder.current = map;
    sourceHolder.current = source;
    installStarCenterHighlight();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(() => {
      uninstallStarCenterHighlight();
      uninstallStarCenterHighlight();
    }).not.toThrow();
  });

  // 7.O: starCenterChangeHandler null-check.
  test('после uninstall STAR_CENTER_CHANGED_EVENT не триггерит overlay', async () => {
    const map = makeMap();
    const source = makeSource([makeFeature('center')]);
    mapHolder.current = map;
    sourceHolder.current = source;
    installStarCenterHighlight();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    uninstallStarCenterHighlight();
    document.dispatchEvent(new CustomEvent(STAR_CENTER_CHANGED_EVENT));

    expect(map._addedLayers.length).toBe(0);
  });
});
