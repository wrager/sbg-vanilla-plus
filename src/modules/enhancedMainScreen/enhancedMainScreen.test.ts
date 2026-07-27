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
  <button id="notifs-menu" data-active data-direct data-alerts>
    <span id="nm-overview">
      <span class="nm-pings"><svg viewBox="0 0 512 512" width="8"><use href="#fas-user"></use></svg><span id="nm-pings-count">0</span></span>
      <span class="nm-direct"><svg viewBox="0 0 512 512" width="8"><use href="#fas-at"></use></svg><span id="nm-direct-count">3</span></span>
      <span class="nm-alerts"><svg viewBox="0 0 512 512" width="8"><use href="#fas-bell"></use></svg><span id="nm-alerts-count">2746</span></span>
    </span>
    <span data-i18n="menu.notifs">Пейджер</span>
  </button>
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

  test('hides all self-info entries but keeps effects visible', async () => {
    await enhancedMainScreen.enable();
    await flushPromises();

    const entries = [...document.querySelectorAll('.self-info__entry')].filter(
      (e): e is HTMLElement => e instanceof HTMLElement,
    );
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect(entry.style.display).toBe('none');
    }
    const effects = document.querySelector('.effects');
    expect(effects instanceof HTMLElement && effects.style.display).not.toBe('none');
  });

  test('reparents original name span into self-info', async () => {
    await enhancedMainScreen.enable();
    await flushPromises();

    // Оригинальный span ника перенесён напрямую в self-info (сохраняет .profile-link)
    const nameSpan = document.getElementById('self-info__name');
    const selfInfo = document.querySelector('.self-info');
    expect(nameSpan?.parentElement).toBe(selfInfo);
    expect(nameSpan?.classList.contains('profile-link')).toBe(true);
    expect(nameSpan?.dataset.name).toBe('wrager');
  });

  test('reparents level and xp spans into self-info: name, then level, then xp', async () => {
    await enhancedMainScreen.enable();
    await flushPromises();

    const selfInfo = document.querySelector('.self-info');
    const nameSpan = document.getElementById('self-info__name');
    const explvSpan = document.getElementById('self-info__explv');
    const expSpan = document.getElementById('self-info__exp');
    if (!selfInfo || !nameSpan || !expSpan || !explvSpan) {
      throw new Error('self-info spans not found in DOM');
    }

    expect(explvSpan.parentElement).toBe(selfInfo);
    expect(expSpan.parentElement).toBe(selfInfo);

    const directChildren = [...selfInfo.children];
    const nameIndex = directChildren.indexOf(nameSpan);
    const expIndex = directChildren.indexOf(expSpan);
    const explvIndex = directChildren.indexOf(explvSpan);
    expect(nameIndex).toBeGreaterThanOrEqual(0);
    expect(nameIndex).toBeLessThan(explvIndex);
    expect(explvIndex).toBeLessThan(expIndex);
  });

  test('strips all non-digits from level text on enable', async () => {
    await enhancedMainScreen.enable();
    await flushPromises();

    // Исходно "(Ур-10)" -> после применения "10" (всё нецифровое вырезано)
    expect(document.getElementById('self-info__explv')?.textContent).toBe('10');
  });

  test('keeps stripping all non-digits when game updates level text', async () => {
    await enhancedMainScreen.enable();
    await flushPromises();

    const explvSpan = document.getElementById('self-info__explv');
    if (!explvSpan) throw new Error('explv span not found');

    // Эмуляция апдейта игрой через i18next (.text() заменяет вложенный textNode)
    explvSpan.textContent = '(Lv-99)';
    await flushPromises();

    expect(explvSpan.textContent).toBe('99');
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

  test('moves game-menu before self-info, effects stays after', async () => {
    await enhancedMainScreen.enable();
    await flushPromises();

    const container = document.querySelector('.topleft-container');
    const children = container ? [...container.children] : [];
    const gameMenuIndex = children.findIndex((child) => child.classList.contains('game-menu'));
    const selfInfoIndex = children.findIndex((child) => child.classList.contains('self-info'));
    const effectsIndex = children.findIndex((child) => child.classList.contains('effects'));
    expect(gameMenuIndex).toBeLessThan(selfInfoIndex);
    expect(selfInfoIndex).toBeLessThan(effectsIndex);
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

  test('calls jqueryI18next localize on disable as a safety net', async () => {
    await enhancedMainScreen.enable();
    await flushPromises();

    // Мокаем глобальный jQuery с localize() (jqueryI18next)
    const localizeMock = jest.fn();
    const jqueryMock = jest.fn(() => ({ localize: localizeMock }));
    (window as unknown as Record<string, unknown>).$ = jqueryMock;

    await enhancedMainScreen.disable();

    // localize() вызывается для OPS и Settings как страховка
    const opsButton = document.getElementById('ops');
    const settingsButton = document.getElementById('settings');
    expect(jqueryMock).toHaveBeenCalledWith(opsButton);
    expect(jqueryMock).toHaveBeenCalledWith(settingsButton);
    expect(localizeMock).toHaveBeenCalledTimes(2);

    // При этом textContent восстановлен через сохранённый fallback,
    // независимо от того, сделал ли мок jQuery что-либо
    expect(opsButton?.textContent).toBe('OPS');
    expect(settingsButton?.textContent).toBe('Settings');

    delete (window as unknown as Record<string, unknown>).$;

    // Переинициализируем для afterEach
    document.body.innerHTML = MAIN_SCREEN_HTML;
  });

  test('restores text via window.i18next.t when available on disable', async () => {
    const translateMock = jest.fn((key: string) => `TR:${key}`);
    (window as unknown as Record<string, unknown>).i18next = { t: translateMock };

    await enhancedMainScreen.enable();
    await flushPromises();
    await enhancedMainScreen.disable();

    const opsButton = document.getElementById('ops');
    const settingsButton = document.getElementById('settings');
    expect(opsButton?.textContent).toBe('TR:menu.ops');
    expect(settingsButton?.textContent).toBe('TR:menu.settings');
    expect(translateMock).toHaveBeenCalledWith('menu.ops');
    expect(translateMock).toHaveBeenCalledWith('menu.settings');

    // Атрибут data-i18n тоже восстановлен для будущих localize() игры
    expect(opsButton?.getAttribute('data-i18n')).toBe('menu.ops');
    expect(settingsButton?.getAttribute('data-i18n')).toBe('menu.settings');

    delete (window as unknown as Record<string, unknown>).i18next;
  });

  test('falls back to original textContent on disable when i18next unavailable', async () => {
    // Убеждаемся что ни i18next, ни jQuery не определены
    delete (window as unknown as Record<string, unknown>).i18next;
    delete (window as unknown as Record<string, unknown>).$;

    await enhancedMainScreen.enable();
    await flushPromises();
    await enhancedMainScreen.disable();

    const opsButton = document.getElementById('ops');
    const settingsButton = document.getElementById('settings');
    expect(opsButton?.textContent).toBe('OPS');
    expect(settingsButton?.textContent).toBe('Settings');
    expect(opsButton?.getAttribute('data-i18n')).toBe('menu.ops');
    expect(settingsButton?.getAttribute('data-i18n')).toBe('menu.settings');
  });

  test('restores text even if jQuery.localize is a no-op', async () => {
    // jQuery есть, но localize ничего не делает - fallback должен сработать
    const localizeMock = jest.fn();
    const jqueryMock = jest.fn(() => ({ localize: localizeMock }));
    (window as unknown as Record<string, unknown>).$ = jqueryMock;
    delete (window as unknown as Record<string, unknown>).i18next;

    await enhancedMainScreen.enable();
    await flushPromises();
    await enhancedMainScreen.disable();

    expect(document.getElementById('ops')?.textContent).toBe('OPS');
    expect(document.getElementById('settings')?.textContent).toBe('Settings');
    expect(localizeMock).toHaveBeenCalledTimes(2);

    delete (window as unknown as Record<string, unknown>).$;
  });

  test('cleans up on disable', async () => {
    await enhancedMainScreen.enable();
    await flushPromises();

    await enhancedMainScreen.disable();

    const container = document.querySelector('.topleft-container');
    expect(container?.classList.contains('svp-compact')).toBe(false);
    expect(getEntryFor('self-info__exp')?.style.display).toBe('');
    expect(document.getElementById('svp-enhancedMainScreen')).toBeNull();

    // Span ника возвращён в оригинальную запись
    const nameSpan = document.getElementById('self-info__name');
    expect(nameSpan?.closest('.self-info__entry')).not.toBeNull();

    // OPS: текст и data-i18n восстановлены, цвет сброшен
    const opsButton = document.getElementById('ops');
    expect(opsButton?.textContent).toBe('OPS');
    expect(opsButton?.getAttribute('data-i18n')).toBe('menu.ops');
    expect(opsButton?.style.color).toBe('');

    // Settings: текст и data-i18n восстановлены
    const settingsButton = document.getElementById('settings');
    expect(settingsButton?.textContent).toBe('Settings');
    expect(settingsButton?.getAttribute('data-i18n')).toBe('menu.settings');
  });

  test('restores original inline display of entries on disable', async () => {
    // Эмулируем игровую ситуацию: один из entry имеет нестандартный inline
    // display, выставленный игрой до включения модуля (например, скрыт игрой
    // для своего сценария или явно показан с display:flex).
    const invEntry = getEntryFor('self-info__inv');
    if (!invEntry) throw new Error('inv entry not found');
    invEntry.style.display = 'flex';

    await enhancedMainScreen.enable();
    await flushPromises();

    // Во время enable все entry скрыты на display:none
    expect(invEntry.style.display).toBe('none');

    await enhancedMainScreen.disable();

    // После disable восстановлен оригинальный inline display, не пустая строка
    expect(invEntry.style.display).toBe('flex');
  });

  test('restores original level text on disable', async () => {
    await enhancedMainScreen.enable();
    await flushPromises();

    // Strip применился: "(Ур-10)" -> "10"
    expect(document.getElementById('self-info__explv')?.textContent).toBe('10');

    await enhancedMainScreen.disable();

    // Текст уровня вернулся к исходному значению из DOM
    expect(document.getElementById('self-info__explv')?.textContent).toBe('(Ур-10)');
  });

  test('restores level and xp spans into their original entries on disable', async () => {
    await enhancedMainScreen.enable();
    await flushPromises();
    await enhancedMainScreen.disable();

    const explvEntry = getEntryFor('self-info__explv');
    const expEntry = getEntryFor('self-info__exp');
    expect(explvEntry).not.toBeNull();
    expect(expEntry).not.toBeNull();

    // У уровня сосед слева - ник (та же запись), у опыта сосед слева - "EXP" label
    const explvSpan = document.getElementById('self-info__explv');
    const nameSpan = document.getElementById('self-info__name');
    expect(explvSpan?.parentElement).toBe(nameSpan?.parentElement);

    const selfInfo = document.querySelector('.self-info');
    expect(selfInfo?.children.length).toBe(3); // три исходных .self-info__entry
  });

  test('stops stripping level prefix after disable (observer disconnected)', async () => {
    await enhancedMainScreen.enable();
    await flushPromises();
    await enhancedMainScreen.disable();

    const explvSpan = document.getElementById('self-info__explv');
    if (!explvSpan) throw new Error('explv span not found');

    // После disable observer должен быть отключён - игровое обновление текста
    // не должно проходить через наш stripLvPrefix.
    explvSpan.textContent = '(Ур-77)';
    await flushPromises();
    expect(explvSpan.textContent).toBe('(Ур-77)');
  });
});
