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

/** i18next игры. Перечислено только то, что читает SVP. */
export interface IGameI18n {
  language?: string;
  resolvedLanguage?: string;
  t(key: string): unknown;
  /**
   * Сырой шаблон перевода, без подстановки значений. Помечен опциональным:
   * потребитель у него один, и требовать метод со всех потребителей i18next
   * значило бы отключать перевод подписей на сборке, где его нет.
   */
  getResource?(language: string, namespace: string, key: string): unknown;
}

/** i18next игры или null, если он недоступен или не похож на i18next. */
export function getGameI18n(): IGameI18n | null {
  const globals = window as unknown as Record<string, unknown>;
  const i18next = globals.i18next;
  if (typeof i18next !== 'object' || i18next === null) return null;
  const candidate = i18next as Partial<IGameI18n>;
  return typeof candidate.t === 'function' ? (candidate as IGameI18n) : null;
}

/** Перевод ключа через игровой i18next; null, если i18next недоступен. */
export function translateGameKey(key: string | null): string | null {
  if (key === null) return null;
  const i18n = getGameI18n();
  if (i18n === null) return null;
  const result = i18n.t(key);
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
