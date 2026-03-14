import { injectStyles, removeStyles, $, $$ } from '../../src/core/dom';

describe('dom', () => {
  afterEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '';
  });

  test('injectStyles adds a style element to head', () => {
    injectStyles('body { color: red; }', 'test');

    const style = document.getElementById('svp-test');
    expect(style).not.toBeNull();
    expect(style?.tagName).toBe('STYLE');
    expect(style?.textContent).toBe('body { color: red; }');
  });

  test('injectStyles replaces existing style with same id', () => {
    injectStyles('body { color: red; }', 'test');
    injectStyles('body { color: blue; }', 'test');

    const styles = document.querySelectorAll('#svp-test');
    expect(styles.length).toBe(1);
    const style = styles[0] as HTMLStyleElement;
    expect(style.textContent).toBe('body { color: blue; }');
  });

  test('removeStyles removes the style element', () => {
    injectStyles('body { color: red; }', 'test');
    removeStyles('test');

    expect(document.getElementById('svp-test')).toBeNull();
  });

  test('$ returns first matching element', () => {
    document.body.innerHTML = '<div class="a"></div><div class="a"></div>';
    expect($('.a')).toBe(document.body.querySelector('.a'));
  });

  test('$$ returns all matching elements', () => {
    document.body.innerHTML = '<div class="a"></div><div class="a"></div>';
    expect($$('.a').length).toBe(2);
  });
});
