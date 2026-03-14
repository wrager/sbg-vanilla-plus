import { collapsibleTopPanel } from './collapsibleTopPanel';

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

describe('collapsibleTopPanel', () => {
  beforeEach(() => {
    document.body.innerHTML = TOPLEFT_HTML;
  });

  afterEach(() => {
    collapsibleTopPanel.disable();
    document.body.innerHTML = '';
  });

  test('has correct module metadata', () => {
    expect(collapsibleTopPanel.id).toBe('collapsibleTopPanel');
    expect(collapsibleTopPanel.category).toBe('style');
    expect(collapsibleTopPanel.defaultEnabled).toBe(true);
  });

  test('injects styles on enable', async () => {
    collapsibleTopPanel.enable();
    await flushPromises();

    const style = document.getElementById('svp-collapsibleTopPanel');
    expect(style).not.toBeNull();
    expect(style?.tagName).toBe('STYLE');
  });

  test('hides all entries and extra buttons by default', async () => {
    collapsibleTopPanel.enable();
    await flushPromises();

    expect(getEntryFor('self-info__name')?.style.display).toBe('none');
    expect(getEntryFor('self-info__exp')?.style.display).toBe('none');
    expect(getEntryFor('self-info__inv')?.style.display).toBe('none');
    expect(document.getElementById('score')?.style.display).toBe('none');
    expect(document.getElementById('ops')?.style.display).not.toBe('none');
  });

  test('shows summary and hides toggle when collapsed', async () => {
    collapsibleTopPanel.enable();
    await flushPromises();

    const summary = document.getElementById('svp-inv-summary');
    expect(summary?.textContent).toBe('2812/3000');
    expect(summary?.style.display).not.toBe('none');

    const toggle = document.getElementById('svp-top-toggle');
    expect(toggle?.style.display).toBe('none');
  });

  test('expands on container mousedown (not OPS)', async () => {
    collapsibleTopPanel.enable();
    await flushPromises();

    const summary = document.getElementById('svp-inv-summary');
    if (!summary) throw new Error('summary not found');
    mousedown(summary);

    const container = document.querySelector('.topleft-container');
    expect(container?.classList.contains('svp-collapsed')).toBe(false);
    expect(getEntryFor('self-info__name')?.style.display).toBe('');

    // Toggle visible when expanded
    expect(document.getElementById('svp-top-toggle')?.style.display).toBe('');
  });

  test('does not expand when clicking OPS', async () => {
    collapsibleTopPanel.enable();
    await flushPromises();

    const ops = document.getElementById('ops');
    if (!ops) throw new Error('ops not found');
    mousedown(ops);

    const container = document.querySelector('.topleft-container');
    expect(container?.classList.contains('svp-collapsed')).toBe(true);
  });

  test('collapses on toggle mousedown', async () => {
    collapsibleTopPanel.enable();
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

  test('cleans up on disable', async () => {
    collapsibleTopPanel.enable();
    await flushPromises();

    collapsibleTopPanel.disable();

    const container = document.querySelector('.topleft-container');
    expect(container?.classList.contains('svp-collapsed')).toBe(false);
    expect(document.getElementById('svp-top-toggle')).toBeNull();
    expect(document.getElementById('svp-inv-summary')).toBeNull();
    expect(document.getElementById('svp-collapsibleTopPanel')).toBeNull();
    expect(getEntryFor('self-info__name')?.style.display).toBe('');
  });
});
