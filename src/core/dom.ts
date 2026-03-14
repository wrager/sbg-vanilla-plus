export function $(selector: string, root: ParentNode = document): Element | null {
  return root.querySelector(selector);
}

export function $$(selector: string, root: ParentNode = document): Element[] {
  return [...root.querySelectorAll(selector)];
}

export function waitForElement(
  selector: string,
  timeout = 10_000,
): Promise<Element> {
  return new Promise((resolve, reject) => {
    const existing = $(selector);
    if (existing) {
      resolve(existing);
      return;
    }

    const observer = new MutationObserver(() => {
      const el = $(selector);
      if (el) {
        observer.disconnect();
        clearTimeout(timer);
        resolve(el);
      }
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });

    const timer = setTimeout(() => {
      observer.disconnect();
      reject(new Error(`[SVP] Элемент "${selector}" не найден за ${timeout}мс`));
    }, timeout);
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
