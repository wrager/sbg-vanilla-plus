import { enhancedMainScreen } from './enhancedMainScreen';

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
globalThis.ResizeObserver = ResizeObserverStub;

const TOPLEFT_HTML = `
<div class="topleft-container">
  <div class="self-info">
    <div class="self-info__entry">Name: <span id="self-info__name">wrager</span></div>
    <div class="self-info__entry">EXP: <span id="self-info__exp">16,903,250</span></div>
    <div class="self-info__entry">Inventory: <span id="self-info__inv">2812</span> / <span id="self-info__inv-lim">3000</span></div>
  </div>
  <div class="game-menu">
    <button id="ops">OPS</button>
    <button id="score">Score</button>
    <button id="leaderboard">Leaderboard</button>
    <button id="settings">Settings</button>
  </div>
  <div class="effects"></div>
</div>`;

function flushPromises(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function mousedown(el: Element): void {
  el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
}

function getEntryFor(id: string): HTMLElement | null {
  const el = document.getElementById(id)?.closest('.self-info__entry');
  return el instanceof HTMLElement ? el : null;
}

describe('enhancedMainScreen', () => {
  beforeEach(() => {
    document.body.innerHTML = TOPLEFT_HTML;
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

  test('hides all entries and extra buttons by default', async () => {
    await enhancedMainScreen.enable();
    await flushPromises();

    expect(getEntryFor('self-info__name')?.style.display).toBe('none');
    expect(getEntryFor('self-info__exp')?.style.display).toBe('none');
    expect(getEntryFor('self-info__inv')?.style.display).toBe('none');
    expect(document.getElementById('score')?.style.display).toBe('none');
    expect(document.getElementById('ops')?.style.display).not.toBe('none');
  });

  test('shows summary, expand button and hides toggle when collapsed', async () => {
    await enhancedMainScreen.enable();
    await flushPromises();

    const summary = document.getElementById('svp-inv-summary');
    expect(summary?.textContent).toBe('2812/3000');
    expect(summary?.style.display).not.toBe('none');

    const toggle = document.getElementById('svp-top-toggle');
    expect(toggle?.style.display).toBe('none');

    const expandBtn = document.getElementById('svp-top-expand');
    expect(expandBtn?.style.display).not.toBe('none');
    expect(expandBtn?.textContent).toBe('▼');
  });

  test('expands on container mousedown (not OPS)', async () => {
    await enhancedMainScreen.enable();
    await flushPromises();

    const summary = document.getElementById('svp-inv-summary');
    if (!summary) throw new Error('summary not found');
    mousedown(summary);

    const container = document.querySelector('.topleft-container');
    expect(container?.classList.contains('svp-collapsed')).toBe(false);
    expect(getEntryFor('self-info__name')?.style.display).toBe('');

    // Toggle visible, expand button hidden when expanded
    expect(document.getElementById('svp-top-toggle')?.style.display).toBe('');
    expect(document.getElementById('svp-top-expand')?.style.display).toBe('none');
  });

  test('expands on expand button mousedown', async () => {
    await enhancedMainScreen.enable();
    await flushPromises();

    const expandBtn = document.getElementById('svp-top-expand');
    if (!expandBtn) throw new Error('expand button not found');
    mousedown(expandBtn);

    const container = document.querySelector('.topleft-container');
    expect(container?.classList.contains('svp-collapsed')).toBe(false);
    expect(expandBtn.style.display).toBe('none');
  });

  test('does not expand when clicking OPS', async () => {
    await enhancedMainScreen.enable();
    await flushPromises();

    const ops = document.getElementById('ops');
    if (!ops) throw new Error('ops not found');
    mousedown(ops);

    const container = document.querySelector('.topleft-container');
    expect(container?.classList.contains('svp-collapsed')).toBe(true);
  });

  test('collapses on toggle mousedown', async () => {
    await enhancedMainScreen.enable();
    await flushPromises();

    // Expand first
    const summary = document.getElementById('svp-inv-summary');
    if (!summary) throw new Error('summary not found');
    mousedown(summary);

    // Collapse via toggle
    const toggle = document.getElementById('svp-top-toggle');
    if (!toggle) throw new Error('toggle not found');
    mousedown(toggle);

    const container = document.querySelector('.topleft-container');
    expect(container?.classList.contains('svp-collapsed')).toBe(true);
    expect(toggle.style.display).toBe('none');
  });

  test('mirrors inventory overflow color to summary', async () => {
    await enhancedMainScreen.enable();
    await flushPromises();

    const invEntry = getEntryFor('self-info__inv');
    if (!invEntry) throw new Error('inv entry not found');
    const summary = document.getElementById('svp-inv-summary');
    if (!summary) throw new Error('summary not found');

    // Игра ставит color на .self-info__entry при переполнении (jQuery .css())
    // jsdom не поддерживает var() в CSSOM, поэтому тестируем с обычным цветом
    invEntry.style.color = 'red';
    await flushPromises();
    expect(summary.style.color).toBe('red');

    // Игра сбрасывает color когда инвентарь не переполнен
    invEntry.style.color = '';
    await flushPromises();
    expect(summary.style.color).toBe('');
  });

  test('cleans up on disable', async () => {
    await enhancedMainScreen.enable();
    await flushPromises();

    await enhancedMainScreen.disable();

    const container = document.querySelector('.topleft-container');
    expect(container?.classList.contains('svp-collapsed')).toBe(false);
    expect(document.getElementById('svp-top-toggle')).toBeNull();
    expect(document.getElementById('svp-top-expand')).toBeNull();
    expect(document.getElementById('svp-inv-summary')).toBeNull();
    expect(document.getElementById('svp-enhancedMainScreen')).toBeNull();
    expect(getEntryFor('self-info__name')?.style.display).toBe('');
  });
});
