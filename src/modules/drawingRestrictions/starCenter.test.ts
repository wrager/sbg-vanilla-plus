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

  test('setStarCenter сохраняет guid и name, диспатчит событие', () => {
    const listener = jest.fn();
    document.addEventListener(STAR_CENTER_CHANGED_EVENT, listener);
    setStarCenter('abc', 'Точка Альфа');
    expect(getStarCenter()).toEqual({ guid: 'abc', name: 'Точка Альфа' });
    expect(getStarCenterGuid()).toBe('abc');
    expect(listener).toHaveBeenCalledTimes(1);
    document.removeEventListener(STAR_CENTER_CHANGED_EVENT, listener);
  });

  test('setStarCenter с пустой строкой в guid игнорируется', () => {
    setStarCenter('', 'name');
    expect(getStarCenter()).toBeNull();
  });

  test('setStarCenter с пустым name сохраняет пустую строку', () => {
    setStarCenter('abc', '');
    expect(getStarCenter()).toEqual({ guid: 'abc', name: '' });
  });

  test('clearStarCenter удаляет значение и диспатчит событие', () => {
    setStarCenter('abc', 'Имя');
    const listener = jest.fn();
    document.addEventListener(STAR_CENTER_CHANGED_EVENT, listener);
    clearStarCenter();
    expect(getStarCenter()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(1);
    document.removeEventListener(STAR_CENTER_CHANGED_EVENT, listener);
  });

  test('повторный set с теми же значениями диспатчит событие', () => {
    setStarCenter('abc', 'Имя');
    const listener = jest.fn();
    document.addEventListener(STAR_CENTER_CHANGED_EVENT, listener);
    setStarCenter('abc', 'Имя');
    expect(listener).toHaveBeenCalledTimes(1);
    document.removeEventListener(STAR_CENTER_CHANGED_EVENT, listener);
  });

  test('legacy-формат (plain GUID без JSON) читается с пустым name', () => {
    // Раньше в LS лежала просто строка GUID — обратная совместимость.
    localStorage.setItem('svp_drawingRestrictions_starCenter', 'plain-guid-value');
    expect(getStarCenter()).toEqual({ guid: 'plain-guid-value', name: '' });
    expect(getStarCenterGuid()).toBe('plain-guid-value');
  });

  test('битый JSON возвращает null', () => {
    localStorage.setItem('svp_drawingRestrictions_starCenter', '{"broken');
    // При невалидном JSON возвращаем значение как legacy-строку (fallback).
    expect(getStarCenter()).toEqual({ guid: '{"broken', name: '' });
  });
});
