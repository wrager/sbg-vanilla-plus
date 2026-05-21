import {
  TOGGLE_CLASS,
  hasRelevantMutations,
  installStarCenterButton,
  uninstallStarCenterButton,
} from './starCenterButton';
import {
  clearStarCenter,
  getStarCenter,
  getStarCenterGuid,
  setStarCenter,
  setStarCenterActive,
} from './starCenter';
import { INVENTORY_CACHE_KEY } from '../../core/inventoryCache';
import { ITEM_TYPE_REFERENCE } from '../../core/gameConstants';

const showToastMock = jest.fn();
jest.mock('../../core/toast', () => ({
  showToast: (...args: unknown[]) => {
    showToastMock(...args);
  },
}));

const getPointTitleByGuidMock = jest.fn<string | null, [string]>();
jest.mock('./pointTitle', () => ({
  getPointTitleByGuid: (guid: string): string | null => getPointTitleByGuidMock(guid),
}));

/**
 * Кладёт в inventory-cache стопки ключей с lock-битом (`f & 0b10`) для
 * переданных точек. `buildLockedPointGuids` читает свежий кэш при каждом клике,
 * поэтому через этот helper тест имитирует "точка с замочком".
 */
function setLockedPoints(pointGuids: string[]): void {
  const cache = pointGuids.map((guid, index) => ({
    g: `stack-${guid}-${index}`,
    t: ITEM_TYPE_REFERENCE,
    l: guid,
    a: 1,
    f: 0b10,
  }));
  localStorage.setItem(INVENTORY_CACHE_KEY, JSON.stringify(cache));
}

function toastMessages(): string[] {
  return showToastMock.mock.calls.map((call: unknown[]) => {
    const [first] = call;
    return typeof first === 'string' ? first : '';
  });
}

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

function createPopupWithClose(guid: string): HTMLElement {
  const popup = createPopupDom(guid);
  const closeButton = document.createElement('button');
  closeButton.className = 'popup-close';
  popup.appendChild(closeButton);
  return popup;
}

const showInfoMock = jest.fn();

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
  showToastMock.mockClear();
  getPointTitleByGuidMock.mockReset();
  getPointTitleByGuidMock.mockReturnValue(null); // default: имя не известно
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

describe('starCenterButton — is-active отражает active=true И popup на центре', () => {
  test('центра нет: toggle без is-active', () => {
    const popup = createPopupDom('p1');
    installStarCenterButton();
    expect(getToggle(popup)?.classList.contains('is-active')).toBe(false);
  });

  test('текущая точка = центр, режим включён: toggle is-active', () => {
    setStarCenter('p1'); // auto-active
    const popup = createPopupDom('p1');
    installStarCenterButton();
    expect(getToggle(popup)?.classList.contains('is-active')).toBe(true);
    expect(getToggle(popup)?.getAttribute('aria-pressed')).toBe('true');
  });

  test('текущая точка = центр, режим выключен: toggle без is-active', () => {
    setStarCenter('p1');
    setStarCenterActive(false);
    const popup = createPopupDom('p1');
    installStarCenterButton();
    expect(getToggle(popup)?.classList.contains('is-active')).toBe(false);
    expect(getToggle(popup)?.getAttribute('aria-pressed')).toBe('false');
  });

  test('центр есть на другой точке: toggle без is-active', () => {
    setStarCenter('other');
    const popup = createPopupDom('p1');
    installStarCenterButton();
    expect(getToggle(popup)?.classList.contains('is-active')).toBe(false);
  });
});

