import { buildRefCounts, fontSizeForZoom, keyCountFix } from './keyCountFix';
import type { IOlFeature, IOlLayer, IOlMap, IOlVectorSource, IOlView } from '../../core/olMap';

// ── helpers ──────────────────────────────────────────────────────────────────

function makeSource(
  features: IOlFeature[] = [],
): IOlVectorSource & { _listeners: Map<string, (() => void)[]> } {
  const listeners = new Map<string, (() => void)[]>();
  return {
    _listeners: listeners,
    getFeatures: () => features,
    addFeature: jest.fn(),
    clear: jest.fn(),
    on(type: string, cb: () => void) {
      const arr = listeners.get(type) ?? [];
      arr.push(cb);
      listeners.set(type, arr);
    },
    un(type: string, cb: () => void) {
      const arr = listeners.get(type) ?? [];
      listeners.set(
        type,
        arr.filter((l) => l !== cb),
      );
    },
  };
}

function makeView(zoom = 16): IOlView {
  const listeners = new Map<string, (() => void)[]>();
  return {
    padding: [0, 0, 0, 0],
    getCenter: () => undefined,
    setCenter: () => {},
    calculateExtent: () => [0, 0, 0, 0],
    changed: () => {},
    getRotation: () => 0,
    setRotation: () => {},
    getZoom: () => zoom,
    on(type: string, cb: () => void) {
      const arr = listeners.get(type) ?? [];
      arr.push(cb);
      listeners.set(type, arr);
    },
    un(type: string, cb: () => void) {
      const arr = listeners.get(type) ?? [];
      listeners.set(
        type,
        arr.filter((l) => l !== cb),
      );
    },
  };
}

function makeLayer(name: string, source: IOlVectorSource | null): IOlLayer {
  return {
    get: (key: string) => (key === 'name' ? name : undefined),
    getSource: () => source,
  };
}

function makeMap(layers: IOlLayer[], view: IOlView): IOlMap {
  const addLayerMock = jest.fn();
  const removeLayerMock = jest.fn();
  return {
    getView: () => view,
    getSize: () => [800, 600],
    getLayers: () => ({ getArray: () => layers }),
    getInteractions: () => ({ getArray: () => [] }),
    addLayer: addLayerMock,
    removeLayer: removeLayerMock,
    updateSize: jest.fn(),
  };
}

function mockOl(): void {
  const createdSources: IOlVectorSource[] = [];
  const createdLayers: IOlLayer[] = [];

  window.ol = {
    Map: { prototype: { getView: jest.fn() } },
    source: {
      Vector: jest.fn().mockImplementation(() => {
        const s = makeSource();
        createdSources.push(s);
        return s;
      }) as unknown as new () => IOlVectorSource,
    },
    layer: {
      Vector: jest.fn().mockImplementation(() => {
        const l = makeLayer('labels', createdSources[createdSources.length - 1] ?? makeSource());
        createdLayers.push(l);
        return l;
      }) as unknown as new (opts: Record<string, unknown>) => IOlLayer,
    },
    Feature: jest.fn().mockImplementation(() => ({
      getGeometry: () => ({ getCoordinates: () => [0, 0] }),
      getId: () => undefined,
      setId: jest.fn(),
      setStyle: jest.fn(),
    })) as unknown as new (opts?: Record<string, unknown>) => IOlFeature,
    geom: {
      Point: jest.fn().mockImplementation((coords: number[]) => ({
        getCoordinates: () => coords,
      })) as unknown as new (coords: number[]) => { getCoordinates(): number[] },
    },
    style: {
      Style: jest.fn().mockImplementation((o: Record<string, unknown>) => o) as unknown as new (
        opts: Record<string, unknown>,
      ) => unknown,
      Text: jest.fn().mockImplementation((o: Record<string, unknown>) => o) as unknown as new (
        opts: Record<string, unknown>,
      ) => unknown,
      Fill: jest.fn().mockImplementation((o: Record<string, unknown>) => o) as unknown as new (
        opts: Record<string, unknown>,
      ) => unknown,
      Stroke: jest.fn().mockImplementation((o: Record<string, unknown>) => o) as unknown as new (
        opts: Record<string, unknown>,
      ) => unknown,
    },
  };
}

