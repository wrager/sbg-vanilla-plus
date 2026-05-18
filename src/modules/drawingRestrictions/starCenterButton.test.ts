import { installStarCenterButton, uninstallStarCenterButton } from './starCenterButton';
import { clearStarCenter, getStarCenter, getStarCenterGuid, setStarCenter } from './starCenter';

const TOGGLE_CLASS = 'svp-star-center-btn';

const showToastMock = jest.fn();
jest.mock('../../core/toast', () => ({
  showToast: (...args: unknown[]) => {
    showToastMock(...args);
  },
}));

function createPopupDom(guid: string | null, hidden = false): HTMLElement {
  const popup = document.createElement('div');
  popup.className = hidden ? 'info popup hidden' : 'info popup';
  if (guid !== null) popup.dataset.guid = guid;
  const buttons = document.createElement('div');
  buttons.className = 'i-buttons';
  popup.appendChild(buttons);
  document.body.appendChild(popup);
  return popup;
}

function getToggle(popup: HTMLElement): HTMLButtonElement | null {
  return popup.querySelector<HTMLButtonElement>(`.${TOGGLE_CLASS}`);
}

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
  }
}

beforeEach(() => {
  localStorage.clear();
  clearStarCenter();
  localStorage.clear();
  showToastMock.mockClear();
});

afterEach(() => {
  uninstallStarCenterButton();
  document.body.innerHTML = '';
  localStorage.clear();
});

describe('starCenterButton — базовая инъекция', () => {
  test('toggle появляется в открытом попапе', () => {
    const popup = createPopupDom('p1');
    installStarCenterButton();
    expect(getToggle(popup)).not.toBeNull();
  });

  test('кнопка вставляется в .i-buttons', () => {
    const popup = createPopupDom('p1');
    installStarCenterButton();
    const buttons = popup.querySelector('.i-buttons');
    expect(buttons?.querySelector(`.${TOGGLE_CLASS}`)).not.toBeNull();
  });
});

describe('starCenterButton — состояние', () => {
  test('центра нет: toggle без is-active', () => {
    const popup = createPopupDom('p1');
    installStarCenterButton();
    expect(getToggle(popup)?.classList.contains('is-active')).toBe(false);
  });

  test('текущая точка = центр: toggle is-active', () => {
    setStarCenter('p1');
    const popup = createPopupDom('p1');
    installStarCenterButton();
    expect(getToggle(popup)?.classList.contains('is-active')).toBe(true);
    expect(getToggle(popup)?.getAttribute('aria-pressed')).toBe('true');
  });

  test('центр есть на другой точке: toggle без is-active', () => {
    setStarCenter('other');
    const popup = createPopupDom('p1');
    installStarCenterButton();
    expect(getToggle(popup)?.classList.contains('is-active')).toBe(false);
  });
});

describe('starCenterButton — клики toggle', () => {
  test('центра нет → назначает текущую точку центром', async () => {
    const popup = createPopupDom('p1');
    installStarCenterButton();
    getToggle(popup)?.click();
    await flushMicrotasks();
    expect(getStarCenterGuid()).toBe('p1');
    expect(getToggle(popup)?.classList.contains('is-active')).toBe(true);
  });

  test('назначение показывает toast с формулировкой CUI', async () => {
    const popup = createPopupDom('p1');
    installStarCenterButton();
    getToggle(popup)?.click();
    await flushMicrotasks();
    expect(showToastMock).toHaveBeenCalled();
    const messages = showToastMock.mock.calls.map((call: unknown[]) => {
      const [first] = call;
      return typeof first === 'string' ? first : '';
    });
    expect(
      messages.some((message) => message.includes('selected as star center for drawing')),
    ).toBe(true);
  });

  test('это центр → снимает центр', async () => {
    setStarCenter('p1');
    const popup = createPopupDom('p1');
    installStarCenterButton();
    getToggle(popup)?.click();
    await flushMicrotasks();
    expect(getStarCenter()).toBeNull();
    expect(getToggle(popup)?.classList.contains('is-active')).toBe(false);
  });

  test('центр на другой точке → переназначает на текущую', async () => {
    setStarCenter('other');
    const popup = createPopupDom('p1');
    installStarCenterButton();
    getToggle(popup)?.click();
    await flushMicrotasks();
    expect(getStarCenterGuid()).toBe('p1');
    expect(getToggle(popup)?.classList.contains('is-active')).toBe(true);
  });
});

describe('starCenterButton — реактивность', () => {
  test('смена data-guid пересчитывает состояние', async () => {
    setStarCenter('p1');
    const popup = createPopupDom('p2');
    installStarCenterButton();
    expect(getToggle(popup)?.classList.contains('is-active')).toBe(false);

    popup.dataset.guid = 'p1';
    await flushMicrotasks();
    expect(getToggle(popup)?.classList.contains('is-active')).toBe(true);
  });

  test('uninstall удаляет кнопку и отключает observer', async () => {
    const popup = createPopupDom('p1');
    installStarCenterButton();
    uninstallStarCenterButton();
    expect(getToggle(popup)).toBeNull();

    popup.dataset.guid = 'p2';
    await flushMicrotasks();
    expect(getToggle(popup)).toBeNull();
  });
});

