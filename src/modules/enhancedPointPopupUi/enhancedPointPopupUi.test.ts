import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { enhancedPointPopupUi } from './enhancedPointPopupUi';

/** Селекторы, чью изоляцию от нативных блоков стережёт этот файл. */
const ACTION_BUTTONS_SELECTOR = '.info.popup .i-buttons button';
const META_ENTRY_SELECTOR = '.i-stat__entry:not(.i-stat__cores)';

describe('enhancedPointPopupUi', () => {
  afterEach(async () => {
    await enhancedPointPopupUi.disable();
    document.head.innerHTML = '';
    document.body.innerHTML = '';
  });

  test('enable injects style element', async () => {
    await enhancedPointPopupUi.enable();
    expect(document.getElementById('svp-enhancedPointPopupUi')).not.toBeNull();
  });

  test('disable removes style element', async () => {
    await enhancedPointPopupUi.enable();
    await enhancedPointPopupUi.disable();
    expect(document.getElementById('svp-enhancedPointPopupUi')).toBeNull();
  });

  test('enable is idempotent — only one style element exists', async () => {
    await enhancedPointPopupUi.enable();
    await enhancedPointPopupUi.enable();
    expect(document.querySelectorAll('#svp-enhancedPointPopupUi').length).toBe(1);
  });
});

describe('enhancedPointPopupUi — селекторы изолированы от нативных блоков попапа точки', () => {
  afterEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '';
  });

  function createInfoPopup(): HTMLElement {
    const popup = document.createElement('div');
    popup.className = 'info popup';
    popup.innerHTML = `
      <div class="i-header">
        <span class="i-title">Test point</span>
      </div>
      <div class="i-image-box">
        <span id="i-ref">REF 5/100</span>
      </div>
      <div class="i-stat">
        <div class="i-stat__tools">
          <button class="icon-button i-flag-btn" data-flag="favorite"></button>
          <button class="icon-button i-flag-btn" data-flag="locked"></button>
          <button class="icon-button" id="i-navigate"></button>
          <button class="icon-button" id="i-tools"></button>
        </div>
        <div class="i-stat__entry"><span>Distance</span></div>
        <div class="i-stat__entry"><span>Owner</span></div>
        <div class="i-stat__entry"><span>Lines</span></div>
        <div class="i-stat__entry"><span>Regions</span></div>
        <div class="i-stat__entry i-stat__cores"><span>Cores</span></div>
        <div class="i-buttons">
          <div class="discover i-multi-button">
            <button class="discover-mod" data-wish="2"></button>
            <button id="discover"><span>Discover</span></button>
            <button class="discover-mod" data-wish="3"></button>
          </div>
          <div class="deploy i-multi-button" data-magic="NaN">
            <button id="deploy">Deploy</button>
          </div>
          <button id="repair">Repair</button>
          <button id="draw">Draw</button>
        </div>
      </div>
      <!-- Клонируемые в попап нативные блоки SBG 0.6.x -->
      <div class="inventory__ref-actions popover hidden">
        <div class="inventory__ra-item"><button data-flag="favorite"><span>Fav</span></button></div>
        <div class="inventory__ra-item"><button data-flag="locked"><span>Lock</span></button></div>
      </div>
      <div class="inventory__manage-amount hidden">
        <span class="inventory__ma-item"></span>
        <input class="inventory__ma-amount" type="number" value="1">
        <span class="inventory__ma-max">10</span>
      </div>
    `;
    return popup;
  }

  // min-height: 72px обязан достаться всем кнопкам действий, включая вложенные
  // в обёртки .i-multi-button: сузь кто-нибудь селектор до прямых потомков, и
  // discover с deploy молча потеряли бы размер.
  test('.info.popup .i-buttons button матчит все кнопки действий, включая вложенные в i-multi-button', () => {
    const popup = createInfoPopup();
    document.body.appendChild(popup);

    const matched = Array.from(popup.querySelectorAll<HTMLElement>(ACTION_BUTTONS_SELECTOR));
    expect(matched.length).toBe(6);

    const matchedSet = new Set<Element>(matched);
    for (const selector of [
      '.discover-mod[data-wish="2"]',
      '#discover',
      '.discover-mod[data-wish="3"]',
      '#deploy',
      '#repair',
      '#draw',
    ]) {
      const button = popup.querySelector(selector);
      if (!button) throw new Error(`${selector} отсутствует в фикстуре`);
      expect(matchedSet.has(button)).toBe(true);
    }
  });

  test('.i-stat__entry:not(.i-stat__cores) матчит все строки метаданных, кроме ячейки ядер', () => {
    const popup = createInfoPopup();
    document.body.appendChild(popup);

    // В попапе игры четыре строки метаданных (дистанция, владелец, линии,
    // регионы) плюс отдельная ячейка ядер, которой мелкий шрифт не нужен.
    const matched = popup.querySelectorAll(META_ENTRY_SELECTOR);
    expect(matched.length).toBe(4);
    expect(popup.querySelectorAll('.i-stat__entry.i-stat__cores').length).toBe(1);
  });

  // Ассерты выше проверяют селекторы по копии в константах. Без этой сверки
  // сужение селектора в самой таблице стилей прошло бы молча: разметка бы
  // соответствовала игре, тесты остались бы зелёными, а кнопки потеряли размер.
  test('проверяемые селекторы стоят в styles.css модуля', () => {
    const css = readFileSync(join(__dirname, 'styles.css'), 'utf8');

    expect(css).toContain(`${ACTION_BUTTONS_SELECTOR} {`);
    expect(css).toContain(`${META_ENTRY_SELECTOR} {`);
  });

  test('нативные .i-flag-btn не попадают под селектор для игровых кнопок i-buttons', () => {
    const popup = createInfoPopup();
    document.body.appendChild(popup);

    const flagButtons = Array.from(popup.querySelectorAll('.i-flag-btn'));
    expect(flagButtons.length).toBe(2);
    const gameButtons = new Set<Element>(
      Array.from(popup.querySelectorAll(ACTION_BUTTONS_SELECTOR)),
    );
    for (const flagButton of flagButtons) {
      expect(gameButtons.has(flagButton)).toBe(false);
    }
  });
});

