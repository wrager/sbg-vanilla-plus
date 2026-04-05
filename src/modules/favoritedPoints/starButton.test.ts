import { installStarButton, uninstallStarButton } from './starButton';
import { addFavorite, loadFavorites, isFavorited, resetForTests } from './favoritesStore';

const STAR_CLASS = 'svp-fav-star';

async function resetIdb(): Promise<void> {
  resetForTests();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase('CUI');
    request.onsuccess = (): void => {
      resolve();
    };
    request.onerror = (): void => {
      reject(request.error instanceof Error ? request.error : new Error('delete failed'));
    };
    request.onblocked = (): void => {
      resolve();
    };
  });
}

function createPopupDom(guid: string | null, hidden = false): HTMLElement {
  const popup = document.createElement('div');
  popup.className = hidden ? 'info popup hidden' : 'info popup';
  if (guid !== null) popup.dataset.guid = guid;
  const imageBox = document.createElement('div');
  imageBox.className = 'i-image-box';
  popup.appendChild(imageBox);
  document.body.appendChild(popup);
  return popup;
}

function getStar(popup: HTMLElement): HTMLButtonElement | null {
  return popup.querySelector<HTMLButtonElement>(`.${STAR_CLASS}`);
}

/** MutationObserver асинхронен — ждём микротаску. */
async function flushMutations(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

/** IDB-операции (fake-indexeddb) требуют прогонки макротасок. */
async function flushIdb(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}

afterEach(() => {
  uninstallStarButton();
  document.body.innerHTML = '';
});

describe('starButton', () => {
  beforeEach(async () => {
    await resetIdb();
    await loadFavorites();
  });

  test('инъектит звезду в открытый попап', () => {
    const popup = createPopupDom('guid-1');
    installStarButton();
    expect(getStar(popup)).not.toBeNull();
  });

  test('звезда не заполнена для не-избранной точки', () => {
    const popup = createPopupDom('guid-1');
    installStarButton();
    const star = getStar(popup);
    expect(star?.classList.contains('is-filled')).toBe(false);
    expect(star?.getAttribute('aria-pressed')).toBe('false');
  });

  test('звезда заполнена для избранной точки', async () => {
    await addFavorite('guid-1');
    const popup = createPopupDom('guid-1');
    installStarButton();
    const star = getStar(popup);
    expect(star?.classList.contains('is-filled')).toBe(true);
    expect(star?.getAttribute('aria-pressed')).toBe('true');
  });

  test('клик по звезде добавляет точку в избранные', async () => {
    const popup = createPopupDom('guid-1');
    installStarButton();
    const star = getStar(popup);
    expect(star).not.toBeNull();
    star?.click();
    // Ждём async addFavorite.
    await flushIdb();
    expect(isFavorited('guid-1')).toBe(true);
    expect(star?.classList.contains('is-filled')).toBe(true);
  });

  test('повторный клик убирает точку из избранных', async () => {
    await addFavorite('guid-1');
    const popup = createPopupDom('guid-1');
    installStarButton();
    const star = getStar(popup);
    star?.click();
    await flushIdb();
    expect(isFavorited('guid-1')).toBe(false);
    expect(star?.classList.contains('is-filled')).toBe(false);
  });

  test('смена data-guid обновляет состояние звезды', async () => {
    await addFavorite('guid-1');
    const popup = createPopupDom('guid-2');
    installStarButton();
    const star = getStar(popup);
    expect(star?.classList.contains('is-filled')).toBe(false);

    // Симулируем открытие другой точки — игра меняет data-guid.
    popup.dataset.guid = 'guid-1';
    await flushMutations();

    expect(star?.classList.contains('is-filled')).toBe(true);
  });

  test('popup с hidden не даёт клику изменить состояние', async () => {
    const popup = createPopupDom('guid-1', true);
    installStarButton();
    const star = getStar(popup);
    expect(star?.disabled).toBe(true);
    star?.click();
    await flushIdb();
    expect(isFavorited('guid-1')).toBe(false);
  });

  test('uninstall удаляет звезду и отключает observer', async () => {
    const popup = createPopupDom('guid-1');
    installStarButton();
    expect(getStar(popup)).not.toBeNull();

    uninstallStarButton();
    expect(getStar(popup)).toBeNull();

    // После uninstall смена data-guid не должна реинъектить кнопку.
    popup.dataset.guid = 'guid-2';
    await flushMutations();
    expect(getStar(popup)).toBeNull();
  });

  test('двойная инъекция не создаёт вторую кнопку', () => {
    const popup = createPopupDom('guid-1');
    installStarButton();
    installStarButton();
    // Даже после повторных open/close не должно плодиться.
    popup.dataset.guid = 'guid-2';
    const stars = popup.querySelectorAll(`.${STAR_CLASS}`);
    expect(stars).toHaveLength(1);
  });
});
