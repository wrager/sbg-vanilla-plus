/**
 * Доступ к Toastify игры и типы его API.
 *
 * Игра подключает Toastify-JS 1.12.0 обычным <script> (refs/game/index.html:35)
 * и показывает через него все свои уведомления, поэтому фабрика лежит в window.
 * Через неё же идут тосты SVP: держать на экране вторую систему уведомлений со
 * своей раскладкой незачем, а Toastify сам разводит одновременные тосты
 * (`reposition`, refs/toastify/toastify.js:117).
 *
 * Свойства, на которые опирается SVP (все проверены по refs/toastify/toastify.js):
 * - `gravity` на входе принимает 'top'/'bottom', но после конструирования хранит
 *   'toastify-top'/'toastify-bottom' (:59), поэтому сырое значение уходит только
 *   в фабрику;
 * - `position` хранится как есть ('left'/'center'/'right') и читается позже, в
 *   `buildToast` (:64), поэтому у готового инстанса его ещё можно поменять;
 * - `className` подставляется в строку через конкатенацию (:64), поэтому
 *   допускает несколько классов через пробел;
 * - `escapeMarkup` выбирает между `innerText` и `innerHTML` (:66);
 * - `selector` принимает id, элемент или ShadowRoot, иначе тост уходит в body (:103);
 * - `toastElement.timeOutValue` - таймер автоснятия (:105);
 * - `removeElement` откладывает удаление узла и вызов `callback` на 400 мс (:112).
 */

import { isRecord } from './isRecord';

/** Опции инстанса Toastify. Перечислены только те, что читает или пишет SVP. */
export interface IToastifyOptions {
  text: string;
  className: string;
  /**
   * Элемент-якорь. `undefined` штатен: Toastify подставляет его, когда опцию не
   * передали (refs/toastify/toastify.js:59), и такой тост уходит в body.
   */
  selector: Element | null | undefined;
  id: number;
  duration: number;
  callback: (() => void) | null;
  onClick: (() => void) | null;
  gravity: string;
  position: string;
  escapeMarkup: boolean;
}

export interface IToastifyInstance {
  options: IToastifyOptions;
  toastElement: HTMLElement | null;
  showToast(): void;
  hideToast(): void;
}

export interface IToastifyPrototype {
  showToast(this: IToastifyInstance): void;
  [key: string]: unknown;
}

export interface IToastifyFactory {
  (options: Partial<IToastifyOptions>): IToastifyInstance;
  prototype: IToastifyPrototype;
}

/** Узел тоста с таймером автоснятия, который Toastify вешает на сам элемент. */
export interface IToastElement extends HTMLElement {
  timeOutValue?: ReturnType<typeof setTimeout>;
}

declare global {
  interface Window {
    Toastify?: IToastifyFactory;
  }
}

/**
 * Классы тостов игры. Их ровно два, и SVP пользуется теми же: свой цвет для
 * уведомления SVP выбивался бы из игры, а игрок и так читает эти два состояния.
 * refs/game/script.js:4050 (нейтральный) и :3965 (ошибка).
 */
export const GAME_TOAST_CLASS = {
  neutral: 'interaction-toast',
  error: 'error-toast',
} as const;

/**
 * Фабрика Toastify или null, если игра ещё не загрузила пакет. Проверка на
 * функцию, а не на существование поля: до загрузки скрипта в window может
 * лежать что угодно, включая заглушку от другого расширения.
 */
export function getToastifyFactory(): IToastifyFactory | null {
  const factory = window.Toastify;
  return typeof factory === 'function' ? factory : null;
}

function isToastifyPrototype(value: unknown): value is IToastifyPrototype {
  return isRecord(value) && typeof value.showToast === 'function';
}

/**
 * Прототип Toastify, пригодный к подмене showToast, или null. Наличие метода
 * проверяется, несмотря на объявленный тип: тип описывает 1.12.0, а патч,
 * вставший на несуществующий оригинал, сломал бы игре все уведомления вместо
 * своей сборки.
 */
export function getToastifyPrototype(): IToastifyPrototype | null {
  const factory = getToastifyFactory();
  if (factory === null) return null;
  const proto: unknown = factory.prototype;
  return isToastifyPrototype(proto) ? proto : null;
}

/**
 * Ошибочный ли это тост. Сравнение по токену, а не по равенству всей строки:
 * className допускает несколько классов, и строгое равенство пропустило бы
 * тост с дополнительным классом.
 *
 * Аргумент принимается как unknown: значение читается из инстанса, который
 * создала игра, и объявленный тип там - обещание Toastify, а не гарантия.
 */
export function isErrorToast(className: unknown): boolean {
  if (typeof className !== 'string') return false;
  return className.trim().split(/\s+/).includes(GAME_TOAST_CLASS.error);
}