describe('enhancedPointPopupUi — подкраска активных fav/lock через :has()', () => {
  afterEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '';
  });

  function createFlagBtn(flag: 'favorite' | 'locked', iconId: string): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.className = 'icon-button i-flag-btn';
    btn.dataset.flag = flag;
    btn.innerHTML = `<svg viewBox="0 0 576 576" height="24"><use href="#${iconId}"></use></svg>`;
    return btn;
  }

  // Игра переключает иконку через href у <use>: filled-варианты ('fas-star',
  // 'fas-lock') = активное состояние, outline ('fa-star', 'fas-lock-open') =
  // неактивное. Если селектор сломается, активная подсветка пропадёт молча.

  test('активная звезда матчится по :has(use[href="#fas-star"]) и не задевает outline', () => {
    const filled = createFlagBtn('favorite', 'fas-star');
    const outline = createFlagBtn('favorite', 'fa-star');
    document.body.append(filled, outline);

    const matched = document.querySelectorAll(
      '.i-flag-btn[data-flag="favorite"]:has(use[href="#fas-star"])',
    );
    expect(matched.length).toBe(1);
    expect(matched[0]).toBe(filled);
  });

  test('активный замок матчится по :has(use[href="#fas-lock"]) и не задевает open', () => {
    const locked = createFlagBtn('locked', 'fas-lock');
    const open = createFlagBtn('locked', 'fas-lock-open');
    document.body.append(locked, open);

    const matched = document.querySelectorAll(
      '.i-flag-btn[data-flag="locked"]:has(use[href="#fas-lock"])',
    );
    expect(matched.length).toBe(1);
    expect(matched[0]).toBe(locked);
  });
});
