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
