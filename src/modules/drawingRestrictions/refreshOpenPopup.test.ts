import { refreshOpenPopup } from './refreshOpenPopup';

interface IShowInfoMock {
  (data: string): void;
}

function createPopup(guid: string, hidden = false): HTMLElement {
  const popup = document.createElement('div');
  popup.className = hidden ? 'info popup hidden' : 'info popup';
  popup.dataset.guid = guid;
  const closeButton = document.createElement('button');
  closeButton.className = 'popup-close';
  popup.appendChild(closeButton);
  document.body.appendChild(popup);
  return popup;
}

const showInfoMock = jest.fn() as jest.MockedFunction<IShowInfoMock>;

beforeEach(() => {
  document.body.innerHTML = '';
  showInfoMock.mockClear();
  (window as unknown as { showInfo: IShowInfoMock }).showInfo = showInfoMock;
});

afterEach(() => {
  delete (window as unknown as { showInfo?: IShowInfoMock }).showInfo;
});

describe('refreshOpenPopup', () => {
  test('попап не открыт - no-op', () => {
    refreshOpenPopup();
    expect(showInfoMock).not.toHaveBeenCalled();
  });

  test('попап hidden - no-op', () => {
    createPopup('B', true);
    refreshOpenPopup();
    expect(showInfoMock).not.toHaveBeenCalled();
  });

  test('попап без data-guid - no-op', () => {
    const popup = document.createElement('div');
    popup.className = 'info popup';
    document.body.appendChild(popup);
    refreshOpenPopup();
    expect(showInfoMock).not.toHaveBeenCalled();
  });

  test('.popup-close отсутствует - no-op', () => {
    const popup = document.createElement('div');
    popup.className = 'info popup';
    popup.dataset.guid = 'B';
    document.body.appendChild(popup);
    refreshOpenPopup();
    expect(showInfoMock).not.toHaveBeenCalled();
  });

  test('window.showInfo undefined - warn, без click и без showInfo', () => {
    delete (window as unknown as { showInfo?: IShowInfoMock }).showInfo;
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const popup = createPopup('B');
    const closeSpy = jest.fn();
    popup.querySelector('.popup-close')?.addEventListener('click', closeSpy);

    refreshOpenPopup();

    expect(warn).toHaveBeenCalled();
    expect(closeSpy).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  test('попап B открыт - закрывает и переоткрывает через showInfo(B)', () => {
    const popup = createPopup('B');
    const closeSpy = jest.fn();
    popup.querySelector('.popup-close')?.addEventListener('click', closeSpy);

    refreshOpenPopup();

    expect(closeSpy).toHaveBeenCalledTimes(1);
    expect(showInfoMock).toHaveBeenCalledTimes(1);
    expect(showInfoMock).toHaveBeenCalledWith('B');
  });
});
