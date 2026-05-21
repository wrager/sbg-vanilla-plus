import {
  STAR_CENTER_CHANGED_EVENT,
  clearStarCenter,
  getActiveStarCenterGuid,
  getStarCenter,
  getStarCenterGuid,
  migrateLegacyStarCenter,
  setStarCenter,
  setStarCenterActive,
} from './starCenter';

const STORAGE_KEY = 'svp_drawingRestrictions_starCenter';

beforeEach(() => {
  localStorage.clear();
});

describe('starCenter — базовое чтение/запись', () => {
  test('getStarCenter при пустом LS возвращает null', () => {
    expect(getStarCenter()).toBeNull();
    expect(getStarCenterGuid()).toBeNull();
    expect(getActiveStarCenterGuid()).toBeNull();
  });

  test('setStarCenter без title: state без поля title', () => {
    const listener = jest.fn();
    document.addEventListener(STAR_CENTER_CHANGED_EVENT, listener);
    setStarCenter('abc');
    expect(getStarCenter()).toEqual({ guid: 'abc', active: true });
    expect(getStarCenterGuid()).toBe('abc');
    expect(getActiveStarCenterGuid()).toBe('abc');
    expect(listener).toHaveBeenCalledTimes(1);
    document.removeEventListener(STAR_CENTER_CHANGED_EVENT, listener);
  });

  test('setStarCenter с title: сохраняет title в state', () => {
    setStarCenter('abc', 'Alpha');
    expect(getStarCenter()).toEqual({ guid: 'abc', active: true, title: 'Alpha' });
  });

  test('setStarCenter с пустым title: title не сохраняется', () => {
    setStarCenter('abc', '');
    expect(getStarCenter()).toEqual({ guid: 'abc', active: true });
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
});

describe('starCenter — setStarCenterActive (toggle без потери guid)', () => {
  test('центра нет - no-op, событие не диспатчится', () => {
    const listener = jest.fn();
    document.addEventListener(STAR_CENTER_CHANGED_EVENT, listener);
    setStarCenterActive(true);
    expect(getStarCenter()).toBeNull();
    expect(listener).not.toHaveBeenCalled();
    document.removeEventListener(STAR_CENTER_CHANGED_EVENT, listener);
  });

  test('setStarCenterActive(false) меняет только active, guid сохраняется', () => {
    setStarCenter('abc');
    const listener = jest.fn();
    document.addEventListener(STAR_CENTER_CHANGED_EVENT, listener);
    setStarCenterActive(false);
    expect(getStarCenter()).toEqual({ guid: 'abc', active: false });
    expect(getStarCenterGuid()).toBe('abc');
    expect(getActiveStarCenterGuid()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(1);
    document.removeEventListener(STAR_CENTER_CHANGED_EVENT, listener);
  });

  test('setStarCenterActive сохраняет cached title', () => {
    setStarCenter('abc', 'Alpha');
    setStarCenterActive(false);
    expect(getStarCenter()).toEqual({ guid: 'abc', active: false, title: 'Alpha' });
    setStarCenterActive(true);
    expect(getStarCenter()).toEqual({ guid: 'abc', active: true, title: 'Alpha' });
  });

  test('setStarCenterActive(true) возвращает фильтр в активное состояние', () => {
    setStarCenter('abc');
    setStarCenterActive(false);
    setStarCenterActive(true);
    expect(getStarCenter()).toEqual({ guid: 'abc', active: true });
    expect(getActiveStarCenterGuid()).toBe('abc');
  });

  test('повторный setStarCenterActive с тем же значением - no-op, событие не диспатчится', () => {
    setStarCenter('abc'); // active=true
    const listener = jest.fn();
    document.addEventListener(STAR_CENTER_CHANGED_EVENT, listener);
    setStarCenterActive(true);
    expect(listener).not.toHaveBeenCalled();
    document.removeEventListener(STAR_CENTER_CHANGED_EVENT, listener);
  });
});

describe('starCenter — legacy parser fallback (active=true по умолчанию)', () => {
  test('legacy-формат (plain GUID без JSON) читается как active=true', () => {
    localStorage.setItem(STORAGE_KEY, 'plain-guid-value');
    expect(getStarCenter()).toEqual({ guid: 'plain-guid-value', active: true });
    expect(getStarCenterGuid()).toBe('plain-guid-value');
    expect(getActiveStarCenterGuid()).toBe('plain-guid-value');
  });

  test('JSON-формат без active - читается как active=true', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ guid: 'abc' }));
    expect(getStarCenter()).toEqual({ guid: 'abc', active: true });
    expect(getActiveStarCenterGuid()).toBe('abc');
  });

  test('JSON с title - читается с title', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ guid: 'abc', active: true, title: 'Alpha' }),
    );
    expect(getStarCenter()).toEqual({ guid: 'abc', active: true, title: 'Alpha' });
  });

  test('JSON с пустым title - title игнорируется', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ guid: 'abc', active: true, title: '' }));
    expect(getStarCenter()).toEqual({ guid: 'abc', active: true });
  });

  test('JSON с title не-строкой - title игнорируется', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ guid: 'abc', active: true, title: 42 }));
    expect(getStarCenter()).toEqual({ guid: 'abc', active: true });
  });

  test('JSON-формат с active=false - режим выключен', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ guid: 'abc', active: false }));
    expect(getStarCenter()).toEqual({ guid: 'abc', active: false });
    expect(getStarCenterGuid()).toBe('abc');
    expect(getActiveStarCenterGuid()).toBeNull();
  });

  test('JSON с active не-boolean - fallback на active=true', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ guid: 'abc', active: 'maybe' }));
    expect(getStarCenter()).toEqual({ guid: 'abc', active: true });
  });

  test('битый JSON возвращает legacy-строку как guid + active=true', () => {
    localStorage.setItem(STORAGE_KEY, '{"broken');
    expect(getStarCenter()).toEqual({ guid: '{"broken', active: true });
  });

  test('JSON-строка - FALSE на typeof==="object" - fallback', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify('some-guid'));
    expect(getStarCenter()).toEqual({ guid: '"some-guid"', active: true });
  });

  test('JSON null - FALSE на parsed!==null - fallback', () => {
    localStorage.setItem(STORAGE_KEY, 'null');
    expect(getStarCenter()).toEqual({ guid: 'null', active: true });
  });

  test('JSON без поля guid - FALSE на "guid" in parsed - fallback', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ name: 'X' }));
    expect(getStarCenter()).toEqual({
      guid: JSON.stringify({ name: 'X' }),
      active: true,
    });
  });

  test('JSON с guid не-строкой - FALSE на typeof guid==="string" - fallback', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ guid: 123 }));
    expect(getStarCenter()).toEqual({
      guid: JSON.stringify({ guid: 123 }),
      active: true,
    });
  });

  test('JSON с пустым guid - FALSE на guid.length>0 - fallback', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ guid: '' }));
    expect(getStarCenter()).toEqual({
      guid: JSON.stringify({ guid: '' }),
      active: true,
    });
  });

  test('JSON старого формата с name игнорирует name, читает только guid', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ guid: 'abc', name: 'Alpha' }));
    expect(getStarCenter()).toEqual({ guid: 'abc', active: true });
  });
});

