/**
 * Доступ к i18n игры для подмены подписей игровых элементов.
 *
 * i18next и плагин jqueryI18next игра подключает обычными <script>
 * (refs/game/index.html:27-28), поэтому оба лежат в window. Игра переводит
 * разметку один раз при старте через `$('body').localize()`
 * (refs/game/script.js:135) по атрибуту `data-i18n`, поэтому подмена текста
 * снимает атрибут: иначе повторный localize() вернул бы игровую подпись.
 */

/** Снимок игровой подписи для восстановления после подмены. */
export interface IGameLabel {
  text: string | null;
  i18nKey: string | null;
}

/** Перевод ключа через игровой i18next; null, если i18next недоступен. */
export function translateGameKey(key: string | null): string | null {
  if (key === null) return null;
  const globals = window as unknown as Record<string, unknown>;
  const i18next = globals.i18next;
  if (typeof i18next !== 'object' || i18next === null) return null;
  const translate = (i18next as Record<string, unknown>).t;
  if (typeof translate !== 'function') return null;
  const result = (translate as (k: string) => unknown).call(i18next, key);
  return typeof result === 'string' ? result : null;
}

/** Повторный перевод элемента через jqueryI18next `.localize()`, если он есть. */
export function localizeGameElement(element: HTMLElement): void {
  const globals = window as unknown as Record<string, unknown>;
  const jquery = globals.$;
  if (typeof jquery !== 'function') return;
  const wrapped = (jquery as (selector: HTMLElement) => unknown)(element);
  if (typeof wrapped !== 'object' || wrapped === null) return;
  const localize = (wrapped as Record<string, unknown>).localize;
  if (typeof localize === 'function') {
    (localize as () => void).call(wrapped);
  }
}

export function captureGameLabel(element: HTMLElement): IGameLabel {
  return { text: element.textContent, i18nKey: element.getAttribute('data-i18n') };
}

export function setGameLabel(element: HTMLElement, text: string): void {
  element.textContent = text;
  element.removeAttribute('data-i18n');
}

/**
 * Возвращает игровую подпись. Приоритет у свежего перевода через i18next.t():
 * язык мог смениться, пока подпись была подменена. Снимок текста - фолбэк на
 * случай отсутствия i18next. localize() вызывается страховкой, но результат
 * от него не ожидается.
 */
export function restoreGameLabel(element: HTMLElement, label: IGameLabel): void {
  const restored = translateGameKey(label.i18nKey) ?? label.text;
  if (restored !== null) {
    element.textContent = restored;
  }
  if (label.i18nKey !== null) {
    element.setAttribute('data-i18n', label.i18nKey);
  }
  localizeGameElement(element);
}
