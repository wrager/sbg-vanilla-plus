import { hideLoadingScreenFlavor, showLoadingScreenFlavor } from './loadingScreenFlavor';

declare const __SVP_VERSION__: string;

describe('showLoadingScreenFlavor', () => {
  afterEach(() => {
    document.head.innerHTML = '';
  });

  it('should add flavor of the script to the loading screen version element', () => {
    showLoadingScreenFlavor();

    const style = document.getElementById('svp-loading-screen-flavor');
    expect(style?.textContent).toBe(
      `.loading-screen__version::after { content: ', VanillaPlus/${__SVP_VERSION__}'; }`,
    );
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