describe('starCenterButton — клики (трёхветочная toggle-логика)', () => {
  test('центра нет → назначает текущую точку центром и активирует режим', async () => {
    const popup = createPopupDom('p1');
    installStarCenterButton();
    getToggle(popup)?.click();
    await flushMicrotasks();
    expect(getStarCenter()).toEqual({ guid: 'p1', active: true });
    expect(getToggle(popup)?.classList.contains('is-active')).toBe(true);
  });

  test('назначение показывает toast "Point selected as star center"', async () => {
    const popup = createPopupDom('p1');
    installStarCenterButton();
    getToggle(popup)?.click();
    await flushMicrotasks();
    expect(
      toastMessages().some((m) => m.includes('selected as star center for drawing')),
    ).toBe(true);
  });

  test('попап на активном центре → toggle off (guid сохраняется, active=false)', async () => {
    setStarCenter('p1');
    const popup = createPopupDom('p1');
    installStarCenterButton();
    getToggle(popup)?.click();
    await flushMicrotasks();
    expect(getStarCenter()).toEqual({ guid: 'p1', active: false });
    expect(getToggle(popup)?.classList.contains('is-active')).toBe(false);
    expect(toastMessages().some((m) => m.includes('Star mode disabled'))).toBe(true);
  });

  test('попап на выключенном центре → toggle on (active=true)', async () => {
    setStarCenter('p1');
    setStarCenterActive(false);
    const popup = createPopupDom('p1');
    installStarCenterButton();
    getToggle(popup)?.click();
    await flushMicrotasks();
    expect(getStarCenter()).toEqual({ guid: 'p1', active: true });
    expect(getToggle(popup)?.classList.contains('is-active')).toBe(true);
    expect(toastMessages().some((m) => m.includes('Star mode enabled'))).toBe(true);
  });

  test('центр на другой точке → переназначает на текущую (auto-active)', async () => {
    setStarCenter('other');
    const popup = createPopupDom('p1');
    installStarCenterButton();
    getToggle(popup)?.click();
    await flushMicrotasks();
    expect(getStarCenter()).toEqual({ guid: 'p1', active: true });
    expect(getToggle(popup)?.classList.contains('is-active')).toBe(true);
    expect(
      toastMessages().some((m) => m.includes('selected as star center for drawing')),
    ).toBe(true);
  });

  test('центр на другой точке + режим выключен → переназначает и включает', async () => {
    setStarCenter('other');
    setStarCenterActive(false);
    const popup = createPopupDom('p1');
    installStarCenterButton();
    getToggle(popup)?.click();
    await flushMicrotasks();
    expect(getStarCenter()).toEqual({ guid: 'p1', active: true });
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

  test('внешнее изменение active (setStarCenterActive) перерисовывает is-active', async () => {
    setStarCenter('p1');
    const popup = createPopupDom('p1');
    installStarCenterButton();
    expect(getToggle(popup)?.classList.contains('is-active')).toBe(true);

    setStarCenterActive(false);
    await flushMicrotasks();
    expect(getToggle(popup)?.classList.contains('is-active')).toBe(false);
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

describe('starCenterButton — формат LS после назначения', () => {
  test('LS содержит guid + active=true, без поля name', () => {
    const popup = createPopupDom('p1');
    installStarCenterButton();
    getToggle(popup)?.click();
    expect(getStarCenter()).toEqual({ guid: 'p1', active: true });
  });
});

describe('starCenterButton — имя точки в тостах (через pointTitle)', () => {
  test('назначение нового центра: имя интерполируется в "..." (стиль CUI)', async () => {
    getPointTitleByGuidMock.mockReturnValue('Alpha');
    const popup = createPopupDom('p1');
    installStarCenterButton();
    getToggle(popup)?.click();
    await flushMicrotasks();
    expect(toastMessages().some((m) => m === 'Point "Alpha" selected as star center for drawing.')).toBe(true);
  });

  test('назначение без известного имени - общий текст без кавычек', async () => {
    getPointTitleByGuidMock.mockReturnValue(null);
    const popup = createPopupDom('p1');
    installStarCenterButton();
    getToggle(popup)?.click();
    await flushMicrotasks();
    expect(toastMessages().some((m) => m === 'Point selected as star center for drawing.')).toBe(
      true,
    );
  });

  test('toggle off в попапе центра: имя в "Star mode disabled: <name>"', async () => {
    getPointTitleByGuidMock.mockReturnValue('Alpha');
    setStarCenter('p1');
    const popup = createPopupDom('p1');
    installStarCenterButton();
    getToggle(popup)?.click();
    await flushMicrotasks();
    expect(toastMessages().some((m) => m === 'Star mode disabled: Alpha')).toBe(true);
  });

  test('toggle on в попапе выключенного центра: имя в "Star mode enabled: <name>"', async () => {
    getPointTitleByGuidMock.mockReturnValue('Alpha');
    setStarCenter('p1');
    setStarCenterActive(false);
    const popup = createPopupDom('p1');
    installStarCenterButton();
    getToggle(popup)?.click();
    await flushMicrotasks();
    expect(toastMessages().some((m) => m === 'Star mode enabled: Alpha')).toBe(true);
  });

  test('toggle off без известного имени - общий текст без имени', async () => {
    getPointTitleByGuidMock.mockReturnValue(null);
    setStarCenter('p1');
    const popup = createPopupDom('p1');
    installStarCenterButton();
    getToggle(popup)?.click();
    await flushMicrotasks();
    expect(toastMessages().some((m) => m === 'Star mode disabled')).toBe(true);
  });
});

describe('starCenterButton — переоткрытие попапа при изменении фильтрации', () => {
  beforeEach(() => {
    showInfoMock.mockClear();
    (window as unknown as { showInfo: typeof showInfoMock }).showInfo = showInfoMock;
  });

  afterEach(() => {
    delete (window as unknown as { showInfo?: typeof showInfoMock }).showInfo;
  });

  // Переназначение с точки A на текущий попап B: для попапа B
  // фильтр звезды менялся (effective был A, стал null) - refresh нужен.
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

  // Назначение без предыдущего центра — для попапа B фильтр и был null
  // (центра не было), и стал null (попап нового центра). Refresh не нужен.
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

  // Toggle off через попап центра: эффективный фильтр для этого попапа
  // и был null (попап центра), и остался null (active=false). Refresh не нужен.
  test('toggle off через попап того же центра — НЕ переоткрывает попап', async () => {
    setStarCenter('A');
    const popup = createPopupWithClose('A');
    const closeSpy = jest.fn();
    popup.querySelector('.popup-close')?.addEventListener('click', closeSpy);

    installStarCenterButton();
    getToggle(popup)?.click();
    await flushMicrotasks();

    expect(getStarCenter()).toEqual({ guid: 'A', active: false });
    expect(closeSpy).not.toHaveBeenCalled();
    expect(showInfoMock).not.toHaveBeenCalled();
  });

  // Toggle on через попап выключенного центра: фильтр для попапа центра
  // и был null, и остался null - refresh не нужен.
  test('toggle on через попап того же выключенного центра — НЕ переоткрывает попап', async () => {
    setStarCenter('A');
    setStarCenterActive(false);
    const popup = createPopupWithClose('A');
    const closeSpy = jest.fn();
    popup.querySelector('.popup-close')?.addEventListener('click', closeSpy);

    installStarCenterButton();
    getToggle(popup)?.click();
    await flushMicrotasks();

    expect(getStarCenter()).toEqual({ guid: 'A', active: true });
    expect(closeSpy).not.toHaveBeenCalled();
    expect(showInfoMock).not.toHaveBeenCalled();
  });
});

describe('starCenterButton — попытка назначить locked-точку центром', () => {
  test('safety-net: lock после install (stale cache) - click не назначает + toast', async () => {
    const popup = createPopupDom('p1');
    installStarCenterButton();
    setLockedPoints(['p1']);
    getToggle(popup)?.click();
    await flushMicrotasks();

    expect(getStarCenter()).toBeNull();
    expect(toastMessages().some((m) => m.includes("Locked point can't be a star center"))).toBe(
      true,
    );
  });

  test('safety-net: lock после install не снимает предыдущий центр + toast', async () => {
    setStarCenter('A');
    const popup = createPopupDom('B');
    installStarCenterButton();
    setLockedPoints(['B']);
    getToggle(popup)?.click();
    await flushMicrotasks();

    expect(getStarCenterGuid()).toBe('A');
    expect(toastMessages().some((m) => m.includes("Locked point can't be a star center"))).toBe(
      true,
    );
  });

  // Точка стала locked после того, как уже была центром (legacy install-time
  // clear уже отработал на старте). Клик в попапе центра идёт по ветке
  // toggle off, locked-check НЕ срабатывает (он применяется только в ветке
  // назначения нового центра). Центр выключается, guid сохраняется.
  test('клик в попапе locked-точки, которая является активным центром, выключает режим', async () => {
    const popup = createPopupDom('p1');
    installStarCenterButton();
    setStarCenter('p1');
    setLockedPoints(['p1']);
    getToggle(popup)?.click();
    await flushMicrotasks();

    expect(getStarCenter()).toEqual({ guid: 'p1', active: false });
    expect(toastMessages().some((m) => m.includes('Star mode disabled'))).toBe(true);
    expect(toastMessages().some((m) => m.includes("Locked point can't be a star center"))).toBe(
      false,
    );
  });

  test('locked-точка: toggle всегда enabled, click показывает toast', async () => {
    setLockedPoints(['p1']);
    const popup = createPopupDom('p1');
    installStarCenterButton();

    expect(getToggle(popup)?.disabled).toBe(false);

    getToggle(popup)?.click();
    await flushMicrotasks();

    expect(getStarCenter()).toBeNull();
    expect(toastMessages().some((m) => m.includes("Locked point can't be a star center"))).toBe(
      true,
    );
  });

  test('не-locked точка назначается как раньше', async () => {
    setLockedPoints(['other']);
    const popup = createPopupDom('p1');
    installStarCenterButton();
    getToggle(popup)?.click();
    await flushMicrotasks();

    expect(getStarCenterGuid()).toBe('p1');
    expect(toastMessages().some((m) => m.includes('selected as star center'))).toBe(true);
  });

  // Регрессия: при попытке назначения центра на locked-точку поп ап не
  // переоткрывается. Старый центр не меняется, рисовать с locked всё равно
  // нельзя — лишний close+showInfo проявлялся бы как мерцание попапа.
  describe('переоткрытие попапа в locked-ветке не происходит', () => {
    beforeEach(() => {
      showInfoMock.mockClear();
      (window as unknown as { showInfo: typeof showInfoMock }).showInfo = showInfoMock;
    });

    afterEach(() => {
      delete (window as unknown as { showInfo?: typeof showInfoMock }).showInfo;
    });

    test('центр на не-locked точке, click на locked-точке: центр остаётся, closing/showInfo не вызываются', async () => {
      setStarCenter('A');
      setLockedPoints(['B']);
      const popup = createPopupWithClose('B');
      const closeSpy = jest.fn();
      popup.querySelector('.popup-close')?.addEventListener('click', closeSpy);

      installStarCenterButton();
      getToggle(popup)?.click();
      await flushMicrotasks();

      expect(getStarCenterGuid()).toBe('A');
      expect(closeSpy).not.toHaveBeenCalled();
      expect(showInfoMock).not.toHaveBeenCalled();
    });

    test('первая попытка назначить locked при пустом центре: closing/showInfo не вызываются', async () => {
      setLockedPoints(['p1']);
      const popup = createPopupWithClose('p1');
      const closeSpy = jest.fn();
      popup.querySelector('.popup-close')?.addEventListener('click', closeSpy);

      installStarCenterButton();
      getToggle(popup)?.click();
      await flushMicrotasks();

      expect(getStarCenter()).toBeNull();
      expect(closeSpy).not.toHaveBeenCalled();
      expect(showInfoMock).not.toHaveBeenCalled();
    });
  });
});

describe('starCenterButton — legacy locked center при installStarCenterButton', () => {
  test('центр был на locked-точке - снимается, показывает блок-toast', () => {
    setStarCenter('p1');
    setLockedPoints(['p1']);
    createPopupDom('p2');
    installStarCenterButton();

    expect(getStarCenter()).toBeNull();
    expect(
      toastMessages().some((m) => m.includes('Star center cleared: the point is now locked')),
    ).toBe(true);
  });

  test('центр был на не-locked точке - остаётся, toast не показывается', () => {
    setStarCenter('p1');
    setLockedPoints(['other']);
    createPopupDom('p2');
    installStarCenterButton();

    expect(getStarCenterGuid()).toBe('p1');
    expect(showToastMock).not.toHaveBeenCalled();
  });

  test('центр не назначен - ничего не происходит', () => {
    createPopupDom('p1');
    installStarCenterButton();

    expect(getStarCenter()).toBeNull();
    expect(showToastMock).not.toHaveBeenCalled();
  });

  test('lock встаёт на центр в текущей сессии - центр не снимается автоматически', () => {
    setStarCenter('p1');
    createPopupDom('p2');
    installStarCenterButton();
    setLockedPoints(['p1']);

    expect(getStarCenterGuid()).toBe('p1');
    expect(showToastMock).not.toHaveBeenCalled();
  });
});

describe('starCenterButton — фильтр self-trigger mutations (hasRelevantMutations)', () => {
  function createMutation(target: Element, type: 'attributes' | 'childList'): MutationRecord {
    return {
      type,
      target,
      addedNodes: { length: 0 } as unknown as NodeList,
      removedNodes: { length: 0 } as unknown as NodeList,
      attributeName: type === 'attributes' ? 'class' : null,
      attributeNamespace: null,
      nextSibling: null,
      previousSibling: null,
      oldValue: null,
    };
  }

  test('mutation attribute на toggle - false (self-trigger игнорируется)', () => {
    const toggle = document.createElement('button');
    toggle.className = TOGGLE_CLASS;
    expect(hasRelevantMutations([createMutation(toggle, 'attributes')])).toBe(false);
  });

  test('mutation attribute на другом элементе - true', () => {
    const otherBtn = document.createElement('button');
    expect(hasRelevantMutations([createMutation(otherBtn, 'attributes')])).toBe(true);
  });

  test('mutation childList даже на toggle - true (не self-trigger)', () => {
    const toggle = document.createElement('button');
    toggle.className = TOGGLE_CLASS;
    expect(hasRelevantMutations([createMutation(toggle, 'childList')])).toBe(true);
  });

  test('смесь: только toggle attribute + другие - true (другие relevant)', () => {
    const toggle = document.createElement('button');
    toggle.className = TOGGLE_CLASS;
    const otherDiv = document.createElement('div');
    expect(
      hasRelevantMutations([
        createMutation(toggle, 'attributes'),
        createMutation(otherDiv, 'attributes'),
      ]),
    ).toBe(true);
  });

  test('пустой список - false', () => {
    expect(hasRelevantMutations([])).toBe(false);
  });
});

describe('starCenterButton — идемпотентность async install', () => {
  test('повторный install до резолва waitForElement — no-op через pendingInstall', async () => {
    installStarCenterButton();
    installStarCenterButton();

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
