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

// В SBG 0.6.1 внутри `.info.popup` появились новые блоки — `.inventory__ref-actions`
// (popover с кнопками fav/lock) и `.inventory__manage-amount` (выбор количества
// для удаления N ключей от точки). Наш CSS-модуль стилизует узкий набор
// селекторов (`.info.popup .i-buttons button`, `.i-stat__entry`,
// `.cores-list__level`, `#magic-deploy-btn`), и задевать новые блоки он
// не должен. Тесты проверяют, что наши селекторы не матчатся на
// кнопки/элементы новых блоков — иначе игровой UX сломается стилями
// нашего модуля.
describe('enhancedPointPopupUi — изоляция от новых блоков SBG 0.6.1', () => {
  afterEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '';
  });

  function createInfoPopupBeta(): HTMLElement {
    const popup = document.createElement('div');
    popup.className = 'info popup';
    popup.innerHTML = `
      <div class="i-header">
        <span class="i-title">Test point</span>
      </div>
      <div class="i-stats">
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
      <!-- Новое в 0.6.1 — popover действий над ключом, клонируется в попап -->
      <div class="inventory__ref-actions popover hidden">
        <div class="inventory__ra-item"><button data-flag="favorite"><span>Fav</span></button></div>
        <div class="inventory__ra-item"><button data-flag="locked"><span>Lock</span></button></div>
      </div>
      <!-- Новое в 0.6.1 — блок выбора количества для массовых операций над ключом -->
      <div class="inventory__manage-amount hidden">
        <span class="inventory__ma-item"></span>
        <input class="inventory__ma-amount" type="number" value="1">
        <span class="inventory__ma-max">10</span>
        <div class="inventory__ma-counter">
          <button>−</button>
          <button>+</button>
        </div>
        <button class="inventory__ma-delete">Delete</button>
        <button class="inventory__ma-use">Use</button>
        <button class="inventory__ma-cancel">Cancel</button>
      </div>
    `;
    return popup;
  }

  test('.info.popup .i-buttons button матчит только кнопки игровой секции', () => {
    const popup = createInfoPopupBeta();
    document.body.appendChild(popup);

    const matched = popup.querySelectorAll<HTMLElement>('.info.popup .i-buttons button');
    expect(matched.length).toBe(3);
    const ids = Array.from(matched).map((el) => el.id);
    expect(ids).toEqual(['deploy', 'repair', 'draw']);
  });

  test('новые блоки ref-actions и manage-amount не попадают под наши селекторы', () => {
    const popup = createInfoPopupBeta();
    document.body.appendChild(popup);

    const raButton = popup.querySelector('.inventory__ra-item button');
    const maUse = popup.querySelector('.inventory__ma-use');
    if (raButton === null) throw new Error('ref-actions button not rendered');
    if (maUse === null) throw new Error('manage-amount use button not rendered');

    const ourButtons = popup.querySelectorAll('.info.popup .i-buttons button, #magic-deploy-btn');
    const ourSet = new Set<Element>(Array.from(ourButtons));
    expect(ourSet.has(raButton)).toBe(false);
    expect(ourSet.has(maUse)).toBe(false);
  });

  test('.i-stat__entry:not(.i-stat__cores) матчит ровно одну строку', () => {
    const popup = createInfoPopupBeta();
    document.body.appendChild(popup);

    const matched = popup.querySelectorAll('.i-stat__entry:not(.i-stat__cores)');
    expect(matched.length).toBe(1);
  });
});

describe('enhancedPointPopupUi — защита wand button', () => {
  afterEach(async () => {
    await enhancedPointPopupUi.disable();
    document.head.innerHTML = '';
    document.body.innerHTML = '';
  });

  test('wand button styles не инжектируются при отсутствии #magic-deploy-btn', async () => {
    await enhancedPointPopupUi.enable();
    expect(document.getElementById('svp-enhancedPointPopupUi-wand')).toBeNull();
  });

  test('wand button styles инжектируются при наличии #magic-deploy-btn', async () => {
    const button = document.createElement('button');
    button.id = 'magic-deploy-btn';
    document.body.appendChild(button);
    await enhancedPointPopupUi.enable();
    expect(document.getElementById('svp-enhancedPointPopupUi-wand')).not.toBeNull();
  });

  test('wand button styles инжектируются когда #magic-deploy-btn появляется после enable', async () => {
    await enhancedPointPopupUi.enable();
    expect(document.getElementById('svp-enhancedPointPopupUi-wand')).toBeNull();
    const button = document.createElement('button');
    button.id = 'magic-deploy-btn';
    document.body.appendChild(button);
    await Promise.resolve();
    expect(document.getElementById('svp-enhancedPointPopupUi-wand')).not.toBeNull();
  });

  test('wand button styles удаляются когда #magic-deploy-btn исчезает из DOM', async () => {
    const button = document.createElement('button');
    button.id = 'magic-deploy-btn';
    document.body.appendChild(button);
    await enhancedPointPopupUi.enable();
    expect(document.getElementById('svp-enhancedPointPopupUi-wand')).not.toBeNull();
    document.body.removeChild(button);
    await Promise.resolve();
    expect(document.getElementById('svp-enhancedPointPopupUi-wand')).toBeNull();
  });

  test('disable удаляет wand button styles', async () => {
    const button = document.createElement('button');
    button.id = 'magic-deploy-btn';
    document.body.appendChild(button);
    await enhancedPointPopupUi.enable();
    expect(document.getElementById('svp-enhancedPointPopupUi-wand')).not.toBeNull();
    await enhancedPointPopupUi.disable();
    expect(document.getElementById('svp-enhancedPointPopupUi-wand')).toBeNull();
  });
});