// ── buildRefCounts ────────────────────────────────────────────────────────────

describe('buildRefCounts', () => {
  afterEach(() => {
    localStorage.removeItem('inventory-cache');
  });

  test('returns empty map when no cache', () => {
    expect(buildRefCounts().size).toBe(0);
  });

  test('returns empty map on invalid JSON', () => {
    localStorage.setItem('inventory-cache', 'not-json');
    expect(buildRefCounts().size).toBe(0);
  });

  test('returns empty map when cache is not array', () => {
    localStorage.setItem('inventory-cache', '{"t":3}');
    expect(buildRefCounts().size).toBe(0);
  });

  test('counts refs per point', () => {
    const items = [
      { g: 'r1', t: 3, l: 'point-1', a: 2 },
      { g: 'r2', t: 3, l: 'point-1', a: 1 },
      { g: 'r3', t: 3, l: 'point-2', a: 3 },
    ];
    localStorage.setItem('inventory-cache', JSON.stringify(items));
    const counts = buildRefCounts();
    expect(counts.get('point-1')).toBe(3);
    expect(counts.get('point-2')).toBe(3);
  });

  test('ignores non-ref item types', () => {
    const items = [
      { g: 'c1', t: 1, l: 'point-1', a: 5 }, // not a ref
      { g: 'r1', t: 3, l: 'point-2', a: 2 },
    ];
    localStorage.setItem('inventory-cache', JSON.stringify(items));
    const counts = buildRefCounts();
    expect(counts.has('point-1')).toBe(false);
    expect(counts.get('point-2')).toBe(2);
  });

  test('ignores items with missing fields', () => {
    const items = [
      { t: 3, a: 1 }, // missing g and l
      { g: 'r1', t: 3, l: 42, a: 1 }, // l is not string
      { g: 'r2', t: 3, l: 'point-ok', a: 1 },
    ];
    localStorage.setItem('inventory-cache', JSON.stringify(items));
    const counts = buildRefCounts();
    expect(counts.size).toBe(1);
    expect(counts.get('point-ok')).toBe(1);
  });
});

// ── module metadata ───────────────────────────────────────────────────────────

describe('keyCountFix metadata', () => {
  test('has correct id', () => {
    expect(keyCountFix.id).toBe('keyCountFix');
  });

  test('has style category', () => {
    expect(keyCountFix.category).toBe('map');
  });

  test('is enabled by default', () => {
    expect(keyCountFix.defaultEnabled).toBe(true);
  });

  test('has localized name and description', () => {
    expect(keyCountFix.name.ru).toBeTruthy();
    expect(keyCountFix.name.en).toBeTruthy();
    expect(keyCountFix.description.ru).toBeTruthy();
    expect(keyCountFix.description.en).toBeTruthy();
  });
});

// ── enable / disable ──────────────────────────────────────────────────────────

// Mock getOlMap to return a controlled map
jest.mock('../../core/olMap', () => ({
  getOlMap: jest.fn(),
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- jest.requireActual returns any
  findLayerByName: jest.requireActual('../../core/olMap').findLayerByName,
}));

import { getOlMap } from '../../core/olMap';

const mockGetOlMap = getOlMap as jest.MockedFunction<typeof getOlMap>;

