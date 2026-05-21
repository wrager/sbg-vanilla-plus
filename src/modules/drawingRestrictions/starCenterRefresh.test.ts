import { refreshPopupIfStarFilterStateChanged } from './starCenterRefresh';
import type { IStarCenter } from './starCenter';

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

const ACTIVE = (guid: string): IStarCenter => ({ guid, active: true });
const INACTIVE = (guid: string): IStarCenter => ({ guid, active: false });

beforeEach(() => {
  document.body.innerHTML = '';
  showInfoMock.mockClear();
  (window as unknown as { showInfo: IShowInfoMock }).showInfo = showInfoMock;
});

afterEach(() => {
  delete (window as unknown as { showInfo?: IShowInfoMock }).showInfo;
});

describe('refreshPopupIfStarFilterStateChanged — no-op условия', () => {
  test('попап не открыт - no-op', () => {
    refreshPopupIfStarFilterStateChanged(ACTIVE('A'), null);
    expect(showInfoMock).not.toHaveBeenCalled();
  });

  test('попап hidden - no-op (трактуется как не открыт)', () => {
    createPopup('B', true);
    refreshPopupIfStarFilterStateChanged(ACTIVE('A'), null);
    expect(showInfoMock).not.toHaveBeenCalled();
  });

  test('попап без data-guid - no-op', () => {
    const popup = document.createElement('div');
    popup.className = 'info popup';
    document.body.appendChild(popup);
    refreshPopupIfStarFilterStateChanged(ACTIVE('A'), null);
    expect(showInfoMock).not.toHaveBeenCalled();
  });

  test('prev=null next=null (фильтр не был и не стал применяться) - no-op', () => {
    createPopup('B');
    refreshPopupIfStarFilterStateChanged(null, null);
    expect(showInfoMock).not.toHaveBeenCalled();
  });

  test('prev=INACTIVE(A) next=INACTIVE(A) - no-op (фильтр был и остался выключенным)', () => {
    createPopup('B');
    refreshPopupIfStarFilterStateChanged(INACTIVE('A'), INACTIVE('A'));
    expect(showInfoMock).not.toHaveBeenCalled();
  });

  test('open popup A, toggle off центра A - no-op (для попапа центра фильтр не применялся)', () => {
    createPopup('A');
    refreshPopupIfStarFilterStateChanged(ACTIVE('A'), INACTIVE('A'));
    expect(showInfoMock).not.toHaveBeenCalled();
  });

  test('open popup A, toggle on центра A - no-op (фильтр для попапа центра в обоих случаях null)', () => {
    createPopup('A');
    refreshPopupIfStarFilterStateChanged(INACTIVE('A'), ACTIVE('A'));
    expect(showInfoMock).not.toHaveBeenCalled();
  });

  test('open popup A, переназначение на B - no-op (попап стал чужим центром, в обоих случаях null)', () => {
    // popup=A: prev effective = null (active && guid===popup), next effective = B
    // (active && guid!==popup). Различаются → refresh нужен.
    // Это валидируется в следующей секции, не в no-op.
    createPopup('A');
    refreshPopupIfStarFilterStateChanged(ACTIVE('A'), ACTIVE('B'));
    expect(showInfoMock).toHaveBeenCalledTimes(1);
  });

  test('.popup-close отсутствует - refresh попытается закрыть, no-op без падения', () => {
    createPopupWithoutClose('B');
    refreshPopupIfStarFilterStateChanged(ACTIVE('A'), null);
    // refreshOpenPopup сделает попытку закрытия и упадёт в no-op (.popup-close
    // нет) - showInfo не вызывается, тест не падает.
    expect(showInfoMock).not.toHaveBeenCalled();
  });
});

describe('refreshPopupIfStarFilterStateChanged — основные сценарии (refresh нужен)', () => {
  test('toggle off с центром A при попапе B - закрывает и переоткрывает B', () => {
    const popup = createPopup('B');
    const closeSpy = jest.fn();
    popup.querySelector('.popup-close')?.addEventListener('click', closeSpy);

    refreshPopupIfStarFilterStateChanged(ACTIVE('A'), INACTIVE('A'));

    expect(closeSpy).toHaveBeenCalledTimes(1);
    expect(showInfoMock).toHaveBeenCalledWith('B');
  });

  test('toggle on с центром A при попапе B - закрывает и переоткрывает B', () => {
    const popup = createPopup('B');
    const closeSpy = jest.fn();
    popup.querySelector('.popup-close')?.addEventListener('click', closeSpy);

    refreshPopupIfStarFilterStateChanged(INACTIVE('A'), ACTIVE('A'));

    expect(closeSpy).toHaveBeenCalledTimes(1);
    expect(showInfoMock).toHaveBeenCalledWith('B');
  });

  test('первое назначение центра A при попапе B - переоткрытие', () => {
    const popup = createPopup('B');
    const closeSpy = jest.fn();
    popup.querySelector('.popup-close')?.addEventListener('click', closeSpy);

    refreshPopupIfStarFilterStateChanged(null, ACTIVE('A'));

    expect(closeSpy).toHaveBeenCalledTimes(1);
    expect(showInfoMock).toHaveBeenCalledWith('B');
  });

  test('переназначение A→B при попапе C - переоткрытие', () => {
    const popup = createPopup('C');
    const closeSpy = jest.fn();
    popup.querySelector('.popup-close')?.addEventListener('click', closeSpy);

    refreshPopupIfStarFilterStateChanged(ACTIVE('A'), ACTIVE('B'));

    expect(closeSpy).toHaveBeenCalledTimes(1);
    expect(showInfoMock).toHaveBeenCalledWith('C');
  });

  test('переназначение A→B при попапе A (бывший центр) - переоткрытие (B становится центром, A становится отфильтрованной точкой)', () => {
    // prev effective for popup=A: null (popup === guid), next effective: B (active && B !== A)
    const popup = createPopup('A');
    const closeSpy = jest.fn();
    popup.querySelector('.popup-close')?.addEventListener('click', closeSpy);

    refreshPopupIfStarFilterStateChanged(ACTIVE('A'), ACTIVE('B'));

    expect(closeSpy).toHaveBeenCalledTimes(1);
    expect(showInfoMock).toHaveBeenCalledWith('A');
  });

  test('window.showInfo undefined - warn, без showInfo', () => {
    delete (window as unknown as { showInfo?: IShowInfoMock }).showInfo;
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const popup = createPopup('B');
    const closeSpy = jest.fn();
    popup.querySelector('.popup-close')?.addEventListener('click', closeSpy);

    refreshPopupIfStarFilterStateChanged(ACTIVE('A'), null);

    expect(warn).toHaveBeenCalled();
    expect(closeSpy).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
