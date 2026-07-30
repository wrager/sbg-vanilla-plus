export function $(selector: string, root: ParentNode = document): Element | null {
  return root.querySelector(selector);
}

export function $$(selector: string, root: ParentNode = document): Element[] {
  return [...root.querySelectorAll(selector)];
}

export function waitForElement(
  selector: string,
  timeout = 10_000,
  signal?: AbortSignal,
): Promise<Element> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('waitForElement aborted', 'AbortError'));
      return;
    }

    const existing = $(selector);
    if (existing) {
      resolve(existing);
      return;
    }

    // Освобождает observer и таймер при любом завершении (resolve, timeout,
    // abort). Без этого abort оставлял бы pending MutationObserver, который
    // потребляет CPU на каждой DOM-мутации до timeout (10 сек по умолчанию)
    // и продолжает резолвить промис, который уже никому не нужен.
    const cleanup = (): void => {
      observer.disconnect();
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };

    const onAbort = (): void => {
      cleanup();
      reject(new DOMException('waitForElement aborted', 'AbortError'));
    };

    const observer = new MutationObserver(() => {
      const el = $(selector);
      if (el) {
        cleanup();
        resolve(el);
      }
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`[SVP] Элемент "${selector}" не найден за ${timeout}мс`));
    }, timeout);

    signal?.addEventListener('abort', onAbort);
  });
}

/**
 * Подписывается на изменения текста в одном или нескольких узлах. Опции
 * (`childList` + `characterData` + `subtree`) подобраны под типовой случай
 * обновления через jQuery `.text()` / i18next, который заменяет вложенный
 * text-node, а событие приходит на родителя через subtree.
 */
export function observeText(targets: Node | Node[], callback: () => void): MutationObserver {
  const observer = new MutationObserver(callback);
  const list = Array.isArray(targets) ? targets : [targets];
  for (const target of list) {
    observer.observe(target, { childList: true, characterData: true, subtree: true });
  }
  return observer;
}

/*
 * Стили, для которых на момент вызова не нашлось куда вставить, и наблюдатель
 * за появлением корневого элемента. Общие на модуль: ожидающих может быть
 * несколько, а наблюдатель нужен один.
 */
const pendingStyles: HTMLStyleElement[] = [];
let styleRootObserver: MutationObserver | null = null;

/**
 * Узел для вставки <style>: head, если он уже распарсен, иначе documentElement.
 * В самом раннем document-start нет ни того, ни другого - тогда null.
 *
 * Оба спрашиваются в обход document.head и напрямую: они типизированы как
 * всегда существующие, и их отсутствие типам не видно.
 */
function findStyleRoot(): Element | null {
  const head = $('head');
  if (head) return head;
  const root: Element | null = document.documentElement;
  return root;
}

function flushPendingStyles(): void {
  const root = findStyleRoot();
  if (!root) return;
  styleRootObserver?.disconnect();
  styleRootObserver = null;
  for (const style of pendingStyles.splice(0)) root.appendChild(style);
}

function appendStyle(style: HTMLStyleElement): void {
  const root = findStyleRoot();
  if (root) {
    root.appendChild(style);
    return;
  }
  /*
   * Скрипт стартует на document-start, когда парсер ещё не дошёл до <html>:
   * вставлять некуда, ждём появления корневого элемента. Ожидание короткое -
   * корень создаётся на первом чанке разметки, задолго до загрузочного экрана
   * игры.
   */
  pendingStyles.push(style);
  if (!styleRootObserver) {
    styleRootObserver = new MutationObserver(flushPendingStyles);
    styleRootObserver.observe(document, { childList: true });
  }
}

/**
 * Вставляет <style> с нашим префиксом в id. Стиль ложится в head, а до его
 * разбора - в documentElement: браузер применяет <style> и вне head, а при
 * разборе head элемент остаётся на месте, переносить его потом не нужно.
 */
export function injectStyles(css: string, id: string): void {
  removeStyles(id);
  const style = document.createElement('style');
  style.id = `svp-${id}`;
  style.textContent = css;
  appendStyle(style);
}

export function removeStyles(id: string): void {
  const elementId = `svp-${id}`;
  // Стиль может ещё ждать корневого элемента - тогда удалять из документа
  // нечего, надо снять его с очереди, иначе он вставится после удаления.
  const pendingIndex = pendingStyles.findIndex((style) => style.id === elementId);
  if (pendingIndex !== -1) pendingStyles.splice(pendingIndex, 1);
  document.getElementById(elementId)?.remove();
}
