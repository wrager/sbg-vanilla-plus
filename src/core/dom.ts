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

export function injectStyles(css: string, id: string): void {
  removeStyles(id);
  const style = document.createElement('style');
  style.id = `svp-${id}`;
  style.textContent = css;
  document.head.appendChild(style);
}

export function removeStyles(id: string): void {
  document.getElementById(`svp-${id}`)?.remove();
}
