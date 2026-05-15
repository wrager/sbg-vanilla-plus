import { installStarCenterButton, uninstallStarCenterButton } from './starCenterButton';
import { clearStarCenter, getStarCenter, getStarCenterGuid, setStarCenter } from './starCenter';
import { findLayerByName, getOlMap } from '../../core/olMap';
import type { IOlFeature, IOlLayer, IOlVectorSource } from '../../core/olMap';

const TOGGLE_CLASS = 'svp-star-center-btn';

jest.mock('../../core/olMap', () => ({
  getOlMap: jest.fn(() =>
    Promise.resolve({
      getLayers: () => ({ getArray: () => [] }),
    }),
  ),
  findLayerByName: jest.fn(() => null),
}));

const findLayerByNameMock = jest.mocked(findLayerByName);
const getOlMapMock = jest.mocked(getOlMap);

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
  // Восстанавливаем дефолтный мок findLayerByName — null (layer недоступен).
  findLayerByNameMock.mockReturnValue(null);
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
    setStarCenter('p1', 'Альфа');
    const popup = createPopupDom('p1');
    installStarCenterButton();
    expect(getToggle(popup)?.classList.contains('is-active')).toBe(true);
    expect(getToggle(popup)?.getAttribute('aria-pressed')).toBe('true');
  });

  test('центр есть на другой точке: toggle без is-active', () => {
    setStarCenter('other', 'Другая');
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
    setStarCenter('p1', 'Альфа');
    const popup = createPopupDom('p1');
    installStarCenterButton();
    getToggle(popup)?.click();
    await flushMicrotasks();
    expect(getStarCenter()).toBeNull();
    expect(getToggle(popup)?.classList.contains('is-active')).toBe(false);
  });

  test('центр на другой точке → переназначает на текущую', async () => {
    setStarCenter('other', 'Другая');
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
    setStarCenter('p1', 'Альфа');
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

describe('starCenterButton — getPointName (извлечение имени точки из feature)', () => {
  function makeFeatureWithGet(id: string, props: Record<string, unknown>): IOlFeature {
    return {
      getId: () => id,
      getGeometry: () => ({ getCoordinates: () => [0, 0] }),
      setId: () => {},
      setStyle: () => {},
      get(key: string) {
        return props[key];
      },
      getProperties() {
        return props;
      },
    };
  }

  function makeFeatureWithPropsOnly(id: string, props: Record<string, unknown>): IOlFeature {
    return {
      getId: () => id,
      getGeometry: () => ({ getCoordinates: () => [0, 0] }),
      setId: () => {},
      setStyle: () => {},
      // get() отсутствует — должен сработать fallback на getProperties().
      getProperties() {
        return props;
      },
    };
  }

  function makeLayer(features: IOlFeature[]): IOlLayer {
    const source: IOlVectorSource = {
      getFeatures: () => features,
      addFeature: () => {},
      clear: () => {},
      on: () => {},
      un: () => {},
    };
    return {
      get: () => 'points',
      getSource: () => source,
    };
  }

  function getLastToastMessage(): string {
    const calls = showToastMock.mock.calls as unknown[][];
    if (calls.length === 0) return '';
    const last = calls[calls.length - 1];
    const [first] = last;
    return typeof first === 'string' ? first : '';
  }

  // 9.D all-pass: feature.get('title') → строка.
  test('имя через feature.get(title) попадает в toast', async () => {
    findLayerByNameMock.mockReturnValue(makeLayer([makeFeatureWithGet('p1', { title: 'Alpha' })]));
    const popup = createPopupDom('p1');
    installStarCenterButton();
    getToggle(popup)?.click();
    await flushMicrotasks();
    expect(getLastToastMessage()).toContain('"Alpha"');
  });

  // 9.D FALSE на title → переход к name.
  test('title отсутствует — имя через feature.get(name)', async () => {
    findLayerByNameMock.mockReturnValue(makeLayer([makeFeatureWithGet('p1', { name: 'Beta' })]));
    const popup = createPopupDom('p1');
    installStarCenterButton();
    getToggle(popup)?.click();
    await flushMicrotasks();
    expect(getLastToastMessage()).toContain('"Beta"');
  });

  // 9.D: label — последний вариант.
  test('title/name отсутствуют — имя через feature.get(label)', async () => {
    findLayerByNameMock.mockReturnValue(makeLayer([makeFeatureWithGet('p1', { label: 'Gamma' })]));
    const popup = createPopupDom('p1');
    installStarCenterButton();
    getToggle(popup)?.click();
    await flushMicrotasks();
    expect(getLastToastMessage()).toContain('"Gamma"');
  });

  // 9.E FALSE: нет get() → fallback на getProperties().
  test('feature без get() — имя через getProperties()[title]', async () => {
    findLayerByNameMock.mockReturnValue(
      makeLayer([makeFeatureWithPropsOnly('p1', { title: 'Delta' })]),
    );
    const popup = createPopupDom('p1');
    installStarCenterButton();
    getToggle(popup)?.click();
    await flushMicrotasks();
    expect(getLastToastMessage()).toContain('"Delta"');
  });

  // 9.D.1 FALSE (undefined) на title, но есть name в getProperties.
  test('get(title)=undefined и getProperties[name]=Epsilon — имя через getProperties', async () => {
    const feature: IOlFeature = {
      getId: () => 'p1',
      getGeometry: () => ({ getCoordinates: () => [0, 0] }),
      setId: () => {},
      setStyle: () => {},
      get: () => undefined,
      getProperties: () => ({ name: 'Epsilon' }),
    };
    findLayerByNameMock.mockReturnValue(makeLayer([feature]));
    const popup = createPopupDom('p1');
    installStarCenterButton();
    getToggle(popup)?.click();
    await flushMicrotasks();
    expect(getLastToastMessage()).toContain('"Epsilon"');
  });

  // 9.D.2 FALSE: пустая строка → переход к name.
  test('get(title) = "" — переходим к следующему candidateKey', async () => {
    findLayerByNameMock.mockReturnValue(
      makeLayer([makeFeatureWithGet('p1', { title: '', name: 'Zeta' })]),
    );
    const popup = createPopupDom('p1');
    installStarCenterButton();
    getToggle(popup)?.click();
    await flushMicrotasks();
    expect(getLastToastMessage()).toContain('"Zeta"');
  });

  // 9.E FALSE: props null.
  test('feature без title/name/label и без getProperties — toast без имени', async () => {
    const feature: IOlFeature = {
      getId: () => 'p1',
      getGeometry: () => ({ getCoordinates: () => [0, 0] }),
      setId: () => {},
      setStyle: () => {},
    };
    findLayerByNameMock.mockReturnValue(makeLayer([feature]));
    const popup = createPopupDom('p1');
    installStarCenterButton();
    getToggle(popup)?.click();
    await flushMicrotasks();
    expect(getLastToastMessage()).toContain('selected as star center for drawing');
    expect(getLastToastMessage()).not.toContain('"');
  });

  // 9.C TRUE: feature с другим GUID в source — не матчится, пустая строка.
  test('feature с matching GUID не найдена среди features — toast без имени', async () => {
    findLayerByNameMock.mockReturnValue(
      makeLayer([makeFeatureWithGet('other', { title: 'Other' })]),
    );
    const popup = createPopupDom('p1');
    installStarCenterButton();
    getToggle(popup)?.click();
    await flushMicrotasks();
    expect(getLastToastMessage()).not.toContain('"');
  });

  // 9.B TRUE: layer найден, но source = null.
  test('layer без source — toast без имени', async () => {
    findLayerByNameMock.mockReturnValue({
      get: () => 'points',
      getSource: () => null,
    });
    const popup = createPopupDom('p1');
    installStarCenterButton();
    getToggle(popup)?.click();
    await flushMicrotasks();
    expect(getLastToastMessage()).not.toContain('"');
  });

  // 9.A catch: getOlMap reject → warn + пустая строка.
  test('getOlMap reject — warn, toast без имени', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    getOlMapMock.mockRejectedValueOnce(new Error('no map'));
    const popup = createPopupDom('p1');
    installStarCenterButton();
    getToggle(popup)?.click();
    await flushMicrotasks();
    expect(warn).toHaveBeenCalled();
    expect(getLastToastMessage()).not.toContain('"');
    warn.mockRestore();
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
    setStarCenter('A', 'Alpha');
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
    setStarCenter('A', 'Alpha');
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
    setStarCenter('A', 'Alpha');
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
    setStarCenter('A', 'Alpha');
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
