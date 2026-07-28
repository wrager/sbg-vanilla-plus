import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { enhancedPointPopupUi } from './enhancedPointPopupUi';

/**
 * Селекторы, чью изоляцию от нативных блоков стережёт этот файл. Записаны так
 * же, как в styles.css модуля, включая кавычки: тест ниже сверяет каждый с
 * разобранной таблицей стилей, и правка правила без правки константы красит
 * сверку.
 */
const ACTION_BUTTONS_SELECTOR = '.info.popup .i-buttons button';
const META_ENTRY_SELECTOR = '.i-stat__entry:not(.i-stat__cores)';
const CORES_LEVEL_SELECTOR = '.cores-list__level';
const ACTIVE_FAVORITE_TINT_SELECTOR =
  ".i-flag-btn[data-flag='favorite']:has(use[href='#fas-star']) svg";
const ACTIVE_LOCKED_TINT_SELECTOR =
  ".i-flag-btn[data-flag='locked']:has(use[href='#fas-lock']) svg";

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
      <h3 class="i-header popup-header">
        <span id="i-title">Test point</span>
      </h3>
      <div class="i-image-box">
        <span id="i-ref">REF 5/100</span>
      </div>
      <div class="i-stat">
        <div class="i-stat__tools">
          <button class="icon-button i-flag-btn" data-flag="favorite">
            <svg viewBox="0 0 576 576" height="24"><use href="#fa-star"></use></svg>
          </button>
          <button class="icon-button i-flag-btn" data-flag="locked">
            <svg viewBox="0 0 576 576" height="24"><use href="#fas-lock-open"></use></svg>
          </button>
          <button class="icon-button" id="i-navigate"></button>
          <button class="icon-button" id="i-tools"></button>
        </div>
        <div class="i-stat__entry"><span>Distance</span></div>
        <div class="i-stat__entry"><span>Owner</span></div>
        <div class="i-stat__entry"><span>Lines</span></div>
        <div class="i-stat__entry"><span>Regions</span></div>
        <div class="i-stat__entry i-stat__cores"><span>Cores</span></div>
        <div class="deploy-slider-wrp">
          <div class="splide" id="deploy-slider">
            <div class="splide__track">
              <ul class="splide__list" id="cores-list">
                <li class="splide__slide" data-guid="core-1" data-level="1">
                  <span class="cores-list__level">C I</span>
                  <span class="cores-list__amount">x4</span>
                </li>
                <li class="splide__slide" data-guid="core-2" data-level="8">
                  <span class="cores-list__level">C VIII</span>
                  <span class="cores-list__amount">x1</span>
                </li>
              </ul>
            </div>
          </div>
          <div class="deploy-slider-error"></div>
        </div>
        <div class="i-buttons">
          <div class="discover i-multi-button">
            <button class="discover-mod" data-wish="2" disabled></button>
            <button id="discover" disabled><span>Discover</span></button>
            <button class="discover-mod" data-wish="3" disabled></button>
          </div>
          <div class="deploy i-multi-button" data-magic="NaN">
            <button id="deploy" data-state="deploy" disabled>Deploy</button>
          </div>
          <button id="repair" disabled>Repair</button>
          <button id="draw" disabled>Draw</button>
        </div>
      </div>
      <button class="popup-close">[x]</button>
    `;
    return popup;
  }

  /**
   * Попап инвентаря: живёт рядом с попапом точки, а не внутри него. Кнопки
   * действий над ключом игра только позиционирует поверх попапа через Popper,
   * в дерево попапа точки не переносит.
   */
  function createInventoryPopup(): HTMLElement {
    const popup = document.createElement('div');
    popup.className = 'inventory popup pp-center pp-mfull hidden';
    popup.innerHTML = `
      <div class="inventory__manage-amount hidden">
        <div class="inventory__ma-item"></div>
        <div class="inventory__ma-counter">
          <button data-type="minus">-</button>
          <label><input type="number" class="inventory__ma-amount" min="1" value="1" required> / <span class="inventory__ma-max">1</span></label>
          <button data-type="plus">+</button>
        </div>
      </div>
      <ul class="inventory__ref-actions popover hidden">
        <li class="inventory__ra-item"><button data-flag="favorite">
          <span></span>
          <svg viewBox="0 0 576 576" height="1em"><use href="#fas-star"></use></svg>
        </button></li>
        <li class="inventory__ra-item"><button data-flag="locked">
          <span></span>
          <svg viewBox="0 0 576 576" height="1em"><use href="#fas-lock-open"></use></svg>
        </button></li>
        <li class="inventory__ra-item"><button id="inventory__ra-manage">
          <span></span>
          <svg viewBox="0 0 512 512" height="1em"><use href="#fas-trash-can"></use></svg>
        </button></li>
      </ul>
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

  // Подпись уровня ядра живёт в слайдере деплоя, который лежит в том же
  // .i-stat, что и строки метаданных: мелкий шрифт строк не должен доставаться
  // подписи, ради чего правило .cores-list__level и заведено.
  test('.cores-list__level не пересекается с селектором строк метаданных', () => {
    const popup = createInfoPopup();
    document.body.appendChild(popup);

    const levels = Array.from(popup.querySelectorAll(CORES_LEVEL_SELECTOR));
    expect(levels.length).toBe(2);

    const metaEntries = new Set<Element>(Array.from(popup.querySelectorAll(META_ENTRY_SELECTOR)));
    for (const level of levels) {
      expect(metaEntries.has(level)).toBe(false);
    }
  });

  // Ассерты выше проверяют селекторы по копии в константах. Без этой сверки
  // сужение селектора в самой таблице стилей прошло бы молча: разметка бы
  // соответствовала игре, тесты остались бы зелёными, а кнопки потеряли размер.
  // Сверяются разобранные браузером селекторы, а не текст файла: группировка
  // через запятую и переносы prettier не должны ломать проверку.
  test('проверяемые селекторы стоят в styles.css модуля', () => {
    const style = document.createElement('style');
    style.textContent = readFileSync(join(__dirname, 'styles.css'), 'utf8');
    document.head.appendChild(style);

    const sheet = style.sheet;
    if (!sheet) throw new Error('styles.css не разобрался в CSSOM');
    const selectors = new Set(
      Array.from(sheet.cssRules)
        .filter((rule): rule is CSSStyleRule => rule instanceof CSSStyleRule)
        .flatMap((rule) => rule.selectorText.split(',').map((selector) => selector.trim())),
    );

    expect(selectors).toContain(ACTION_BUTTONS_SELECTOR);
    expect(selectors).toContain(META_ENTRY_SELECTOR);
    expect(selectors).toContain(CORES_LEVEL_SELECTOR);
    expect(selectors).toContain(ACTIVE_FAVORITE_TINT_SELECTOR);
    expect(selectors).toContain(ACTIVE_LOCKED_TINT_SELECTOR);
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

  // Кнопки действий над ключом лежат в попапе инвентаря и попадают под наши
  // селекторы только если те потеряют привязку к .info.popup.
  test('кнопки попапа инвентаря не попадают под селекторы попапа точки', () => {
    document.body.append(createInfoPopup(), createInventoryPopup());

    const inventoryButtons = Array.from(document.querySelectorAll('.inventory.popup button'));
    expect(inventoryButtons.length).toBeGreaterThan(0);

    const pointPopupButtons = new Set<Element>(
      Array.from(document.querySelectorAll(ACTION_BUTTONS_SELECTOR)),
    );
    for (const button of inventoryButtons) {
      expect(pointPopupButtons.has(button)).toBe(false);
    }

    // Кнопка избранного в списке действий над ключом несёт ту же активную
    // звезду, что и кнопка попапа точки, а от подкраски её удерживает один
    // только класс .i-flag-btn в правиле.
    const inventoryStarIcon = document.querySelector(
      '.inventory__ra-item button[data-flag="favorite"]:has(use[href="#fas-star"]) svg',
    );
    if (!inventoryStarIcon) throw new Error('активная звезда отсутствует в фикстуре инвентаря');

    const tinted = Array.from(document.querySelectorAll(ACTIVE_FAVORITE_TINT_SELECTOR));
    expect(tinted).not.toContain(inventoryStarIcon);
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

  /** Иконка кнопки - именно её заливку красит правило подкраски. */
  function readIcon(button: HTMLButtonElement): Element {
    const icon = button.querySelector('svg');
    if (!icon) throw new Error('svg отсутствует в фикстуре кнопки');
    return icon;
  }

  test('подкрашивается иконка активной звезды и не задевается outline', () => {
    const filled = createFlagBtn('favorite', 'fas-star');
    const outline = createFlagBtn('favorite', 'fa-star');
    document.body.append(filled, outline);

    const tinted = Array.from(document.querySelectorAll(ACTIVE_FAVORITE_TINT_SELECTOR));
    expect(tinted).toEqual([readIcon(filled)]);
  });

  test('подкрашивается иконка активного замка и не задевается open', () => {
    const locked = createFlagBtn('locked', 'fas-lock');
    const open = createFlagBtn('locked', 'fas-lock-open');
    document.body.append(locked, open);

    const tinted = Array.from(document.querySelectorAll(ACTIVE_LOCKED_TINT_SELECTOR));
    expect(tinted).toEqual([readIcon(locked)]);
  });
});
