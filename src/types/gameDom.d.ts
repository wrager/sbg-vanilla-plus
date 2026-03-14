/** Known DOM elements in SBG game UI */

interface ISbgPointPopup extends HTMLElement {
  querySelector(
    selector: '.discover-btn' | '.deploy-btn' | '.draw-btn' | '.repair-btn',
  ): HTMLButtonElement | null;
}
