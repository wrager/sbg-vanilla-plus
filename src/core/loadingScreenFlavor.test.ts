import { showLoadingScreenFlavor } from './loadingScreenFlavor';

declare const __SVP_VERSION__: string;

describe('showLoadingScreenFlavor', () => {
  afterEach(() => {
    document.head.innerHTML = '';
  });

  it('should add flavor of the script to the loading screen version element', () => {
    showLoadingScreenFlavor();

    const style = document.getElementById('svp-loading-screen-flavor');
    expect(style?.textContent).toBe(
      `.loading-screen__version::after { content: ' VanillaPlus/${__SVP_VERSION__}'; }`,
    );
  });

  it('should not duplicate the style element on repeated call', () => {
    showLoadingScreenFlavor();
    showLoadingScreenFlavor();

    expect(document.querySelectorAll('#svp-loading-screen-flavor').length).toBe(1);
  });
});
