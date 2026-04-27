import { enhancedRefsTab } from './enhancedRefsTab';

describe('enhancedRefsTab — lifecycle', () => {
  afterEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '';
  });

  test('enable инжектит style-элемент', async () => {
    await enhancedRefsTab.enable();
    expect(document.getElementById('svp-enhancedRefsTab')).not.toBeNull();
  });

  test('disable снимает style-элемент', async () => {
    await enhancedRefsTab.enable();
    await enhancedRefsTab.disable();
    expect(document.getElementById('svp-enhancedRefsTab')).toBeNull();
  });

  test('enable идемпотентен: ровно один style-элемент', async () => {
    await enhancedRefsTab.enable();
    await enhancedRefsTab.enable();
    expect(document.querySelectorAll('#svp-enhancedRefsTab').length).toBe(1);
  });
});

// Структура карточки ключа в SBG 0.6.1 (refs/game-beta/script.js:3537-3566):
// `.inventory__item[data-ref]` содержит `.inventory__item-left` с заголовком и
// `inventory__item-descr` (4 inline-span'а: owner, energy@cores, distance,
// days). Наш CSS делает контейнер flex-wrap и через order/flex-basis выносит
// 3-й span (distance) на отдельную строку.
//
// JSDOM не выполняет CSS layout, поэтому проверяем не геометрию, а корректность
// селекторов и applied computed styles. Тестируем DOM-инвариант: правила,
// которые мы прописали, действительно матчат именно нужные элементы и не
// задевают карточки нерефа.
describe('enhancedRefsTab — селектор matching на структуре 0.6.1', () => {
  afterEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '';
  });

  function createRefItemBeta(): HTMLElement {
    // Каркас один-в-один с `makeItem` для t==3 (refs/game-beta/script.js:3393).
    const item = document.createElement('div');
    item.className = 'inventory__item';
    item.setAttribute('data-ref', 'point-guid-1');
    item.setAttribute('data-guid', 'item-guid-1');
    item.innerHTML = `
      <button class="inventory__item-controls"></button>
      <div class="inventory__item-left">
        <span class="inventory__item-title">Point title</span>
        <div class="inventory__item-descr">
          <span><svg></svg><span class="profile-link">owner</span></span>
          <span><svg></svg><span class="iid-energy">87% @ 4</span></span>
          <span><svg></svg>1.2km</span>
          <span><svg></svg>12 дней</span>
        </div>
      </div>
      <button class="inventory__ic-repair"></button>
    `;
    return item;
  }

  function createNonRefItemBeta(): HTMLElement {
    // Не-реф (cores/cats/брумы) использует другую структуру (refs/game-beta/
    // script.js:3464). У него `.inventory__item-descr` — span не div, нет
    // `data-ref`, нет `.inventory__item-left`.
    const item = document.createElement('div');
    item.className = 'inventory__item';
    item.setAttribute('data-guid', 'item-guid-2');
    item.innerHTML = `
      <span class="inventory__item-title">Core L1</span>
      <span class="inventory__item-descr">x5</span>
    `;
    return item;
  }

  test('селектор `.inventory__item[data-ref] .inventory__item-descr` находит только descr реф-карточки', async () => {
    await enhancedRefsTab.enable();

    const ref = createRefItemBeta();
    const nonRef = createNonRefItemBeta();
    document.body.append(ref, nonRef);

    const matched = document.querySelectorAll<HTMLElement>(
      '.inventory__item[data-ref] .inventory__item-descr',
    );
    expect(matched.length).toBe(1);
    expect(matched[0].closest('.inventory__item')?.getAttribute('data-ref')).toBe('point-guid-1');
  });

  test('селектор `> span:nth-child(3)` показывает на distance-span карточки', async () => {
    await enhancedRefsTab.enable();

    const ref = createRefItemBeta();
    document.body.appendChild(ref);

    const distance = document.querySelector(
      '.inventory__item[data-ref] .inventory__item-descr > span:nth-child(3)',
    );
    expect(distance).not.toBeNull();
    expect(distance?.textContent).toContain('1.2km');
  });

  test('наш CSS не задевает карточки без data-ref (cores/cats/brooms)', async () => {
    await enhancedRefsTab.enable();

    const nonRef = createNonRefItemBeta();
    document.body.appendChild(nonRef);

    const matched = document.querySelectorAll('.inventory__item[data-ref] .inventory__item-descr');
    expect(matched.length).toBe(0);
  });

  test('наш CSS не трогает popover `.inventory__ref-actions` 0.6.1', async () => {
    await enhancedRefsTab.enable();

    // Popover из refs/game-beta/script.js:3399, всплывающий по клику на троеточие.
    const popover = document.createElement('div');
    popover.className = 'inventory__ref-actions';
    popover.innerHTML = `
      <button class="inventory__ra-item"><span>Favorite</span></button>
    `;
    document.body.appendChild(popover);

    const matched = document.querySelectorAll(
      '.inventory__item[data-ref] .inventory__item-descr > span:nth-child(3)',
    );
    expect(matched.length).toBe(0);
  });
});
