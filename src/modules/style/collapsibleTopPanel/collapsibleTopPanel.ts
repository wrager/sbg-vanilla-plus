import type { IFeatureModule } from '../../../core/moduleRegistry';
import { $, $$, injectStyles, removeStyles, waitForElement } from '../../../core/dom';
import css from './styles.css?inline';

const MODULE_ID = 'collapsibleTopPanel';
const SUMMARY_ID = 'svp-inv-summary';
const TOGGLE_ID = 'svp-top-toggle';
const EXPAND_ID = 'svp-top-expand';

let cleanup: (() => void) | null = null;

function createSummary(container: Element): HTMLSpanElement {
  const invSpan = $('#self-info__inv', container);
  const limSpan = $('#self-info__inv-lim', container);

  const summary = document.createElement('span');
  summary.id = SUMMARY_ID;

  const update = () => {
    const inv = invSpan?.textContent ?? '?';
    const lim = limSpan?.textContent ?? '?';
    summary.textContent = `${inv}/${lim}`;
  };

  update();

  const observer = new MutationObserver(update);
  if (invSpan) observer.observe(invSpan, { childList: true, characterData: true, subtree: true });
  if (limSpan) observer.observe(limSpan, { childList: true, characterData: true, subtree: true });

  return summary;
}

function isHTMLElement(el: unknown): el is HTMLElement {
  return el instanceof HTMLElement;
}

async function setup(): Promise<() => void> {
  const container = await waitForElement('.topleft-container');
  if (!isHTMLElement(container)) return () => {};
  const selfInfo = $('.self-info', container);
  if (!isHTMLElement(selfInfo)) return () => {};
  const opsBtn = $('#ops', container);
  if (!isHTMLElement(opsBtn)) return () => {};

  const allEntries = $$('.self-info__entry', container).filter(isHTMLElement);
  const extraButtons = $$('.game-menu button:not(#ops)', container).filter(isHTMLElement);
  const effects = $('.effects', container);
  const hiddenEls = [...allEntries, ...extraButtons, ...(isHTMLElement(effects) ? [effects] : [])];

  // Кнопка сворачивания — в body, чтобы игра не перехватывала клики
  const toggle = document.createElement('div');
  toggle.id = TOGGLE_ID;
  toggle.textContent = '▲';
  document.body.appendChild(toggle);

  // Кнопка разворачивания — в body, чтобы игра не перехватывала клики
  const expandBtn = document.createElement('div');
  expandBtn.id = EXPAND_ID;
  expandBtn.textContent = '▼';
  document.body.appendChild(expandBtn);

  const summary = createSummary(container);
  selfInfo.appendChild(summary);

  let collapsed = false;

  const positionToggle = () => {
    const rect = container.getBoundingClientRect();
    toggle.style.top = `${rect.top + 4}px`;
    toggle.style.left = `${rect.right - toggle.offsetWidth - 4}px`;
  };

  const positionExpand = () => {
    const opsRect = opsBtn.getBoundingClientRect();
    expandBtn.style.top = `${opsRect.top + (opsRect.height - expandBtn.offsetHeight) / 2}px`;
    expandBtn.style.left = `${opsRect.right + 4}px`;
  };

  // Перепозиционировать кнопку ▼ при изменении размера контейнера
  const resizeObserver = new ResizeObserver(() => {
    if (collapsed) positionExpand();
  });
  resizeObserver.observe(container);

  const setCollapsed = (value: boolean) => {
    collapsed = value;
    for (const el of hiddenEls) {
      el.style.display = collapsed ? 'none' : '';
    }
    summary.style.display = collapsed ? '' : 'none';
    toggle.style.display = collapsed ? 'none' : '';
    expandBtn.style.display = collapsed ? '' : 'none';
    selfInfo.style.border = collapsed ? 'none' : '';
    container.classList.toggle('svp-collapsed', collapsed);
    if (!collapsed) {
      requestAnimationFrame(positionToggle);
    }
  };

  setCollapsed(true);

  // Раскрытие: клик по свёрнутому контейнеру (кроме OPS)
  const onExpand = (e: Event) => {
    if (!collapsed) return;
    const target = e.target;
    if (!(target instanceof Element)) return;
    if (target.closest('#ops')) return;
    e.stopPropagation();
    e.preventDefault();
    setCollapsed(false);
  };

  // Раскрытие: клик по кнопке ▼
  const onExpandBtn = (e: Event) => {
    e.stopPropagation();
    e.preventDefault();
    setCollapsed(false);
  };

  // Сворачивание: клик по кнопке ▲
  const onCollapse = (e: Event) => {
    e.stopPropagation();
    e.preventDefault();
    setCollapsed(true);
  };

  container.addEventListener('touchstart', onExpand, { passive: false });
  container.addEventListener('mousedown', onExpand);
  expandBtn.addEventListener('touchstart', onExpandBtn, { passive: false });
  expandBtn.addEventListener('mousedown', onExpandBtn);
  toggle.addEventListener('touchstart', onCollapse, { passive: false });
  toggle.addEventListener('mousedown', onCollapse);

  return () => {
    resizeObserver.disconnect();
    container.removeEventListener('touchstart', onExpand);
    container.removeEventListener('mousedown', onExpand);
    expandBtn.removeEventListener('touchstart', onExpandBtn);
    expandBtn.removeEventListener('mousedown', onExpandBtn);
    toggle.removeEventListener('touchstart', onCollapse);
    toggle.removeEventListener('mousedown', onCollapse);
    setCollapsed(false);
    toggle.remove();
    expandBtn.remove();
    summary.remove();
  };
}

export const collapsibleTopPanel: IFeatureModule = {
  id: MODULE_ID,
  name: { en: 'Collapsible Top Panel', ru: 'Сворачиваемая верхняя панель' },
  description: {
    en: 'Collapses the top-left panel to show only inventory and OPS button',
    ru: 'Сворачивает верхнюю панель, показывая только инвентарь и кнопку OPS',
  },
  defaultEnabled: true,
  category: 'style',
  init() {},
  enable() {
    injectStyles(css, MODULE_ID);
    void setup().then((fn) => {
      cleanup = fn;
    });
  },
  disable() {
    removeStyles(MODULE_ID);
    cleanup?.();
    cleanup = null;
  },
};
