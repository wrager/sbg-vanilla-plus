import { enhancedMainScreen } from './enhancedMainScreen';

// DOM-структура максимально приближена к реальной игре (refs/game/dom/body.html)
const MAIN_SCREEN_HTML = `
<div class="topleft-container">
  <div class="self-info">
    <div class="self-info__entry"><span data-i18n="self-info.name">Имя</span>: <span id="self-info__name" class="profile-link" style="color: var(--team-2);" data-name="wrager">wrager</span> <span id="self-info__explv" data-i18n="self-info.lv">(Ур-10)</span></div>
    <div class="self-info__entry"><span data-i18n="self-info.xp">Опыт</span>: <span id="self-info__exp">16 914 849</span> <span data-i18n="units.pts-xp">очк.</span></div>
    <div class="self-info__entry"><span data-i18n="self-info.inventory">Инвентарь</span>: <span id="self-info__inv">2812</span> / <span id="self-info__inv-lim">3000</span></div>
  </div>
  <div class="game-menu">
    <button id="ops" data-i18n="menu.ops">OPS</button>
    <button id="score" data-i18n="menu.score">Score</button>
    <button id="leaderboard" data-i18n="menu.leaderboard">Leaderboard</button>
    <button id="settings" data-i18n="menu.settings">Settings</button>
  </div>
  <div class="effects"></div>
</div>
<div class="bottom-container">
  <button id="toggle-follow-btn">СЛ</button>
  <button id="attack-menu">Атака</button>
  <button id="notifs-menu">Отбивки</button>
</div>`;

const MAIN_SCREEN_HTML_NO_OPS = `
<div class="topleft-container">
  <div class="self-info">
    <div class="self-info__entry"><span id="self-info__name">wrager</span></div>
  </div>
  <div class="game-menu"><button id="settings" data-i18n="menu.settings">Settings</button></div>
</div>`;

