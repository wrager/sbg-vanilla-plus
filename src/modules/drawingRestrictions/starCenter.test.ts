import {
  STAR_CENTER_CHANGED_EVENT,
  clearStarCenter,
  getStarCenter,
  getStarCenterGuid,
  setStarCenter,
} from './starCenter';

beforeEach(() => {
  localStorage.clear();
});

describe('starCenter', () => {
  test('getStarCenter при пустом LS возвращает null', () => {
    expect(getStarCenter()).toBeNull();
    expect(getStarCenterGuid()).toBeNull();
  });

  test('setStarCenter сохраняет guid и диспатчит событие', () => {
    const listener = jest.fn();
    document.addEventListener(STAR_CENTER_CHANGED_EVENT, listener);
    setStarCenter('abc');
    expect(getStarCenter()).toEqual({ guid: 'abc' });
    expect(getStarCenterGuid()).toBe('abc');
    expect(listener).toHaveBeenCalledTimes(1);
    document.removeEventListener(STAR_CENTER_CHANGED_EVENT, listener);
  });

  test('setStarCenter с пустой строкой игнорируется', () => {
    setStarCenter('');
    expect(getStarCenter()).toBeNull();
  });

  test('clearStarCenter удаляет значение и диспатчит событие', () => {
    setStarCenter('abc');
    const listener = jest.fn();
    document.addEventListener(STAR_CENTER_CHANGED_EVENT, listener);
    clearStarCenter();
    expect(getStarCenter()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(1);
    document.removeEventListener(STAR_CENTER_CHANGED_EVENT, listener);
  });

  test('повторный set с тем же guid диспатчит событие', () => {
    setStarCenter('abc');
    const listener = jest.fn();
    document.addEventListener(STAR_CENTER_CHANGED_EVENT, listener);
    setStarCenter('abc');
    expect(listener).toHaveBeenCalledTimes(1);
    document.removeEventListener(STAR_CENTER_CHANGED_EVENT, listener);
  });

  test('legacy-формат (plain GUID без JSON) читается как guid', () => {
    // Раньше в LS лежала просто строка GUID - обратная совместимость.
    localStorage.setItem('svp_drawingRestrictions_starCenter', 'plain-guid-value');
    expect(getStarCenter()).toEqual({ guid: 'plain-guid-value' });
    expect(getStarCenterGuid()).toBe('plain-guid-value');
  });

  test('битый JSON возвращает legacy-строку как guid', () => {
    localStorage.setItem('svp_drawingRestrictions_starCenter', '{"broken');
    expect(getStarCenter()).toEqual({ guid: '{"broken' });
  });

  // parseStored narrowing: FALSE-ветки атомарных проверок попадают в legacy fallback.
  test('JSON-строка - FALSE на typeof==="object" - fallback', () => {
    localStorage.setItem('svp_drawingRestrictions_starCenter', JSON.stringify('some-guid'));
    // JSON.parse вернул строку - не object. Идём в fallback и трактуем raw как legacy.
    expect(getStarCenter()).toEqual({ guid: '"some-guid"' });
  });

  test('JSON null - FALSE на parsed!==null - fallback', () => {
    localStorage.setItem('svp_drawingRestrictions_starCenter', 'null');
    expect(getStarCenter()).toEqual({ guid: 'null' });
  });

  test('JSON без поля guid - FALSE на "guid" in parsed - fallback', () => {
    localStorage.setItem('svp_drawingRestrictions_starCenter', JSON.stringify({ name: 'X' }));
    expect(getStarCenter()).toEqual({
      guid: JSON.stringify({ name: 'X' }),
    });
  });

  test('JSON с guid не-строкой - FALSE на typeof guid==="string" - fallback', () => {
    localStorage.setItem('svp_drawingRestrictions_starCenter', JSON.stringify({ guid: 123 }));
    expect(getStarCenter()).toEqual({
      guid: JSON.stringify({ guid: 123 }),
    });
  });

  test('JSON с пустым guid - FALSE на guid.length>0 - fallback', () => {
    localStorage.setItem('svp_drawingRestrictions_starCenter', JSON.stringify({ guid: '' }));
    expect(getStarCenter()).toEqual({
      guid: JSON.stringify({ guid: '' }),
    });
  });

  test('JSON старого формата с name игнорирует name, читает только guid', () => {
    localStorage.setItem(
      'svp_drawingRestrictions_starCenter',
      JSON.stringify({ guid: 'abc', name: 'Alpha' }),
    );
    expect(getStarCenter()).toEqual({ guid: 'abc' });
  });
});