describe('keyCountFix enable/disable', () => {
  let pointsSrc: ReturnType<typeof makeSource>;
  let olMap: IOlMap;
  let view: IOlView;

  beforeEach(() => {
    localStorage.removeItem('inventory-cache');
    // Тесты enable/disable проверяют поток для уже включённого References-слоя.
    // Условный no-op при выключенном References — отдельный describe ниже.
    localStorage.setItem('map-config', JSON.stringify({ h: 0x070000 }));
    pointsSrc = makeSource();
    view = makeView(16);
    const pointsLayer = makeLayer('points', pointsSrc);
    olMap = makeMap([pointsLayer], view);
    mockGetOlMap.mockResolvedValue(olMap);
    mockOl();
  });

  afterEach(async () => {
    await keyCountFix.disable();
    delete window.ol;
    localStorage.removeItem('map-config');
  });

  test('adds layer to map on enable', async () => {
    await keyCountFix.enable();
    expect((olMap.addLayer as jest.Mock).mock.calls.length).toBeGreaterThan(0);
  });

  test('removes layer from map on disable after enable', async () => {
    await keyCountFix.enable();
    await keyCountFix.disable();
    expect((olMap.removeLayer as jest.Mock).mock.calls.length).toBeGreaterThan(0);
  });

  test('subscribes to points source change on enable', async () => {
    await keyCountFix.enable();
    expect(pointsSrc._listeners.get('change')?.length).toBeGreaterThan(0);
  });

  test('unsubscribes from points source change on disable', async () => {
    await keyCountFix.enable();
    await keyCountFix.disable();
    expect(pointsSrc._listeners.get('change')?.length ?? 0).toBe(0);
  });

  test('does nothing if ol constructors are absent', async () => {
    window.ol = { Map: { prototype: { getView: jest.fn() } } };
    await keyCountFix.enable();
    expect((olMap.addLayer as jest.Mock).mock.calls.length).toBe(0);
  });

  test('does nothing if points layer is not found', async () => {
    const otherLayer = makeLayer('other', makeSource());
    mockGetOlMap.mockResolvedValue(makeMap([otherLayer], view));
    await keyCountFix.enable();
    expect((olMap.addLayer as jest.Mock).mock.calls.length).toBe(0);
  });
});

// ── adaptive font size ────────────────────────────────────────────────────────

describe('fontSizeForZoom', () => {
  // На MIN_ZOOM (13) шрифт прижат к нижней границе 10px — этого достаточно для
  // чтения, не перекрывает соседние точки. Нативный игровой рендер фиксирован
  // на 32px и при zoom 13-14 разрастается во весь экран — это и есть проблема,
  // которую модуль чинит.
  test('on min zoom 13 returns 10px', () => {
    expect(fontSizeForZoom(13)).toBe(10);
  });

  test('on zoom 16 returns 13px (linear interpolation)', () => {
    expect(fontSizeForZoom(16)).toBe(13);
  });

  test('on zoom 18 saturates at 16px (upper clamp)', () => {
    expect(fontSizeForZoom(18)).toBe(15);
  });

  test('on zoom 20+ does not exceed 16px', () => {
    expect(fontSizeForZoom(20)).toBe(16);
    expect(fontSizeForZoom(25)).toBe(16);
  });

  test('on extra-low zoom (< 13) clamps to 10px', () => {
    expect(fontSizeForZoom(5)).toBe(10);
    expect(fontSizeForZoom(0)).toBe(10);
  });
});

// ── localStorage hook (suppresses native References mode) ────────────────────

