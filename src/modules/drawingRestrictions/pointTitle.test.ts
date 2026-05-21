import { getPointTitleByGuid } from './pointTitle';
import type { IOlFeature, IOlLayer, IOlMap, IOlVectorSource } from '../../core/olMap';

const mapHolder: { current: IOlMap | null } = { current: null };
const sourceHolder: { current: IOlVectorSource | null } = { current: null };

jest.mock('../../core/olMap', () => {
  const actual: typeof import('../../core/olMap') = jest.requireActual('../../core/olMap');
  return {
    ...actual,
    getCapturedOlMap: (): IOlMap | null => mapHolder.current,
    findLayerByName: (): IOlLayer | null =>
      sourceHolder.current
        ? {
            get: (): string => 'points',
            getSource: (): IOlVectorSource | null => sourceHolder.current,
          }
        : null,
  };
});

function makeFeature(id: string, title: string | null): IOlFeature {
  const properties: Record<string, unknown> = title !== null ? { title } : {};
  return {
    getId: () => id,
    setId: () => {},
    setStyle: () => {},
    getGeometry: () => ({ getCoordinates: () => [0, 0] }),
    get: (key: string) => properties[key],
  };
}

function makeSource(features: IOlFeature[]): IOlVectorSource {
  return {
    getFeatures: () => features,
    addFeature: () => {},
    clear: () => {},
    on: () => {},
    un: () => {},
    getFeatureById: (id: string | number) =>
      features.find((feature) => feature.getId() === id) ?? null,
  };
}

function makeMap(): IOlMap {
  return {
    addLayer: () => {},
    removeLayer: () => {},
    getView: () => ({
      padding: [0, 0, 0, 0],
      getCenter: () => undefined,
      setCenter: () => {},
      calculateExtent: () => [0, 0, 0, 0],
      changed: () => {},
      getRotation: () => 0,
      setRotation: () => {},
    }),
    getSize: () => [800, 600],
    getLayers: () => ({ getArray: () => [] }),
    getInteractions: () => ({ getArray: () => [] }),
    updateSize: () => {},
  };
}

function createPopup(guid: string, title: string | null, hidden = false): HTMLElement {
  const popup = document.createElement('div');
  popup.className = hidden ? 'info popup hidden' : 'info popup';
  popup.dataset.guid = guid;
  document.body.appendChild(popup);
  if (title !== null) {
    const span = document.createElement('span');
    span.id = 'i-title';
    span.textContent = title;
    document.body.appendChild(span);
  }
  return popup;
}

beforeEach(() => {
  mapHolder.current = null;
  sourceHolder.current = null;
  document.body.innerHTML = '';
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('getPointTitleByGuid — DOM-источник (открытый попап)', () => {
  test('попап открыт на запрошенной точке - имя из #i-title', () => {
    createPopup('p1', 'Alpha Point');
    expect(getPointTitleByGuid('p1')).toBe('Alpha Point');
  });

  test('попап работает даже когда карта не захвачена и feature не загружен', () => {
    // Имитация deep-link / showInfo на точку вне viewport: OL карты нет.
    mapHolder.current = null;
    sourceHolder.current = null;
    createPopup('p1', 'Remote Point');
    expect(getPointTitleByGuid('p1')).toBe('Remote Point');
  });

  test('текст в #i-title с обрезаемыми пробелами trim-ится', () => {
    createPopup('p1', '   Padded Name   ');
    expect(getPointTitleByGuid('p1')).toBe('Padded Name');
  });

  test('пустой #i-title - переход к OL fallback', () => {
    createPopup('p1', '');
    mapHolder.current = makeMap();
    sourceHolder.current = makeSource([makeFeature('p1', 'From Feature')]);
    expect(getPointTitleByGuid('p1')).toBe('From Feature');
  });

  test('попап hidden - источник не используется (трактуем как закрытый)', () => {
    createPopup('p1', 'Hidden Title', true);
    mapHolder.current = makeMap();
    sourceHolder.current = makeSource([makeFeature('p1', 'From Feature')]);
    expect(getPointTitleByGuid('p1')).toBe('From Feature');
  });

  test('попап на другой точке - DOM-источник пропускается, переход к feature', () => {
    createPopup('other', 'Other Title');
    mapHolder.current = makeMap();
    sourceHolder.current = makeSource([makeFeature('p1', 'Feature P1')]);
    expect(getPointTitleByGuid('p1')).toBe('Feature P1');
  });

  test('попап без data-guid - переход к feature', () => {
    const popup = document.createElement('div');
    popup.className = 'info popup';
    document.body.appendChild(popup);
    mapHolder.current = makeMap();
    sourceHolder.current = makeSource([makeFeature('p1', 'Feature P1')]);
    expect(getPointTitleByGuid('p1')).toBe('Feature P1');
  });
});

describe('getPointTitleByGuid — OL feature источник', () => {
  test('feature найден по guid, title есть - возвращает title', () => {
    mapHolder.current = makeMap();
    sourceHolder.current = makeSource([makeFeature('p1', 'Alpha')]);
    expect(getPointTitleByGuid('p1')).toBe('Alpha');
  });

  test('feature найден, title пустая строка - null', () => {
    mapHolder.current = makeMap();
    sourceHolder.current = makeSource([makeFeature('p1', '')]);
    expect(getPointTitleByGuid('p1')).toBeNull();
  });

  test('feature без свойства title - null', () => {
    mapHolder.current = makeMap();
    sourceHolder.current = makeSource([makeFeature('p1', null)]);
    expect(getPointTitleByGuid('p1')).toBeNull();
  });

  test('feature с таким guid в layer нет - null', () => {
    mapHolder.current = makeMap();
    sourceHolder.current = makeSource([makeFeature('other', 'Other')]);
    expect(getPointTitleByGuid('p1')).toBeNull();
  });

  test('points-layer не найден - null', () => {
    mapHolder.current = makeMap();
    sourceHolder.current = null;
    expect(getPointTitleByGuid('p1')).toBeNull();
  });

  test('карта не захвачена - null', () => {
    mapHolder.current = null;
    sourceHolder.current = null;
    expect(getPointTitleByGuid('p1')).toBeNull();
  });

  test('linear fallback: getFeatureById недоступен, перебор getFeatures', () => {
    mapHolder.current = makeMap();
    const features = [makeFeature('p1', 'Linear'), makeFeature('p2', 'Other')];
    sourceHolder.current = {
      getFeatures: () => features,
      addFeature: () => {},
      clear: () => {},
      on: () => {},
      un: () => {},
      // getFeatureById намеренно отсутствует
    };
    expect(getPointTitleByGuid('p1')).toBe('Linear');
  });
});

describe('getPointTitleByGuid — приоритет источников', () => {
  test('попап на запрошенной точке + feature: побеждает попап', () => {
    createPopup('p1', 'From Popup');
    mapHolder.current = makeMap();
    sourceHolder.current = makeSource([makeFeature('p1', 'From Feature')]);
    expect(getPointTitleByGuid('p1')).toBe('From Popup');
  });
});
