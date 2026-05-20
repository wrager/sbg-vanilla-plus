import {
  TOGGLE_CLASS,
  hasRelevantMutations,
  installStarCenterButton,
  uninstallStarCenterButton,
} from './starCenterButton';
import { clearStarCenter, getStarCenter, getStarCenterGuid, setStarCenter } from './starCenter';
import { INVENTORY_CACHE_KEY } from '../../core/inventoryCache';
import { ITEM_TYPE_REFERENCE } from '../../core/gameConstants';


const showToastMock = jest.fn();
jest.mock('../../core/toast', () => ({
  showToast: (...args: unknown[]) => {
    showToastMock(...args);
  },
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

describe('starCenterButton — попытка назначить locked-точку центром', () => {
  // Двухслойная защита: (1) UI - toggle.disabled = true в updateButtons для
  // locked-точки, которая не является текущим центром; (2) safety-net в
  // onToggleClick - fresh read inventory-cache при click, чтобы блокировать
  // назначение даже если updateButtons видел stale-кэш locked-точек.

  test('safety-net в onToggleClick: lock после install (stale cache) - click не назначает + toast', async () => {
    // Stale-cache scenario: пользователь открыл попап (cache = empty),
    // установил lock на эту же точку, кнопка остаётся enabled до next open.
    // Click срабатывает - safety-net пересчитывает inventory и блокирует.
    const popup = createPopupDom('p1');
    installStarCenterButton(); // updateButtons: lockedPoints empty, cache = empty
    setLockedPoints(['p1']);   // lock после install, cache stale
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
    setLockedPoints(['B']); // lock после install
    getToggle(popup)?.click();
    await flushMicrotasks();

    expect(getStarCenterGuid()).toBe('A');
    expect(toastMessages().some((m) => m.includes("Locked point can't be a star center"))).toBe(
      true,
    );
  });

  test('клик в попапе locked-точки, который уже является центром, снимает центр как обычно', async () => {
    // p1 стала locked после того, как была назначена центром и после
    // installStarCenterButton (legacy check уже отработал при install и
    // ничего не нашёл). Клик в попапе самой центральной точки снимает центр
    // как обычно (star.guid === guid ветка в onToggleClick).
    const popup = createPopupDom('p1');
    installStarCenterButton(); // legacy check: центра нет - no-op
    setStarCenter('p1');       // назначаем центром после install
    setLockedPoints(['p1']);   // точка становится locked
    getToggle(popup)?.click();
    await flushMicrotasks();

    expect(getStarCenter()).toBeNull();
    expect(toastMessages().some((m) => m.includes('Star center cleared'))).toBe(true);
    expect(toastMessages().some((m) => m.includes("Locked point can't be a star center"))).toBe(
      false,
    );
  });

  test('locked-точка, не центр: toggle disabled с lock-title', () => {
    setLockedPoints(['p1']);
    const popup = createPopupDom('p1');
    installStarCenterButton();

    const toggle = getToggle(popup);
    expect(toggle?.disabled).toBe(true);
    expect(toggle?.title).toBe("Locked point can't be a star center");
    expect(toggle?.classList.contains('is-active')).toBe(false);
  });

  test('locked-точка, которая уже является центром: toggle активен (для снятия)', () => {
    // locked-центр - результат legacy install check race (или ручной правки
    // localStorage). Кнопка остаётся активной, чтобы дать пользователю выход.
    const popup = createPopupDom('p1');
    installStarCenterButton();
    setStarCenter('p1');
    setLockedPoints(['p1']);
    // Триггер пересчёта updateButtons (через STAR_CENTER_CHANGED_EVENT,
    // setLockedPoints сам по себе observer не дёргает).
    document.dispatchEvent(new Event('svp:star-center-changed'));

    const toggle = getToggle(popup);
    expect(toggle?.disabled).toBe(false);
    expect(toggle?.classList.contains('is-active')).toBe(true);
  });

  test('lock поставлен на текущую открытую точку - кнопка сразу disabled', () => {
    // updateButtons делает fresh read inventory-cache при каждом вызове,
    // не кэширует - lock toggle на той же точке (popupGuid не меняется,
    // length JSON inventory-cache не меняется, т.к. игра меняет "f":0 -> "f":2
    // в-place) ловится сразу.
    const popup = createPopupDom('p1');
    installStarCenterButton(); // p1 не locked, button enabled
    expect(getToggle(popup)?.disabled).toBe(false);

    setLockedPoints(['p1']);
    document.dispatchEvent(new Event('svp:star-center-changed')); // triggers updateButtons

    expect(getToggle(popup)?.disabled).toBe(true);
  });

  test('lock снят с текущей открытой точки - кнопка сразу enabled', () => {
    setLockedPoints(['p1']);
    const popup = createPopupDom('p1');
    installStarCenterButton(); // p1 locked, button disabled
    expect(getToggle(popup)?.disabled).toBe(true);

    localStorage.setItem(INVENTORY_CACHE_KEY, '[]');
    document.dispatchEvent(new Event('svp:star-center-changed'));

    expect(getToggle(popup)?.disabled).toBe(false);
  });

  test('смена popupGuid на locked-точку - кнопка disabled', async () => {
    setLockedPoints(['p2']);
    const popup = createPopupDom('p1');
    installStarCenterButton();
    expect(getToggle(popup)?.disabled).toBe(false);

    popup.dataset.guid = 'p2';
    await flushMicrotasks();

    expect(getToggle(popup)?.disabled).toBe(true);
  });

  test('не-locked точка назначается как раньше', async () => {
    setLockedPoints(['other']);
    const popup = createPopupDom('p1');
    installStarCenterButton();
    getToggle(popup)?.click();
    await flushMicrotasks();

    expect(getStarCenterGuid()).toBe('p1');
    expect(toastMessages().some((m) => m.includes('selected as star center'))).toBe(true);
    expect(toastMessages().some((m) => m.includes("Locked point can't be a star center"))).toBe(
      false,
    );
  });

  // Регрессия: при попытке переназначения центра с не-locked точки на locked
  // попап не должен переоткрываться. Старый центр снимается, но обновлять
  // список рисования в попапе locked-точки бессмысленно (рисовать с неё всё
  // равно нельзя), а лишний close+showInfo проявлялся бы как мерцание попапа.
  describe('переоткрытие попапа в locked-ветке не происходит', () => {
    beforeEach(() => {
      showInfoMock.mockClear();
      (window as unknown as { showInfo: typeof showInfoMock }).showInfo = showInfoMock;
    });

    afterEach(() => {
      delete (window as unknown as { showInfo?: typeof showInfoMock }).showInfo;
    });

    test('центр на не-locked точке, click на locked-точке: центр остаётся, закрытие/showInfo не вызываются', async () => {
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

    test('первая попытка назначить locked при пустом центре: закрытие/showInfo не вызываются', async () => {
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
    expect(toastMessages().some((m) => m.includes("Locked point can't be a star center"))).toBe(
      true,
    );
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
});

describe('starCenterButton — фильтр self-trigger mutations (hasRelevantMutations)', () => {
  // Регрессия beta.8: updateButtons менял classList на toggle, Chrome fires
  // BUTTON.class mutation -> observer fires -> updateButtons -> снова mutation
  // -> infinite loop, 100% CPU, зависание страницы.

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