describe('keyCountFix localStorage hook for map-config', () => {
  // Перехват `localStorage.getItem('map-config')` маскирует байт 2 (текстовый
  // канал) в 0, если он = 7 (References). Это подавляет нативный 32px-рендер
  // text-канала; наш слой ниже отрисует те же числа адаптивно.

  beforeEach(() => {
    localStorage.removeItem('map-config');
    const view = makeView(16);
    const pointsLayer = makeLayer('points', makeSource());
    const olMap = makeMap([pointsLayer], view);
    mockGetOlMap.mockResolvedValue(olMap);
    mockOl();
  });

  afterEach(async () => {
    await keyCountFix.disable();
    delete window.ol;
    localStorage.removeItem('map-config');
  });

  test('text-channel === 7: после enable getItem возвращает h с обнулённым байтом 2', async () => {
    // h = 0x070101 — top=1 (visited), bottom=1, text=7 (References)
    localStorage.setItem('map-config', JSON.stringify({ h: 0x070101 }));
    await keyCountFix.enable();

    const raw = localStorage.getItem('map-config');
    if (raw === null) throw new Error('map-config missing');
    const parsed = JSON.parse(raw) as { h: number };
    expect((parsed.h >> 16) & 0xff).toBe(0);
    // нижние байты не тронуты
    expect(parsed.h & 0xff).toBe(1);
    expect((parsed.h >> 8) & 0xff).toBe(1);
  });

  test('text-channel !== 7: модуль не активируется, hook не установлен', async () => {
    // h = 0x050202 — top=2, bottom=2, text=5 (Levels) — References не выбран,
    // нативного 32px-рендера нет, фиксить нечего.
    const original = 0x050202;
    localStorage.setItem('map-config', JSON.stringify({ h: original }));
    const view = makeView(16);
    const pointsLayer = makeLayer('points', makeSource());
    const olMap = makeMap([pointsLayer], view);
    mockGetOlMap.mockResolvedValue(olMap);

    await keyCountFix.enable();

    // Слой не добавлен на карту.
    expect((olMap.addLayer as jest.Mock).mock.calls.length).toBe(0);
    // Хук не установлен — getItem возвращает оригинал без маскирования.
    const raw = localStorage.getItem('map-config');
    if (raw === null) throw new Error('map-config missing');
    const parsed = JSON.parse(raw) as { h: number };
    expect(parsed.h).toBe(original);
  });

  test('map-config отсутствует: модуль не активируется', async () => {
    localStorage.removeItem('map-config');
    const view = makeView(16);
    const pointsLayer = makeLayer('points', makeSource());
    const olMap = makeMap([pointsLayer], view);
    mockGetOlMap.mockResolvedValue(olMap);

    await keyCountFix.enable();

    expect((olMap.addLayer as jest.Mock).mock.calls.length).toBe(0);
  });

  test('невалидный JSON в map-config: модуль не активируется', async () => {
    localStorage.setItem('map-config', '{not-json');
    const view = makeView(16);
    const pointsLayer = makeLayer('points', makeSource());
    const olMap = makeMap([pointsLayer], view);
    mockGetOlMap.mockResolvedValue(olMap);

    await keyCountFix.enable();

    expect((olMap.addLayer as jest.Mock).mock.calls.length).toBe(0);
    // map-config возвращается как был — наш хук не вмешивается.
    expect(localStorage.getItem('map-config')).toBe('{not-json');
  });

  test('после disable getItem возвращает оригинальное значение', async () => {
    localStorage.setItem('map-config', JSON.stringify({ h: 0x070101 }));
    await keyCountFix.enable();
    await keyCountFix.disable();

    const raw = localStorage.getItem('map-config');
    if (raw === null) throw new Error('map-config missing');
    const parsed = JSON.parse(raw) as { h: number };
    // disable восстанавливает Storage.prototype.getItem — байт 2 снова виден
    expect((parsed.h >> 16) & 0xff).toBe(7);
  });

  test('хук не трогает другие ключи localStorage', async () => {
    localStorage.setItem('map-config', JSON.stringify({ h: 0x070000 }));
    localStorage.setItem('inventory-cache', JSON.stringify([{ g: 'x', t: 3 }]));
    await keyCountFix.enable();

    expect(localStorage.getItem('inventory-cache')).toBe(JSON.stringify([{ g: 'x', t: 3 }]));
  });
});

