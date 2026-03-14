export function observeElement(
  selector: string,
  callback: (el: Element) => void,
  root: Node = document.body,
): MutationObserver {
  const observer = new MutationObserver(() => {
    const el = document.querySelector(selector);
    if (el) {
      callback(el);
    }
  });

  observer.observe(root, { childList: true, subtree: true });
  return observer;
}
