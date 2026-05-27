import { enhancedPointPopupUi } from './enhancedPointPopupUi';

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
        </div>
        <div class="i-stat__entry"><span>Owner</span></div>
        <div class="i-stat__entry i-stat__cores"><span>Cores</span></div>
      </div>
      <div class="discover i-multi-button">
        <button class="discover-mod" data-wish="2"></button>
        <button id="discover"><span>Discover</span></button>
        <button class="discover-mod" data-wish="3"></button>
      </div>
      <div class="i-buttons">
        <button id="deploy">Deploy</button>
        <button id="repair">Repair</button>
        <button id="draw">Draw</button>
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

  test('.info.popup .i-buttons button матчит только кнопки игровой секции', () => {
    const popup = createInfoPopup();
    document.body.appendChild(popup);

    const matched = popup.querySelectorAll<HTMLElement>('.info.popup .i-buttons button');
    expect(matched.length).toBe(3);
    const ids = Array.from(matched).map((el) => el.id);
    expect(ids).toEqual(['deploy', 'repair', 'draw']);
  });

  test('.i-stat__entry:not(.i-stat__cores) матчит ровно одну строку', () => {
    const popup = createInfoPopup();
    document.body.appendChild(popup);

    const matched = popup.querySelectorAll('.i-stat__entry:not(.i-stat__cores)');
    expect(matched.length).toBe(1);
  });

  test('нативные .i-flag-btn не попадают под селектор для игровых кнопок i-buttons', () => {
    const popup = createInfoPopup();
    document.body.appendChild(popup);

    const flagButtons = Array.from(popup.querySelectorAll('.i-flag-btn'));
    expect(flagButtons.length).toBe(2);
    const gameButtons = new Set<Element>(
      Array.from(popup.querySelectorAll('.info.popup .i-buttons button')),
    );
    for (const flagButton of flagButtons) {
      expect(gameButtons.has(flagButton)).toBe(false);
    }
  });
});
