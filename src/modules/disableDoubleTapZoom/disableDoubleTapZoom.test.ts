import { disableDoubleTapZoom } from './disableDoubleTapZoom';

function getViewport(): Element {
  const el = document.querySelector('.ol-viewport');
  if (!el) throw new Error('.ol-viewport not found');
  return el;
}

function dispatchPointerDown(target: Element): Event {
  const event = new Event('pointerdown', { bubbles: false });
  jest.spyOn(event, 'stopImmediatePropagation');
  target.dispatchEvent(event);
  return event;
}

describe('disableDoubleTapZoom', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div class="ol-viewport"></div>';
  });

  afterEach(async () => {
    await disableDoubleTapZoom.disable();
    document.body.innerHTML = '';
    jest.restoreAllMocks();
  });

  test('does not block first tap', async () => {
    await disableDoubleTapZoom.enable();
    const event = dispatchPointerDown(getViewport());
    expect(event.stopImmediatePropagation).not.toHaveBeenCalled();
  });

  test('blocks second tap within threshold', async () => {
    await disableDoubleTapZoom.enable();
    const now = Date.now();
    jest
      .spyOn(Date, 'now')
      .mockReturnValueOnce(now)
      .mockReturnValueOnce(now + 100);

    dispatchPointerDown(getViewport());
    const second = dispatchPointerDown(getViewport());
    expect(second.stopImmediatePropagation).toHaveBeenCalled();
  });

  test('does not block second tap after threshold', async () => {
    await disableDoubleTapZoom.enable();
    const now = Date.now();
    jest
      .spyOn(Date, 'now')
      .mockReturnValueOnce(now)
      .mockReturnValueOnce(now + 400);

    dispatchPointerDown(getViewport());
    const second = dispatchPointerDown(getViewport());
    expect(second.stopImmediatePropagation).not.toHaveBeenCalled();
  });

  test('disable removes the listener', async () => {
    await disableDoubleTapZoom.enable();
    await disableDoubleTapZoom.disable();

    const now = Date.now();
    jest
      .spyOn(Date, 'now')
      .mockReturnValueOnce(now)
      .mockReturnValueOnce(now + 100);

    dispatchPointerDown(getViewport());
    const second = dispatchPointerDown(getViewport());
    expect(second.stopImmediatePropagation).not.toHaveBeenCalled();
  });

  test('enable before viewport is ready applies listener once viewport appears', async () => {
    document.body.innerHTML = '';
    disableDoubleTapZoom.init();
    await disableDoubleTapZoom.enable();

    const viewport = document.createElement('div');
    viewport.className = 'ol-viewport';
    document.body.appendChild(viewport);
    await new Promise((r) => setTimeout(r, 0));

    const now = Date.now();
    jest
      .spyOn(Date, 'now')
      .mockReturnValueOnce(now)
      .mockReturnValueOnce(now + 100);

    dispatchPointerDown(viewport);
    const second = dispatchPointerDown(viewport);
    expect(second.stopImmediatePropagation).toHaveBeenCalled();
  });
});
