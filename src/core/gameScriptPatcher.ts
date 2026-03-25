/**
 * Перехватывает загрузку скрипта игры и применяет патчи.
 *
 * Игровой скрипт — ES module, его функции (showInfo и др.) недоступны извне.
 * Для доступа к showInfo (прямое открытие попапа точки без fake click)
 * нужно добавить `window.showInfo = showInfo` в код скрипта.
 *
 * Механизм: override Element.prototype.append → перехват
 * `<script type="module" src="script@...">` → fetch + patch + inject.
 * Override снимается сразу после перехвата (одноразовый).
 *
 * При ошибке (fetch fail, невалидный скрипт) — загружается оригинал без патчей.
 */

declare global {
  interface Window {
    showInfo?: (data: string) => void;
  }
}

// mobile-check создаёт: s.src = 'script@' + version + '.' + hash + '.js'
const GAME_SCRIPT_PATTERN = /^script@/;

// Патчи: [поисковая строка, замена]. Каждый патч — одна замена.
const PATCHES: [search: string, replacement: string][] = [
  // Экспозиция showInfo на window для прямого открытия попапа (refs/game/script.js:1687)
  ['class Bitfield', 'window.showInfo = showInfo; class Bitfield'],
];

export function isGameScript(node: Node | string): node is HTMLScriptElement {
  return (
    node instanceof HTMLScriptElement &&
    node.type === 'module' &&
    GAME_SCRIPT_PATTERN.test(node.getAttribute('src') ?? '')
  );
}

export function applyPatches(source: string): { result: string; appliedCount: number } {
  let result = source;
  let appliedCount = 0;

  for (const [search, replacement] of PATCHES) {
    if (result.includes(search)) {
      result = result.replace(search, replacement);
      appliedCount++;
    }
  }

  return { result, appliedCount };
}

export const EXPECTED_PATCHES_COUNT = PATCHES.length;

export function installGameScriptPatcher(): void {
  // eslint-disable-next-line @typescript-eslint/unbound-method -- сохраняем оригинал для восстановления и вызова через apply
  const originalAppend = Element.prototype.append;

  Element.prototype.append = function (...args: (Node | string)[]): void {
    for (const argument of args) {
      if (isGameScript(argument)) {
        // Одноразовый перехват — восстанавливаем оригинал немедленно
        Element.prototype.append = originalAppend;
        void patchAndInject(argument.src, originalAppend);
        return;
      }
    }
    originalAppend.apply(this, args);
  };
}

async function patchAndInject(
  originalSrc: string,
  appendFunction: Element['append'],
): Promise<void> {
  try {
    const response = await fetch(originalSrc);
    const source = await response.text();

    const { result, appliedCount } = applyPatches(source);

    if (appliedCount !== EXPECTED_PATCHES_COUNT) {
      console.warn(
        `[SVP] Применено ${appliedCount}/${EXPECTED_PATCHES_COUNT} патчей скрипта игры. Игра обновилась?`,
      );
    }

    const script = document.createElement('script');
    script.type = 'module';
    script.textContent = result;
    appendFunction.call(document.head, script);
  } catch (error) {
    console.error('[SVP] Патчинг скрипта не удался, загружаем оригинал', error);
    // Fallback: загрузить оригинальный скрипт без патчей
    const script = document.createElement('script');
    script.type = 'module';
    script.src = originalSrc;
    appendFunction.call(document.head, script);
  }
}
