import { refreshPopupIfStarFilterWasActive } from './starCenterRefresh';

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

function createPopupWithoutClose(guid: string): HTMLElement {
  const popup = document.createElement('div');
  popup.className = 'info popup';
  popup.dataset.guid = guid;
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

describe('refreshPopupIfStarFilterWasActive', () => {
  test('center=null - no-op (фильтр звезды не был активен)', () => {
    createPopup('B');
    refreshPopupIfStarFilterWasActive(null);
    expect(showInfoMock).not.toHaveBeenCalled();
  });

  test('попап не открыт - no-op', () => {
    refreshPopupIfStarFilterWasActive('A');
    expect(showInfoMock).not.toHaveBeenCalled();
  });

  test('попап hidden - no-op (трактуется как не открыт)', () => {
    createPopup('B', true);
    refreshPopupIfStarFilterWasActive('A');
    expect(showInfoMock).not.toHaveBeenCalled();
  });

  test('попап без data-guid - no-op', () => {
    const popup = document.createElement('div');
    popup.className = 'info popup';
    document.body.appendChild(popup);
    refreshPopupIfStarFilterWasActive('A');
    expect(showInfoMock).not.toHaveBeenCalled();
  });

  test('popupGuid === centerBeforeChange - no-op (для попапа центра keepByStar не применялся)', () => {
    createPopup('A');
    refreshPopupIfStarFilterWasActive('A');
    expect(showInfoMock).not.toHaveBeenCalled();
  });

  test('.popup-close отсутствует - no-op (закрытие невозможно)', () => {
    createPopupWithoutClose('B');
    refreshPopupIfStarFilterWasActive('A');
    expect(showInfoMock).not.toHaveBeenCalled();
  });

  test('window.showInfo undefined - warn, без click и без showInfo', () => {
    delete (window as unknown as { showInfo?: IShowInfoMock }).showInfo;
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const popup = createPopup('B');
    const closeSpy = jest.fn();
    popup.querySelector('.popup-close')?.addEventListener('click', closeSpy);

    refreshPopupIfStarFilterWasActive('A');

    expect(warn).toHaveBeenCalled();
    expect(closeSpy).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  test('основной сценарий: popup B открыт, был center A - закрытие + showInfo(B)', () => {
    const popup = createPopup('B');
    const closeSpy = jest.fn();
    popup.querySelector('.popup-close')?.addEventListener('click', closeSpy);

    refreshPopupIfStarFilterWasActive('A');

    expect(closeSpy).toHaveBeenCalledTimes(1);
    expect(showInfoMock).toHaveBeenCalledTimes(1);
    expect(showInfoMock).toHaveBeenCalledWith('B');
  });
});