describe('starCenterButton — назначение центра целиком синхронно', () => {
  // После убирания имени точки из IStarCenter и тостов клик toggle полностью
  // синхронен: ни getOlMap, ни getPointName, ни асинхронных race-чеков. LS
  // содержит только guid; имя не подтягивается и не пишется.
  test('LS после назначения содержит guid, без поля name', () => {
    const popup = createPopupDom('p1');
    installStarCenterButton();
    getToggle(popup)?.click();
    const star = getStarCenter();
    expect(star?.guid).toBe('p1');
    expect(star).not.toHaveProperty('name');
  });

  test('toast при назначении - общая формулировка без интерполяции имени', () => {
    const popup = createPopupDom('p1');
    installStarCenterButton();
    getToggle(popup)?.click();
    const messages = showToastMock.mock.calls.map((call: unknown[]) => {
      const [first] = call;
      return typeof first === 'string' ? first : '';
    });
    expect(
      messages.some((message) => message.includes('selected as star center for drawing')),
    ).toBe(true);
    // Имя в toast не появляется (нет кавычек интерполяции).
    expect(messages.every((message) => !message.includes('"'))).toBe(true);
  });
});

describe('starCenterButton — переоткрытие попапа при переназначении центра', () => {
  function createPopupWithClose(guid: string): HTMLElement {
    const popup = createPopupDom(guid);
    const closeButton = document.createElement('button');
    closeButton.className = 'popup-close';
    popup.appendChild(closeButton);
    return popup;
  }

  const showInfoMock = jest.fn();

  beforeEach(() => {
    showInfoMock.mockClear();
    (window as unknown as { showInfo: typeof showInfoMock }).showInfo = showInfoMock;
  });

  afterEach(() => {
    delete (window as unknown as { showInfo?: typeof showInfoMock }).showInfo;
  });

  // Основной сценарий: переназначение центра с точки A на текущий попап B.
  test('центр был на другой точке → клик toggle закрывает и переоткрывает попап через window.showInfo', async () => {
    setStarCenter('A');
    const popup = createPopupWithClose('B');
    const closeSpy = jest.fn();
    popup.querySelector('.popup-close')?.addEventListener('click', closeSpy);

    installStarCenterButton();
    getToggle(popup)?.click();
    await flushMicrotasks();

    expect(getStarCenterGuid()).toBe('B');
    expect(closeSpy).toHaveBeenCalledTimes(1);
    expect(showInfoMock).toHaveBeenCalledTimes(1);
    expect(showInfoMock).toHaveBeenCalledWith('B');
  });

  // Назначение без предыдущего центра — counter уже был [N] (фильтр не работал),
  // переоткрытие не нужно.
  test('центра не было → клик toggle НЕ переоткрывает попап', async () => {
    const popup = createPopupWithClose('B');
    const closeSpy = jest.fn();
    popup.querySelector('.popup-close')?.addEventListener('click', closeSpy);

    installStarCenterButton();
    getToggle(popup)?.click();
    await flushMicrotasks();

    expect(getStarCenterGuid()).toBe('B');
    expect(closeSpy).not.toHaveBeenCalled();
    expect(showInfoMock).not.toHaveBeenCalled();
  });

  // Снятие центра — counter был [N] (попап центра), после снятия тоже [N],
  // переоткрытие не нужно.
  test('снятие центра через тот же попап — НЕ переоткрывает попап', async () => {
    setStarCenter('A');
    const popup = createPopupWithClose('A');
    const closeSpy = jest.fn();
    popup.querySelector('.popup-close')?.addEventListener('click', closeSpy);

    installStarCenterButton();
    getToggle(popup)?.click();
    await flushMicrotasks();

    expect(getStarCenter()).toBeNull();
    expect(closeSpy).not.toHaveBeenCalled();
    expect(showInfoMock).not.toHaveBeenCalled();
  });

  // Graceful fallback: нет .popup-close → выход до click/showInfo, центр
  // всё равно назначен.
  test('нет .popup-close в DOM — не бросает, центр назначен, showInfo не вызван', async () => {
    setStarCenter('A');
    const popup = createPopupDom('B'); // без .popup-close

    installStarCenterButton();
    getToggle(popup)?.click();
    await flushMicrotasks();

    expect(getStarCenterGuid()).toBe('B');
    expect(showInfoMock).not.toHaveBeenCalled();
  });

  // window.showInfo недоступен (gameScriptPatcher не применился) — попап
  // не закрывается (иначе пользователь потеряет контекст без переоткрытия).
  test('window.showInfo недоступна — попап остаётся открытым, центр назначен', async () => {
    delete (window as unknown as { showInfo?: typeof showInfoMock }).showInfo;
    setStarCenter('A');
    const popup = createPopupWithClose('B');
    const closeSpy = jest.fn();
    popup.querySelector('.popup-close')?.addEventListener('click', closeSpy);

    installStarCenterButton();
    getToggle(popup)?.click();
    await flushMicrotasks();

    expect(getStarCenterGuid()).toBe('B');
    expect(closeSpy).not.toHaveBeenCalled();
  });
});

describe('starCenterButton — идемпотентность async install', () => {
  // Ветка через waitForElement: попап появляется ПОСЛЕ install (а не до).
  // Без флага pendingInstall второй install прошёл бы guard (observer=null),
  // оба колбэка отвалились бы по generation — кнопка не появилась бы вовсе.
  test('повторный install до резолва waitForElement — no-op через pendingInstall', async () => {
    installStarCenterButton();
    installStarCenterButton();

    // Попап появляется только теперь. Оба waitForElement резолвятся асинхронно.
    const popup = createPopupDom('p1');
    await flushMicrotasks();

    const toggles = popup.querySelectorAll(`.${TOGGLE_CLASS}`);
    expect(toggles.length).toBe(1);
  });

  test('install → uninstall → install до появления попапа — корректно инициализируется', async () => {
    installStarCenterButton();
    uninstallStarCenterButton();
    installStarCenterButton();

    const popup = createPopupDom('p1');
    await flushMicrotasks();

    const toggles = popup.querySelectorAll(`.${TOGGLE_CLASS}`);
    expect(toggles.length).toBe(1);
  });
});
