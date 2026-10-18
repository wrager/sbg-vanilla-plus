import { hideLoadingScreenFlavor, showLoadingScreenFlavor } from './loadingScreenFlavor';

declare const __SVP_VERSION__: string;

describe('showLoadingScreenFlavor', () => {
  afterEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '';
  });

  // Селектор внедрённого правила без псевдоэлемента: matches() с ::after
  // невалиден, а проверять надо именно то, к чему правило применится.
  const flavorRuleSelector = (): string => {
    const style = document.getElementById('svp-loading-screen-flavor');
    if (!(style instanceof HTMLStyleElement)) throw new Error('Стиль метки не внедрён');
    const rule = style.sheet?.cssRules[0];
    if (!(rule instanceof CSSStyleRule)) throw new Error('В стиле метки нет правила');
    return rule.selectorText.replace('::after', '');
  };

  it('should add flavor of the script to the loading screen version element', () => {
    showLoadingScreenFlavor();

    const style = document.getElementById('svp-loading-screen-flavor');
    expect(style?.textContent).toBe(
      `.loading-screen__version:not(:empty)::after { content: ', VanillaPlus/${__SVP_VERSION__}'; }`,
    );
  });

  it('should not mark the version element until the game writes its own version', () => {
    showLoadingScreenFlavor();

    const version = document.createElement('div');
    version.className = 'loading-screen__version';
    document.body.appendChild(version);

    expect(version.matches(flavorRuleSelector())).toBe(false);

    version.textContent = 'Stock/0.7.0';

    expect(version.matches(flavorRuleSelector())).toBe(true);
  });

  it('should work before head is parsed', () => {
    const head = document.head;
    head.remove();

    showLoadingScreenFlavor();

    expect(document.getElementById('svp-loading-screen-flavor')).not.toBeNull();

    document.documentElement.prepend(head);
  });

  it('should remove the flavor when hidden', () => {
    showLoadingScreenFlavor();

    hideLoadingScreenFlavor();

    expect(document.getElementById('svp-loading-screen-flavor')).toBeNull();
  });

  it('should not duplicate the style element on repeated call', () => {
    showLoadingScreenFlavor();
    showLoadingScreenFlavor();

    expect(document.querySelectorAll('#svp-loading-screen-flavor').length).toBe(1);
  });
});
