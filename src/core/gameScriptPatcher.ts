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
    __svpNativeInfoSwipeDisabled?: boolean;
  }
}

// mobile-check создаёт: s.src = 'script@' + version + '.' + hash + '.js'
const GAME_SCRIPT_PATTERN = /^script@/;

// Поисковая строка нативного hammer_info Manager-а (refs/game/script.js:722-726).
// Собирается из строк через '\n' для устойчивости к line-endings исходного файла:
// .ts с CRLF не сломает поиск, потому что мы явно используем LF.
const NATIVE_HAMMER_INFO_SEARCH = [
  "new Hammer(document.querySelector('.info'), {",
  '    recognizers: [',
  '      [Hammer.Swipe, { direction: Hammer.DIRECTION_HORIZONTAL }],',
  '    ],',
  '  })',
].join('\n');

// Замена: comma-expression выставляет sentinel-флаг и возвращает no-op объект.
// hammer_info становится { on() {} }, поэтому hammer_info.on('swipeleft swiperight', ...)
// в строке 727 не имеет эффекта. Сам Hammer.Manager не создаётся — нативные
// touch-listener'ы на .info не привязываются, что освобождает .info для нашего
// core/popupSwipe без конфликта pointer-cancel.
const NATIVE_HAMMER_INFO_REPLACE = '(window.__svpNativeInfoSwipeDisabled = true, { on() {} })';

// Патчи: [поисковая строка, замена]. Каждый патч — одна замена.
const PATCHES: [search: string, replacement: string][] = [
  // Экспозиция showInfo на window для прямого открытия попапа (refs/game/script.js:1687)
  ['class Bitfield', 'window.showInfo = showInfo; class Bitfield'],
  // Отключение нативного горизонтального свайпа на .info, чтобы наш модуль
  // nextPointNavigation мог зарегистрировать собственный обработчик через
  // core/popupSwipe без двойного срабатывания (refs/game/script.js:722-726).
  [NATIVE_HAMMER_INFO_SEARCH, NATIVE_HAMMER_INFO_REPLACE],
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
