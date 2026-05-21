import { drawingRestrictions } from './drawingRestrictions';
import { uninstallDrawFilterForTest } from './drawFilter';

jest.mock('../../core/dom', () => ({
  injectStyles: jest.fn(),
  removeStyles: jest.fn(),
  waitForElement: jest.fn(() => new Promise(() => {})),
}));

jest.mock('../../core/olMap', () => ({
  getOlMap: jest.fn(() => new Promise(() => {})),
  findLayerByName: jest.fn(() => null),
}));

jest.mock('../../core/toast', () => ({
  showToast: jest.fn(),
}));

function createPopup(guid: string): HTMLElement {
  const popup = document.createElement('div');
  popup.className = 'info popup';
  popup.dataset.guid = guid;
  const closeButton = document.createElement('button');
  closeButton.className = 'popup-close';
  popup.appendChild(closeButton);
  document.body.appendChild(popup);
  return popup;
}

const showInfoMock = jest.fn();
let originalFetch: typeof window.fetch;

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  showInfoMock.mockClear();
  (window as unknown as { showInfo: typeof showInfoMock }).showInfo = showInfoMock;
  originalFetch = window.fetch;
});

afterEach(() => {
  void drawingRestrictions.disable();
  uninstallDrawFilterForTest();
  window.fetch = originalFetch;
  delete (window as unknown as { showInfo?: typeof showInfoMock }).showInfo;
  document.body.innerHTML = '';
  localStorage.clear();
});

describe('drawingRestrictions — refresh открытого попапа при enable', () => {
  test('enable при открытом попапе переоткрывает попап через showInfo', () => {
    const popup = createPopup('B');
    const closeSpy = jest.fn();
    popup.querySelector('.popup-close')?.addEventListener('click', closeSpy);

    void drawingRestrictions.enable();

    expect(closeSpy).toHaveBeenCalledTimes(1);
    expect(showInfoMock).toHaveBeenCalledWith('B');
  });

  test('enable без открытого попапа - showInfo не вызывается', () => {
    void drawingRestrictions.enable();
    expect(showInfoMock).not.toHaveBeenCalled();
  });
});

describe('drawingRestrictions — eager миграция legacy starCenter при enable', () => {
  const STORAGE_KEY = 'svp_drawingRestrictions_starCenter';

  test('plain GUID переписывается в JSON { guid, active: true }', () => {
    localStorage.setItem(STORAGE_KEY, 'legacy-guid');
    void drawingRestrictions.enable();
    expect(localStorage.getItem(STORAGE_KEY)).toBe(
      JSON.stringify({ guid: 'legacy-guid', active: true }),
    );
  });

  test('JSON { guid } без active переписывается в { guid, active: true }', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ guid: 'legacy-guid' }));
    void drawingRestrictions.enable();
    expect(localStorage.getItem(STORAGE_KEY)).toBe(
      JSON.stringify({ guid: 'legacy-guid', active: true }),
    );
  });

  test('новый формат не трогается (idempotent)', () => {
    const raw = JSON.stringify({ guid: 'g', active: false });
    localStorage.setItem(STORAGE_KEY, raw);
    void drawingRestrictions.enable();
    expect(localStorage.getItem(STORAGE_KEY)).toBe(raw);
  });

  test('пустой LS - no-op', () => {
    void drawingRestrictions.enable();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});