describe('keyCountFix реакция на смену text channel в layers-config', () => {
  // Сценарий из реальной игры: пользователь меняет настройку Text-слоя в
  // layers-config. Игра делает localStorage.setItem('map-config', ...) и
  // requestEntities(). Наш модуль должен синхронно activate/deactivate -
  // без перезагрузки страницы.

  let pointsSrc: ReturnType<typeof makeSource>;
  let olMap: IOlMap;
  let view: IOlView;

  beforeEach(() => {
    localStorage.removeItem('inventory-cache');
    localStorage.removeItem('map-config');
    pointsSrc = makeSource();
    view = makeView(16);
    const pointsLayer = makeLayer('points', pointsSrc);
    olMap = makeMap([pointsLayer], view);
    mockGetOlMap.mockResolvedValue(olMap);
    mockOl();
  });

  afterEach(async () => {
    await keyCountFix.disable();
    delete window.ol;
    localStorage.removeItem('map-config');
  });

  test('старт с text=Levels: модуль пассивен; setItem с text=References активирует', async () => {
    localStorage.setItem('map-config', JSON.stringify({ h: 0x050000 })); // text=5 Levels
    await keyCountFix.enable();
    expect((olMap.addLayer as jest.Mock).mock.calls.length).toBe(0);

    // Игра меняет настройку: text=Refs.
    localStorage.setItem('map-config', JSON.stringify({ h: 0x070000 }));
    // setItem hook должен синхронно activate; getOlMap асинхронный.
    await Promise.resolve();
    await Promise.resolve();

    expect((olMap.addLayer as jest.Mock).mock.calls.length).toBeGreaterThan(0);
  });

  test('старт с text=Refs: модуль активен; setItem с text=Levels деактивирует', async () => {
    localStorage.setItem('map-config', JSON.stringify({ h: 0x070000 }));
    await keyCountFix.enable();
    expect((olMap.addLayer as jest.Mock).mock.calls.length).toBeGreaterThan(0);

    // Игра меняет настройку: text=Levels. Должен deactivate.
    localStorage.setItem('map-config', JSON.stringify({ h: 0x050000 }));
    await Promise.resolve();

    expect((olMap.removeLayer as jest.Mock).mock.calls.length).toBeGreaterThan(0);

    // getItem hook снят: значение уже не маскируется.
    const raw = localStorage.getItem('map-config');
    if (raw === null) throw new Error('map-config missing');
    expect(((JSON.parse(raw) as { h: number }).h >> 16) & 0xff).toBe(5);
  });

  test('multiple toggle: refs -> levels -> refs -> levels', async () => {
    localStorage.setItem('map-config', JSON.stringify({ h: 0x070000 }));
    await keyCountFix.enable();
    const addCallsAfterEnable = (olMap.addLayer as jest.Mock).mock.calls.length;
    expect(addCallsAfterEnable).toBeGreaterThan(0);

    // -> levels (deactivate)
    localStorage.setItem('map-config', JSON.stringify({ h: 0x050000 }));
    await Promise.resolve();
    const removeCallsAfter1 = (olMap.removeLayer as jest.Mock).mock.calls.length;
    expect(removeCallsAfter1).toBeGreaterThan(0);

    // -> refs (activate)
    localStorage.setItem('map-config', JSON.stringify({ h: 0x070000 }));
    await Promise.resolve();
    await Promise.resolve();
    const addCallsAfter2 = (olMap.addLayer as jest.Mock).mock.calls.length;
    expect(addCallsAfter2).toBeGreaterThan(addCallsAfterEnable);

    // -> levels (deactivate снова)
    localStorage.setItem('map-config', JSON.stringify({ h: 0x050000 }));
    await Promise.resolve();
    const removeCallsAfter3 = (olMap.removeLayer as jest.Mock).mock.calls.length;
    expect(removeCallsAfter3).toBeGreaterThan(removeCallsAfter1);
  });

  test('setItem с тем же значением (text всё ещё refs): не делаем повторный activate', async () => {
    localStorage.setItem('map-config', JSON.stringify({ h: 0x070000 }));
    await keyCountFix.enable();
    const addCallsAfterEnable = (olMap.addLayer as jest.Mock).mock.calls.length;

    // Тот же text channel - меняется только верхний/нижний highlight.
    localStorage.setItem('map-config', JSON.stringify({ h: 0x070101 }));
    await Promise.resolve();

    expect((olMap.addLayer as jest.Mock).mock.calls.length).toBe(addCallsAfterEnable);
  });

  test('setItem на другой ключ не вызывает activate', async () => {
    localStorage.setItem('map-config', JSON.stringify({ h: 0x050000 }));
    await keyCountFix.enable();
    expect((olMap.addLayer as jest.Mock).mock.calls.length).toBe(0);

    // Совсем другой ключ - не должен реагировать.
    localStorage.setItem('something-else', 'value');
    await Promise.resolve();

    expect((olMap.addLayer as jest.Mock).mock.calls.length).toBe(0);
  });

  test('disable снимает setItem hook: дальнейшие setItem не вызывают activate', async () => {
    localStorage.setItem('map-config', JSON.stringify({ h: 0x050000 }));
    await keyCountFix.enable();
    await keyCountFix.disable();

    localStorage.setItem('map-config', JSON.stringify({ h: 0x070000 }));
    await Promise.resolve();

    expect((olMap.addLayer as jest.Mock).mock.calls.length).toBe(0);
  });
});
