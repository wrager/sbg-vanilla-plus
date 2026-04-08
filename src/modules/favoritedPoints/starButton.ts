import { waitForElement } from '../../core/dom';
import { t } from '../../core/l10n';
import {
  addFavorite,
  isFavorited,
  removeFavorite,
  FAVORITES_CHANGED_EVENT,
} from '../../core/favoritesStore';

const STAR_CLASS = 'svp-fav-star';
const POPUP_SELECTOR = '.info.popup';
const IMAGE_BOX_SELECTOR = '.i-image-box';

// Стандартная 5-конечная звезда (FontAwesome path). Мы используем два визуально
// различимых состояния: `is-filled` (избранное) и обычное (не избранное).
const STAR_SVG = `
<svg viewBox="0 0 576 512" width="20" height="20" aria-hidden="true">
  <path d="M287.9 0c9.2 0 17.6 5.2 21.6 13.5l68.6 141.3 153.2 22.6c9 1.3 16.5 7.6 19.3 16.3s.5 18.1-6 24.5L433.6 328.4l26.2 155.6c1.5 9-2.2 18.1-9.7 23.5s-17.3 6-25.3 1.7l-137-73.2L151 509.1c-8.1 4.3-17.9 3.7-25.3-1.7s-11.2-14.5-9.7-23.5l26.2-155.6L31.1 218.2c-6.5-6.4-8.7-15.9-6-24.5s10.3-15 19.3-16.3l153.2-22.6L266.3 13.5C270.4 5.2 278.7 0 287.9 0z"/>
</svg>
`;

let popupObserver: MutationObserver | null = null;
let clickAbortController: AbortController | null = null;
let changeHandler: (() => void) | null = null;
// Инкрементируется при каждом install/uninstall. Если waitForElement.then()
// срабатывает после uninstall (async race), generation уже другой — skip.
let installGeneration = 0;

function findStarButton(popup: Element): HTMLButtonElement | null {
  return popup.querySelector<HTMLButtonElement>(`.${STAR_CLASS}`);
}

function getCurrentGuid(popup: Element): string | null {
  if (popup.classList.contains('hidden')) return null;
  if (!(popup instanceof HTMLElement)) return null;
  const guid = popup.dataset.guid;
  return guid && guid.length > 0 ? guid : null;
}

function updateButtonState(button: HTMLButtonElement, guid: string | null): void {
  if (guid === null) {
    button.classList.remove('is-filled');
    button.title = '';
    button.disabled = true;
    return;
  }
  button.disabled = false;
  const favorited = isFavorited(guid);
  button.classList.toggle('is-filled', favorited);
  button.title = favorited
    ? t({ en: 'Remove from favorites', ru: 'Убрать из избранного' })
    : t({ en: 'Add to favorites', ru: 'Добавить в избранное' });
  button.setAttribute('aria-pressed', favorited ? 'true' : 'false');
}

function injectStarButton(popup: Element): void {
  const imageBox = popup.querySelector(IMAGE_BOX_SELECTOR);
  if (!imageBox) return;
  if (findStarButton(popup)) {
    // Кнопка уже вставлена — только обновить состояние.
    const button = findStarButton(popup);
    if (button) updateButtonState(button, getCurrentGuid(popup));
    return;
  }

  const button = document.createElement('button');
  button.className = STAR_CLASS;
  button.type = 'button';
  button.innerHTML = STAR_SVG;
  button.setAttribute('aria-pressed', 'false');

  clickAbortController = new AbortController();
  button.addEventListener(
    'click',
    (event) => {
      event.stopPropagation();
      event.preventDefault();
      void onStarClick(popup, button);
    },
    { signal: clickAbortController.signal },
  );

  // Вставляем сразу после #i-ref (количество ключей), чтобы звезда
  // была справа от текста. CSS сдвигает #i-ref левее на размер звезды.
  const refSpan = imageBox.querySelector('#i-ref');
  if (refSpan) {
    refSpan.after(button);
  } else {
    imageBox.appendChild(button);
  }
  updateButtonState(button, getCurrentGuid(popup));
}

async function onStarClick(popup: Element, button: HTMLButtonElement): Promise<void> {
  const guid = getCurrentGuid(popup);
  if (guid === null) return;
  button.disabled = true;
  try {
    if (isFavorited(guid)) {
      await removeFavorite(guid);
    } else {
      await addFavorite(guid);
    }
    updateButtonState(button, getCurrentGuid(popup));
  } catch (error) {
    console.error('[SVP favoritedPoints] ошибка сохранения избранного:', error);
    updateButtonState(button, getCurrentGuid(popup));
  }
}

function startObserving(popup: Element): void {
  injectStarButton(popup);

  popupObserver = new MutationObserver(() => {
    injectStarButton(popup);
  });
  // Следим ТОЛЬКО за атрибутами самого попапа (class, data-guid).
  // subtree:true вызывает бесконечный цикл: updateButtonState меняет атрибуты
  // кнопки → observer срабатывает → снова updateButtonState → и так до зависания.
  popupObserver.observe(popup, {
    attributes: true,
    attributeFilter: ['class', 'data-guid'],
  });

  // Синхронизация с внешними изменениями (debug API, фильтр инвентаря, импорт).
  changeHandler = (): void => {
    injectStarButton(popup);
  };
  document.addEventListener(FAVORITES_CHANGED_EVENT, changeHandler);
}

export function installStarButton(): void {
  // Идемпотентность: если уже установлено — не дублировать observer.
  if (popupObserver) return;
  installGeneration++;
  const generation = installGeneration;
  const existing = document.querySelector(POPUP_SELECTOR);
  if (existing) {
    startObserving(existing);
    return;
  }
  // Попап может ещё не появиться в DOM к моменту enable().
  waitForElement(POPUP_SELECTOR)
    .then((popup) => {
      // Если uninstall() вызван до resolve — generation изменился, пропускаем.
      if (generation !== installGeneration) return;
      startObserving(popup);
    })
    .catch((error: unknown) => {
      console.warn('[SVP favoritedPoints] попап точки не найден:', error);
    });
}

export function uninstallStarButton(): void {
  installGeneration++;
  popupObserver?.disconnect();
  popupObserver = null;
  clickAbortController?.abort();
  clickAbortController = null;
  if (changeHandler) {
    document.removeEventListener(FAVORITES_CHANGED_EVENT, changeHandler);
    changeHandler = null;
  }
  document.querySelector(`.${STAR_CLASS}`)?.remove();
}

/** После изменений в избранных из других мест — обновить визуальное состояние кнопки. */
export function refreshStarButton(): void {
  const popup = document.querySelector(POPUP_SELECTOR);
  if (!popup) return;
  const button = findStarButton(popup);
  if (button) updateButtonState(button, getCurrentGuid(popup));
}
