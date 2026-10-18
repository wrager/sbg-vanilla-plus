import {
  createXpPopupLayer,
  destroyXpPopupLayer,
  showXpPopup,
  XP_POPUP_ANIMATION_MS,
} from './xpPopupLayer';
import { ANIMATION_SAFETY_MARGIN } from '../../core/popupSwipe';

const LAYER_SELECTOR = '.svp-xp-popup-layer';
const POPUP_SELECTOR = '.svp-xp-popup';
const TOP_PANEL_CLASS = 'topleft-container';

function layerElement(): HTMLElement | null {
  return document.querySelector(LAYER_SELECTOR);
}

function popupTexts(): (string | null)[] {
  return Array.from(document.querySelectorAll(POPUP_SELECTOR)).map((node) => node.textContent);
}

/** Подпись единицы опыта из статической разметки игры (refs/game/index.html:74). */
function addXpUnitLabel(unit = 'очк.'): HTMLElement {
  const entry = document.createElement('div');
  entry.className = 'self-info__entry';
  const unitSpan = document.createElement('span');
  unitSpan.setAttribute('data-i18n', 'units.pts-xp');
  unitSpan.textContent = unit;
  entry.appendChild(unitSpan);
  document.body.appendChild(entry);
  return entry;
}

function addTopPanel(bottom: number): HTMLElement {
  const panel = document.createElement('div');
  panel.className = TOP_PANEL_CLASS;
  mockPanelBottom(panel, bottom);
  document.body.appendChild(panel);
  return panel;
}

function mockPanelBottom(panel: HTMLElement, bottom: number): void {
  jest.spyOn(panel, 'getBoundingClientRect').mockReturnValue({
    bottom,
    height: bottom,
    width: 0,
    top: 0,
    left: 0,
    right: 0,
    x: 0,
    y: 0,
    toJSON: () => '',
  });
}

function setVisibility(state: 'visible' | 'hidden'): void {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
}

function endAnimation(element: Element): void {
  element.dispatchEvent(new Event('animationend'));
}

beforeEach(() => {
  jest.useFakeTimers();
  document.body.innerHTML = '';
  localStorage.clear();
  setVisibility('visible');
});

