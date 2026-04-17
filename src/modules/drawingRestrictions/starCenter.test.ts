import {
  STAR_CENTER_CHANGED_EVENT,
  clearStarCenter,
  getStarCenterGuid,
  setStarCenterGuid,
} from './starCenter';

beforeEach(() => {
  localStorage.clear();
});

describe('starCenter', () => {
  test('getStarCenterGuid при пустом LS возвращает null', () => {
    expect(getStarCenterGuid()).toBeNull();
  });

  test('setStarCenterGuid сохраняет значение и диспатчит событие', () => {
    const listener = jest.fn();
    document.addEventListener(STAR_CENTER_CHANGED_EVENT, listener);
    setStarCenterGuid('abc');
    expect(getStarCenterGuid()).toBe('abc');
    expect(listener).toHaveBeenCalledTimes(1);
    document.removeEventListener(STAR_CENTER_CHANGED_EVENT, listener);
  });

  test('setStarCenterGuid с пустой строкой игнорируется', () => {
    setStarCenterGuid('');
    expect(getStarCenterGuid()).toBeNull();
  });

  test('clearStarCenter удаляет значение и диспатчит событие', () => {
    setStarCenterGuid('abc');
    const listener = jest.fn();
    document.addEventListener(STAR_CENTER_CHANGED_EVENT, listener);
    clearStarCenter();
    expect(getStarCenterGuid()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(1);
    document.removeEventListener(STAR_CENTER_CHANGED_EVENT, listener);
  });

  test('повторный set с тем же значением диспатчит событие', () => {
    setStarCenterGuid('abc');
    const listener = jest.fn();
    document.addEventListener(STAR_CENTER_CHANGED_EVENT, listener);
    setStarCenterGuid('abc');
    expect(listener).toHaveBeenCalledTimes(1);
    document.removeEventListener(STAR_CENTER_CHANGED_EVENT, listener);
  });
});