function flushPromises(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function getEntryFor(id: string): HTMLElement | null {
  const element = document.getElementById(id)?.closest('.self-info__entry');
  return element instanceof HTMLElement ? element : null;
}

describe('enhancedMainScreen', () => {
  beforeEach(() => {
    document.body.innerHTML = MAIN_SCREEN_HTML;
  });

  afterEach(async () => {
    await enhancedMainScreen.disable();
    document.body.innerHTML = '';
    delete (window as unknown as Record<string, unknown>).i18next;
    delete (window as unknown as Record<string, unknown>).$;
  });

  test('has correct module metadata', () => {
    expect(enhancedMainScreen.id).toBe('enhancedMainScreen');
    expect(enhancedMainScreen.category).toBe('ui');
    expect(enhancedMainScreen.defaultEnabled).toBe(true);
  });

  test('injects styles on enable', async () => {
    await enhancedMainScreen.enable();
    await flushPromises();

    const style = document.getElementById('svp-enhancedMainScreen');
    expect(style).not.toBeNull();
    expect(style?.tagName).toBe('STYLE');
  });

  test('adds svp-compact class to container', async () => {
    await enhancedMainScreen.enable();
    await flushPromises();

    const container = document.querySelector('.topleft-container');
    expect(container?.classList.contains('svp-compact')).toBe(true);
  });

  test('marks self-info entries with svp-ems-hidden class, not inline display', async () => {
    await enhancedMainScreen.enable();
    await flushPromises();

    // Используем класс-маркер, а не inline style.display — чтобы disable мог откатить по селектору.
    expect(getEntryFor('self-info__exp')?.classList.contains('svp-ems-hidden')).toBe(true);
    expect(getEntryFor('self-info__inv')?.classList.contains('svp-ems-hidden')).toBe(true);
    expect(getEntryFor('self-info__exp')?.style.display).toBe('');
    expect(getEntryFor('self-info__inv')?.style.display).toBe('');
    const effects = document.querySelector('.effects');
    expect(effects instanceof HTMLElement && effects.classList.contains('svp-ems-hidden')).toBe(
      false,
    );
  });

  test('reparents original name span into self-info and marks its origin entry', async () => {
    await enhancedMainScreen.enable();
    await flushPromises();

    const nameSpan = document.getElementById('self-info__name');
    const selfInfo = document.querySelector('.self-info');
    expect(nameSpan?.parentElement).toBe(selfInfo);
    expect(nameSpan?.classList.contains('profile-link')).toBe(true);
    expect(nameSpan?.dataset.name).toBe('wrager');

    // Исходная запись помечена классом, чтобы disable нашёл её через селектор.
    const origin = document.querySelector('.self-info__entry.svp-ems-name-origin');
    expect(origin).not.toBeNull();
  });

  test('replaces OPS button text with inventory status and removes data-i18n', async () => {
    await enhancedMainScreen.enable();
    await flushPromises();

    const opsButton = document.getElementById('ops');
    expect(opsButton?.textContent).toBe('2812/3000');
    expect(opsButton?.hasAttribute('data-i18n')).toBe(false);
  });

  test('updates OPS text when inventory changes', async () => {
    await enhancedMainScreen.enable();
    await flushPromises();

    const invSpan = document.getElementById('self-info__inv');
    if (!invSpan) throw new Error('inv span not found');
    invSpan.textContent = '2999';
    await flushPromises();

    expect(document.getElementById('ops')?.textContent).toBe('2999/3000');
  });

  test('mirrors inventory overflow color to OPS button', async () => {
    await enhancedMainScreen.enable();
    await flushPromises();

    const invEntry = getEntryFor('self-info__inv');
    const opsButton = document.getElementById('ops');
    if (!invEntry || !opsButton) throw new Error('elements not found');

    invEntry.style.color = 'red';
    await flushPromises();
    expect(opsButton.style.color).toBe('red');

    invEntry.style.color = '';
    await flushPromises();
    expect(opsButton.style.color).toBe('');
  });

  test('moves game-menu before self-info and marks it with data attribute', async () => {
    await enhancedMainScreen.enable();
    await flushPromises();

    const container = document.querySelector('.topleft-container');
    const children = container ? [...container.children] : [];
    const gameMenuIndex = children.findIndex((child) => child.classList.contains('game-menu'));
    const selfInfoIndex = children.findIndex((child) => child.classList.contains('self-info'));
    const effectsIndex = children.findIndex((child) => child.classList.contains('effects'));
    expect(gameMenuIndex).toBeLessThan(selfInfoIndex);
    expect(selfInfoIndex).toBeLessThan(effectsIndex);

    const gameMenu = document.querySelector('.game-menu');
    expect(gameMenu?.getAttribute('data-svp-ems-moved')).toBe('1');
  });

  test('replaces Settings button text with gear symbol and removes data-i18n', async () => {
    await enhancedMainScreen.enable();
    await flushPromises();

    const settingsButton = document.getElementById('settings');
    expect(settingsButton?.textContent).toBe('\u2699\uFE0E');
    expect(settingsButton?.hasAttribute('data-i18n')).toBe(false);
  });

  test('does not hide game-menu buttons', async () => {
    await enhancedMainScreen.enable();
    await flushPromises();

    expect(document.getElementById('ops')?.style.display).not.toBe('none');
    expect(document.getElementById('score')?.style.display).not.toBe('none');
  });

  test('T1.1: full round-trip — enable/disable restores DOM to pristine', async () => {
    await enhancedMainScreen.enable();
    await flushPromises();
    await enhancedMainScreen.disable();

    const container = document.querySelector('.topleft-container');
    expect(container?.classList.contains('svp-compact')).toBe(false);
    expect(document.getElementById('svp-enhancedMainScreen')).toBeNull();

    // Все записи self-info — без inline display и без класса-маркера.
    for (const id of ['self-info__name', 'self-info__exp', 'self-info__inv']) {
      const entry = getEntryFor(id);
      expect(entry?.style.display).toBe('');
      expect(entry?.classList.contains('svp-ems-hidden')).toBe(false);
    }

    // Ник возвращён внутрь оригинальной записи, класс-маркер снят.
    const nameSpan = document.getElementById('self-info__name');
    expect(nameSpan?.closest('.self-info__entry')).not.toBeNull();
    expect(document.querySelectorAll('.self-info__entry.svp-ems-name-origin').length).toBe(0);

    // game-menu — после self-info, маркер снят.
    const movedMenu = document.querySelector('.game-menu');
    expect(movedMenu?.hasAttribute('data-svp-ems-moved')).toBe(false);
    const children = container ? [...container.children] : [];
    const gameMenuIndex = children.findIndex((child) => child.classList.contains('game-menu'));
    const selfInfoIndex = children.findIndex((child) => child.classList.contains('self-info'));
    expect(selfInfoIndex).toBeLessThan(gameMenuIndex);

    // OPS: текст и data-i18n восстановлены.
    const opsButton = document.getElementById('ops');
    expect(opsButton?.textContent).toBe('OPS');
    expect(opsButton?.getAttribute('data-i18n')).toBe('menu.ops');
    expect(opsButton?.style.color).toBe('');

    // Settings: текст и data-i18n восстановлены.
    const settingsButton = document.getElementById('settings');
    expect(settingsButton?.textContent).toBe('Settings');
    expect(settingsButton?.getAttribute('data-i18n')).toBe('menu.settings');
  });

  test('T1.2: disable after game rebuilds .topleft-container restores fresh DOM', async () => {
    await enhancedMainScreen.enable();
    await flushPromises();

    // Игра перестроила топ-панель: старые DOM-узлы (с нашими модификациями) удалены,
    // на их месте — свежая разметка с исходными id/классами и восстановленными data-i18n.
    // Сохранённые внутри модуля ссылки (если бы они были) стали бы orphan.
    const container = document.querySelector('.topleft-container');
    if (!container) throw new Error('container gone');
    container.innerHTML = `
      <div class="self-info">
        <div class="self-info__entry"><span data-i18n="self-info.name">Имя</span>: <span id="self-info__name">wrager</span></div>
        <div class="self-info__entry"><span data-i18n="self-info.inventory">Инвентарь</span>: <span id="self-info__inv">2812</span> / <span id="self-info__inv-lim">3000</span></div>
      </div>
      <div class="game-menu">
        <button id="ops" data-i18n="menu.ops">OPS</button>
        <button id="settings" data-i18n="menu.settings">Settings</button>
      </div>
      <div class="effects"></div>`;

    await enhancedMainScreen.disable();

    // Класс компактности снят с живого контейнера.
    expect(container.classList.contains('svp-compact')).toBe(false);

    // Новая разметка не должна нести наших маркеров.
    expect(document.querySelectorAll('.svp-ems-hidden').length).toBe(0);
    expect(document.querySelectorAll('[data-svp-ems-moved]').length).toBe(0);
    expect(document.querySelectorAll('.svp-ems-name-origin').length).toBe(0);

    // Кнопки в новой разметке игра уже сама привела в порядок — disable их не трогает.
    const settingsButton = document.getElementById('settings');
    expect(settingsButton?.textContent).toBe('Settings');
    expect(settingsButton?.getAttribute('data-i18n')).toBe('menu.settings');
    const opsButton = document.getElementById('ops');
    expect(opsButton?.getAttribute('data-i18n')).toBe('menu.ops');
  });

  test('T1.3: disable when .topleft-container is removed — does not throw', async () => {
    await enhancedMainScreen.enable();
    await flushPromises();

    document.querySelector('.topleft-container')?.remove();

    // SPA ушла на другой экран, контейнера нет — disable должен молча выйти.
    expect(() => {
      void enhancedMainScreen.disable();
    }).not.toThrow();

    expect(document.getElementById('svp-enhancedMainScreen')).toBeNull();
  });

  test('T1.4: double disable is idempotent', async () => {
    await enhancedMainScreen.enable();
    await flushPromises();
    await enhancedMainScreen.disable();
    const htmlAfterFirst = document.body.innerHTML;

    await enhancedMainScreen.disable();
    expect(document.body.innerHTML).toBe(htmlAfterFirst);
  });

  test('T1.5: enable when #ops is missing — bails out early, subsequent disable is safe', async () => {
    document.body.innerHTML = MAIN_SCREEN_HTML_NO_OPS;
    // В разметке нет #ops — setup возвращается рано, модификации не применяются.
    await enhancedMainScreen.enable();
    await flushPromises();

    const container = document.querySelector('.topleft-container');
    expect(container?.classList.contains('svp-compact')).toBe(false);

    expect(() => {
      void enhancedMainScreen.disable();
    }).not.toThrow();
  });

  test('T1.6: disable without i18next falls back to saved original text', async () => {
    await enhancedMainScreen.enable();
    await flushPromises();
    delete (window as unknown as Record<string, unknown>).i18next;
    await enhancedMainScreen.disable();

    expect(document.getElementById('ops')?.textContent).toBe('OPS');
    expect(document.getElementById('settings')?.textContent).toBe('Settings');
  });

  test('T1.7: uses i18next.t() over saved originalText when both are available', async () => {
    const translateMock = jest.fn((key: string) => `TR:${key}`);
    (window as unknown as Record<string, unknown>).i18next = { t: translateMock };

    await enhancedMainScreen.enable();
    await flushPromises();
    await enhancedMainScreen.disable();

    expect(document.getElementById('ops')?.textContent).toBe('TR:menu.ops');
    expect(document.getElementById('settings')?.textContent).toBe('TR:menu.settings');
    expect(translateMock).toHaveBeenCalledWith('menu.ops');
    expect(translateMock).toHaveBeenCalledWith('menu.settings');

    expect(document.getElementById('ops')?.getAttribute('data-i18n')).toBe('menu.ops');
    expect(document.getElementById('settings')?.getAttribute('data-i18n')).toBe('menu.settings');
  });

  test('calls jqueryI18next localize on disable as a safety net', async () => {
    await enhancedMainScreen.enable();
    await flushPromises();

    const localizeMock = jest.fn();
    const jqueryMock = jest.fn(() => ({ localize: localizeMock }));
    (window as unknown as Record<string, unknown>).$ = jqueryMock;

    await enhancedMainScreen.disable();

    // localize() вызывается для OPS и Settings как страховка на случай, если их data-i18n
    // сбросился между enable и disable, а restoreI18nText нашёл такой кейс.
    const opsButton = document.getElementById('ops');
    const settingsButton = document.getElementById('settings');
    expect(jqueryMock).toHaveBeenCalledWith(opsButton);
    expect(jqueryMock).toHaveBeenCalledWith(settingsButton);
    expect(localizeMock).toHaveBeenCalledTimes(2);

    expect(opsButton?.textContent).toBe('OPS');
    expect(settingsButton?.textContent).toBe('Settings');
  });

  test('restores text even if jQuery.localize is a no-op', async () => {
    const localizeMock = jest.fn();
    const jqueryMock = jest.fn(() => ({ localize: localizeMock }));
    (window as unknown as Record<string, unknown>).$ = jqueryMock;

    await enhancedMainScreen.enable();
    await flushPromises();
    await enhancedMainScreen.disable();

    expect(document.getElementById('ops')?.textContent).toBe('OPS');
    expect(document.getElementById('settings')?.textContent).toBe('Settings');
    expect(localizeMock).toHaveBeenCalledTimes(2);
  });
});