afterEach(() => {
  destroyXpPopupLayer();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('слой', () => {
  test('createXpPopupLayer монтирует слой в body и отдаёт длительность анимации в CSS', () => {
    createXpPopupLayer();

    const layer = layerElement();
    expect(layer).not.toBeNull();
    expect(layer?.parentElement).toBe(document.body);
    expect(layer?.style.getPropertyValue('--svp-xp-popup-duration')).toBe(
      `${XP_POPUP_ANIMATION_MS}ms`,
    );
  });

  test('повторный createXpPopupLayer не создаёт второй слой', () => {
    createXpPopupLayer();
    createXpPopupLayer();

    expect(document.querySelectorAll(LAYER_SELECTOR)).toHaveLength(1);
  });
});

describe('текст значения', () => {
  test('прирост со знаком и единицей', () => {
    createXpPopupLayer();

    showXpPopup(130);

    expect(popupTexts()).toEqual(['+130 xp']);
  });

  test('единица одна на любой язык игры', () => {
    localStorage.setItem('settings', JSON.stringify({ lang: 'ru' }));
    createXpPopupLayer();

    showXpPopup(130);

    expect(popupTexts()).toEqual(['+130 xp']);
  });

  test('игровая подпись единицы опыта на текст не влияет', () => {
    addXpUnitLabel();
    createXpPopupLayer();

    showXpPopup(130);

    expect(popupTexts()).toEqual(['+130 xp']);
  });

  test('отрицательный прирост показывается со своим знаком, не "+-"', () => {
    createXpPopupLayer();

    showXpPopup(-5);

    expect(popupTexts()).toEqual(['-5 xp']);
  });
});

describe('когда попап не создаётся', () => {
  test('нулевой прирост', () => {
    createXpPopupLayer();

    showXpPopup(0);

    expect(document.querySelectorAll(POPUP_SELECTOR)).toHaveLength(0);
  });

  test('слоя нет - модуль выключен', () => {
    expect(() => {
      showXpPopup(130);
    }).not.toThrow();
    expect(document.querySelectorAll(POPUP_SELECTOR)).toHaveLength(0);
  });

  test('вкладка скрыта - анимация всё равно не пойдёт', () => {
    createXpPopupLayer();
    setVisibility('hidden');

    showXpPopup(130);

    expect(document.querySelectorAll(POPUP_SELECTOR)).toHaveLength(0);
  });
});

describe('снятие попапа', () => {
  test('animationend удаляет узел', () => {
    createXpPopupLayer();
    showXpPopup(130);

    const popup = document.querySelector(POPUP_SELECTOR);
    expect(popup).not.toBeNull();
    if (popup) endAnimation(popup);

    expect(document.querySelectorAll(POPUP_SELECTOR)).toHaveLength(0);
  });

  test('animationend снимает только свой узел', () => {
    createXpPopupLayer();
    showXpPopup(1);
    showXpPopup(2);

    const popups = document.querySelectorAll(POPUP_SELECTOR);
    expect(popups).toHaveLength(2);
    endAnimation(popups[1]);

    expect(popupTexts()).toEqual(['+1 xp']);
  });

  test('без animationend узел держится до конца анимации', () => {
    createXpPopupLayer();
    showXpPopup(130);

    jest.advanceTimersByTime(XP_POPUP_ANIMATION_MS + ANIMATION_SAFETY_MARGIN - 1);

    expect(document.querySelectorAll(POPUP_SELECTOR)).toHaveLength(1);
  });

  test('страховочный таймер снимает узел, если animationend не пришёл', () => {
    createXpPopupLayer();
    showXpPopup(130);

    jest.advanceTimersByTime(XP_POPUP_ANIMATION_MS + ANIMATION_SAFETY_MARGIN);

    expect(document.querySelectorAll(POPUP_SELECTOR)).toHaveLength(0);
  });

  test('после animationend страховочный таймер снят и повторно не срабатывает', () => {
    createXpPopupLayer();
    showXpPopup(130);

    const popup = document.querySelector(POPUP_SELECTOR);
    if (popup) endAnimation(popup);
    expect(jest.getTimerCount()).toBe(0);

    expect(() => {
      jest.advanceTimersByTime(5000);
    }).not.toThrow();
    expect(document.querySelectorAll(POPUP_SELECTOR)).toHaveLength(0);
  });

  test('лимит живых попапов - самый старый вытесняется', () => {
    createXpPopupLayer();

    for (let diff = 1; diff <= 6; diff++) showXpPopup(diff);

    expect(popupTexts()).toEqual(['+2 xp', '+3 xp', '+4 xp', '+5 xp', '+6 xp']);
  });
});

describe('destroyXpPopupLayer', () => {
  test('убирает слой, живые попапы и их таймеры', () => {
    createXpPopupLayer();
    showXpPopup(1);
    showXpPopup(2);
    showXpPopup(3);

    destroyXpPopupLayer();

    expect(layerElement()).toBeNull();
    expect(document.querySelectorAll(POPUP_SELECTOR)).toHaveLength(0);
    expect(jest.getTimerCount()).toBe(0);
  });

  test('после destroy отложенные таймеры не воскрешают узлы', () => {
    createXpPopupLayer();
    showXpPopup(1);
    showXpPopup(2);

    destroyXpPopupLayer();

    expect(() => {
      jest.advanceTimersByTime(5000);
    }).not.toThrow();
    expect(document.querySelectorAll(POPUP_SELECTOR)).toHaveLength(0);
  });
});

describe('разброс вокруг точки появления', () => {
  const ALLOWED_SHIFTS = ['-24px', '-12px', '0px', '12px', '24px'];

  function shifts(): { x: string; y: string }[] {
    return Array.from(document.querySelectorAll<HTMLElement>(POPUP_SELECTOR)).map((node) => ({
      x: node.style.getPropertyValue('--svp-xp-popup-shift-x'),
      y: node.style.getPropertyValue('--svp-xp-popup-shift-y'),
    }));
  }

  test('смещения берутся из допустимого набора по обеим осям', () => {
    createXpPopupLayer();

    for (let diff = 1; diff <= 5; diff++) showXpPopup(diff);

    for (const shift of shifts()) {
      expect(ALLOWED_SHIFTS).toContain(shift.x);
      expect(ALLOWED_SHIFTS).toContain(shift.y);
    }
  });

  test('нижняя граница набора достижима', () => {
    jest.spyOn(Math, 'random').mockReturnValue(0);
    createXpPopupLayer();

    showXpPopup(1);

    expect(shifts()).toEqual([{ x: '-24px', y: '-24px' }]);
  });

  test('верхняя граница набора достижима', () => {
    // Последняя комбинация набора: обе оси на максимуме.
    jest.spyOn(Math, 'random').mockReturnValue(0.999);
    createXpPopupLayer();

    showXpPopup(1);

    expect(shifts()).toEqual([{ x: '24px', y: '24px' }]);
  });

  test('оси выбираются независимо, а не одним значением на обе', () => {
    // Комбинация 7 из 25: по горизонтали третий шаг набора, по вертикали второй.
    jest.spyOn(Math, 'random').mockReturnValue(7 / 25);
    createXpPopupLayer();

    showXpPopup(1);

    expect(shifts()).toEqual([{ x: '0px', y: '-12px' }]);
  });

  test('подряд идущие значения не встают в одну точку', () => {
    // Один и тот же бросок для обоих значений: без исключения предыдущей
    // комбинации второе легло бы ровно на первое.
    jest.spyOn(Math, 'random').mockReturnValue(0);
    createXpPopupLayer();

    showXpPopup(1);
    showXpPopup(2);

    const [first, second] = shifts();
    expect(second).not.toEqual(first);
  });

  test('не совпадает только с предыдущим - более ранние смещения снова доступны', () => {
    const randomSpy = jest.spyOn(Math, 'random');
    createXpPopupLayer();

    randomSpy.mockReturnValue(0);
    showXpPopup(1);
    randomSpy.mockReturnValue(0.999);
    showXpPopup(2);
    randomSpy.mockReturnValue(0);
    showXpPopup(3);

    const [first, , third] = shifts();
    expect(third).toEqual(first);
  });

  test('после пересоздания слоя запрет на повтор сбрасывается', () => {
    jest.spyOn(Math, 'random').mockReturnValue(0);
    createXpPopupLayer();
    showXpPopup(1);
    const [before] = shifts();

    destroyXpPopupLayer();
    createXpPopupLayer();
    showXpPopup(2);

    expect(shifts()).toEqual([before]);
  });
});

describe('позиция слоя', () => {
  test('без верхней панели - фолбэк', () => {
    createXpPopupLayer();

    expect(layerElement()?.style.top).toBe('132px');
  });

  test('позиция считается по панели и пересчитывается только в начале серии', () => {
    const panel = addTopPanel(200);
    createXpPopupLayer();
    showXpPopup(1);

    expect(layerElement()?.style.top).toBe('212px');

    // Панель переехала, но серия ещё идёт - пересчёта нет.
    mockPanelBottom(panel, 400);
    showXpPopup(2);
    expect(layerElement()?.style.top).toBe('212px');

    // Серия закончилась, следующий попап начинает новую и меряет заново.
    for (const popup of Array.from(document.querySelectorAll(POPUP_SELECTOR))) endAnimation(popup);
    showXpPopup(3);
    expect(layerElement()?.style.top).toBe('412px');
  });
});
