declare const __SVP_VERSION__: string;

const FLAVOR_HEADER = 'x-sbg-flavor';

/** Идентификатор скрипта в формате игры (`Stock/0.7.0`, `CUI/x.y.z`). */
export const SVP_FLAVOR = `VanillaPlus/${__SVP_VERSION__}`;

let flavorFailureReported = false;

/**
 * Сборка заголовков идёт в Headers, а он бросает синхронно - до того, как игра
 * получит промис. Нативный fetch на тех же данных промис отклоняет, поэтому
 * игровой обработчик, повешенный на промис, наш throw не поймал бы. Запись
 * делается один раз за установку: перехват стоит на каждом запросе игры, и
 * повтор вытеснил бы полезные строки из core/errorLog (там хранятся
 * последние 50).
 */
function reportFlavorFailure(error: unknown): void {
  if (flavorFailureReported) return;
  flavorFailureReported = true;
  console.error('[SVP] flavor-заголовок не добавлен:', error);
}

function buildFlavorInit(init: RequestInit | undefined): RequestInit {
  const headers = new Headers(init?.headers);

  const existing = headers.get(FLAVOR_HEADER);
  if (existing) {
    const flavors = existing.split(' ');
    if (!flavors.includes(SVP_FLAVOR)) {
      flavors.push(SVP_FLAVOR);
    }
    headers.set(FLAVOR_HEADER, flavors.join(' '));
  } else {
    headers.set(FLAVOR_HEADER, SVP_FLAVOR);
  }

  return { ...init, headers };
}

export function installSbgFlavor(): void {
  const originalFetch = window.fetch;
  flavorFailureReported = false;

  window.fetch = function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    // Единственный наш перехват fetch, где логика идёт ДО вызова оригинала:
    // остальные зовут его первой строкой и разбирают уже отданный запрос.
    // Поэтому отказ здесь стоит игре не отфильтрованных данных, а самого
    // запроса - игра получает исключение вместо промиса.
    let patched = init;
    try {
      patched = buildFlavorInit(init);
    } catch (error) {
      reportFlavorFailure(error);
    }

    return originalFetch.call(this, input, patched);
  };
}
