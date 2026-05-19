import { getPlayerTeam } from './playerTeam';

describe('getPlayerTeam', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('null when #self-info__name отсутствует', () => {
    expect(getPlayerTeam()).toBeNull();
  });

  test('null когда style.color без var(--team-N)', () => {
    const element = document.createElement('span');
    element.id = 'self-info__name';
    element.style.color = 'red';
    document.body.appendChild(element);
    expect(getPlayerTeam()).toBeNull();
  });

  test('null когда style.color пустой', () => {
    const element = document.createElement('span');
    element.id = 'self-info__name';
    document.body.appendChild(element);
    expect(getPlayerTeam()).toBeNull();
  });

  // jsdom отбрасывает CSS-значения с var(--...) при присваивании
  // style.color (через .style.color, setAttribute или cssText) - значение
  // не валидируется как color. В реальном браузере это работает: SBG ставит
  // именно `var(--team-N)` через jQuery .css(). Поэтому в тестах
  // подменяем геттер style.color вручную через Object.defineProperty.
  function setColor(element: HTMLElement, color: string): void {
    Object.defineProperty(element.style, 'color', {
      get: () => color,
      configurable: true,
    });
  }

  test('число при var(--team-N) в style.color', () => {
    const element = document.createElement('div');
    element.id = 'self-info__name';
    document.body.appendChild(element);
    setColor(element, 'var(--team-2)');
    expect(getPlayerTeam()).toBe(2);
  });

  test('многозначные команды парсятся целиком', () => {
    const element = document.createElement('div');
    element.id = 'self-info__name';
    document.body.appendChild(element);
    setColor(element, 'var(--team-12)');
    expect(getPlayerTeam()).toBe(12);
  });
});