describe('starCenter — migrateLegacyStarCenter', () => {
  test('пустой LS - no-op', () => {
    migrateLegacyStarCenter();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  test('plain GUID переписывается в { guid, active: true }', () => {
    localStorage.setItem(STORAGE_KEY, 'plain-guid');
    migrateLegacyStarCenter();
    expect(localStorage.getItem(STORAGE_KEY)).toBe(
      JSON.stringify({ guid: 'plain-guid', active: true }),
    );
  });

  test('legacy JSON без active переписывается в { guid, active: true }', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ guid: 'abc' }));
    migrateLegacyStarCenter();
    expect(localStorage.getItem(STORAGE_KEY)).toBe(JSON.stringify({ guid: 'abc', active: true }));
  });

  test('legacy JSON с лишним name схлопывается до { guid, active: true }', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ guid: 'abc', name: 'Alpha' }));
    migrateLegacyStarCenter();
    expect(localStorage.getItem(STORAGE_KEY)).toBe(JSON.stringify({ guid: 'abc', active: true }));
  });

  test('новый формат - no-op (idempotent)', () => {
    const raw = JSON.stringify({ guid: 'abc', active: false });
    localStorage.setItem(STORAGE_KEY, raw);
    migrateLegacyStarCenter();
    expect(localStorage.getItem(STORAGE_KEY)).toBe(raw);
  });

  test('migration не диспатчит STAR_CENTER_CHANGED_EVENT', () => {
    localStorage.setItem(STORAGE_KEY, 'plain-guid');
    const listener = jest.fn();
    document.addEventListener(STAR_CENTER_CHANGED_EVENT, listener);
    migrateLegacyStarCenter();
    expect(listener).not.toHaveBeenCalled();
    document.removeEventListener(STAR_CENTER_CHANGED_EVENT, listener);
  });

  test('повторный вызов миграции на уже мигрированном - no-op', () => {
    localStorage.setItem(STORAGE_KEY, 'plain-guid');
    migrateLegacyStarCenter();
    const afterFirst = localStorage.getItem(STORAGE_KEY);
    migrateLegacyStarCenter();
    expect(localStorage.getItem(STORAGE_KEY)).toBe(afterFirst);
  });
});
