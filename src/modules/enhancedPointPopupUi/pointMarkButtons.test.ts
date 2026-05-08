import { installPointMarkButtons, uninstallPointMarkButtons } from './pointMarkButtons';

const AUTH_TOKEN = 'auth-test';

let mockFetch: jest.Mock;
let originalFetch: typeof window.fetch;

beforeEach(() => {
  document.head.innerHTML = '';
  document.body.innerHTML = '';
  localStorage.clear();
  localStorage.setItem('auth', AUTH_TOKEN);

  mockFetch = jest.fn();
  originalFetch = window.fetch;
  Object.defineProperty(window, 'fetch', { value: mockFetch, writable: true });
});

afterEach(() => {
  uninstallPointMarkButtons();
  window.fetch = originalFetch;
  localStorage.clear();
  jest.useRealTimers();
});

interface IInventoryRefRow {
  g: string;
  l: string;
  a: number;
  f?: number;
}

function setInventory(refs: IInventoryRefRow[]): void {
  const items = refs.map((r) => ({ g: r.g, t: 3, l: r.l, a: r.a, f: r.f ?? 0 }));
  localStorage.setItem('inventory-cache', JSON.stringify(items));
}

function createPopup(guid: string | null = null): HTMLElement {
  const popup = document.createElement('div');
  popup.className = 'info popup';
  if (guid === null) popup.classList.add('hidden');
  if (guid !== null) popup.dataset.guid = guid;
  const imageBox = document.createElement('div');
  imageBox.className = 'i-image-box';
  const refSpan = document.createElement('span');
  refSpan.id = 'i-ref';
  imageBox.appendChild(refSpan);
  popup.appendChild(imageBox);
  document.body.appendChild(popup);
  return popup;
}

function ok(result: boolean): void {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: () => Promise.resolve({ result }),
  });
}

function networkError(): void {
  mockFetch.mockRejectedValueOnce(new Error('network'));
}

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

function getButton(flag: 'favorite' | 'locked'): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>(`.svp-point-mark-button[data-flag="${flag}"]`);
}

describe('pointMarkButtons — install/uninstall', () => {
  test('install создаёт две кнопки после #i-ref в .i-image-box', async () => {
    createPopup('point-1');
    setInventory([{ g: 's1', l: 'point-1', a: 5 }]);

    installPointMarkButtons();
    await flushMicrotasks();

    const container = document.querySelector('.svp-point-mark-buttons');
    expect(container).not.toBeNull();
    expect(container?.previousElementSibling?.id).toBe('i-ref');
    expect(getButton('favorite')).not.toBeNull();
    expect(getButton('locked')).not.toBeNull();
  });

  test('install идемпотентен — повторный вызов не дублирует кнопки', async () => {
    createPopup('point-1');
    installPointMarkButtons();
    await flushMicrotasks();
    installPointMarkButtons();
    await flushMicrotasks();

    expect(document.querySelectorAll('.svp-point-mark-buttons').length).toBe(1);
    expect(document.querySelectorAll('.svp-point-mark-button').length).toBe(2);
  });

  test('uninstall удаляет контейнер с кнопками', async () => {
    createPopup('point-1');
    installPointMarkButtons();
    await flushMicrotasks();

    uninstallPointMarkButtons();

    expect(document.querySelector('.svp-point-mark-buttons')).toBeNull();
  });

  test('install ждёт появления попапа в DOM', async () => {
    installPointMarkButtons();
    expect(document.querySelector('.svp-point-mark-buttons')).toBeNull();

    createPopup('point-1');
    // Дать MutationObserver waitForElement среагировать.
    await flushMicrotasks();

    expect(document.querySelector('.svp-point-mark-buttons')).not.toBeNull();
  });
});

describe('pointMarkButtons — состояние кнопок', () => {
  test('попап с .hidden — кнопки disabled', async () => {
    createPopup(null);
    installPointMarkButtons();
    await flushMicrotasks();

    expect(getButton('favorite')?.disabled).toBe(true);
    expect(getButton('locked')?.disabled).toBe(true);
  });

  test('data-guid есть, в инвентаре нет стопок этой точки — disabled', async () => {
    createPopup('point-no-keys');
    setInventory([{ g: 's-other', l: 'point-other', a: 1 }]);
    installPointMarkButtons();
    await flushMicrotasks();

    expect(getButton('favorite')?.disabled).toBe(true);
    expect(getButton('locked')?.disabled).toBe(true);
  });

  test('disabled-кнопка без tooltip', async () => {
    createPopup('point-no-keys');
    installPointMarkButtons();
    await flushMicrotasks();

    expect(getButton('favorite')?.title).toBe('');
    expect(getButton('locked')?.title).toBe('');
  });

  test('все стопки с favorite-битом — звезда filled', async () => {
    createPopup('p1');
    setInventory([
      { g: 's1', l: 'p1', a: 3, f: 0b01 },
      { g: 's2', l: 'p1', a: 2, f: 0b01 },
    ]);
    installPointMarkButtons();
    await flushMicrotasks();

    const star = getButton('favorite');
    expect(star?.disabled).toBe(false);
    expect(star?.classList.contains('is-filled')).toBe(true);
    expect(star?.getAttribute('aria-pressed')).toBe('true');
  });

  test('mix-стопки favorite — НЕ filled (правило every)', async () => {
    createPopup('p1');
    setInventory([
      { g: 's1', l: 'p1', a: 3, f: 0b01 },
      { g: 's2', l: 'p1', a: 2, f: 0 },
    ]);
    installPointMarkButtons();
    await flushMicrotasks();

    const star = getButton('favorite');
    expect(star?.disabled).toBe(false);
    expect(star?.classList.contains('is-filled')).toBe(false);
    expect(star?.getAttribute('aria-pressed')).toBe('false');
  });

  test('все стопки с locked-битом — замок filled, иконка fas-lock', async () => {
    createPopup('p1');
    setInventory([{ g: 's1', l: 'p1', a: 5, f: 0b10 }]);
    installPointMarkButtons();
    await flushMicrotasks();

    const lock = getButton('locked');
    expect(lock?.classList.contains('is-filled')).toBe(true);
    expect(lock?.querySelector('use')?.getAttribute('href')).toBe('#fas-lock');
  });

  test('lock-бит у одной стопки, у другой нет — замок не filled', async () => {
    createPopup('p1');
    setInventory([
      { g: 's1', l: 'p1', a: 3, f: 0b10 },
      { g: 's2', l: 'p1', a: 2, f: 0 },
    ]);
    installPointMarkButtons();
    await flushMicrotasks();

    const lock = getButton('locked');
    expect(lock?.classList.contains('is-filled')).toBe(false);
    expect(lock?.querySelector('use')?.getAttribute('href')).toBe('#fas-lock-open');
  });

  test('favorite и locked независимы — стопка с f=0b01 даёт filled звезду и не-filled замок', async () => {
    createPopup('p1');
    setInventory([{ g: 's1', l: 'p1', a: 5, f: 0b01 }]);
    installPointMarkButtons();
    await flushMicrotasks();

    expect(getButton('favorite')?.classList.contains('is-filled')).toBe(true);
    expect(getButton('locked')?.classList.contains('is-filled')).toBe(false);
  });

  test('title локализован (ru) при настройке lang=ru', async () => {
    localStorage.setItem('settings', JSON.stringify({ lang: 'ru' }));
    createPopup('p1');
    setInventory([{ g: 's1', l: 'p1', a: 1, f: 0 }]);
    installPointMarkButtons();
    await flushMicrotasks();

    expect(getButton('favorite')?.title).toBe('Добавить в избранное');
    expect(getButton('locked')?.title).toBe('Заблокировать ключи');
  });
});

describe('pointMarkButtons — реакция на смену атрибутов попапа', () => {
  test('смена data-guid перечитывает state', async () => {
    const popup = createPopup('p-empty');
    setInventory([
      { g: 's1', l: 'p-with-keys', a: 5, f: 0b01 },
      { g: 's2', l: 'p-empty-source', a: 0 },
    ]);
    installPointMarkButtons();
    await flushMicrotasks();
    expect(getButton('favorite')?.disabled).toBe(true);

    popup.dataset.guid = 'p-with-keys';
    await flushMicrotasks();

    const star = getButton('favorite');
    expect(star?.disabled).toBe(false);
    expect(star?.classList.contains('is-filled')).toBe(true);
  });

  test('переключение class hidden→visible активирует кнопки', async () => {
    const popup = createPopup(null);
    popup.dataset.guid = 'p1';
    setInventory([{ g: 's1', l: 'p1', a: 5, f: 0b01 }]);
    installPointMarkButtons();
    await flushMicrotasks();
    expect(getButton('favorite')?.disabled).toBe(true);

    popup.classList.remove('hidden');
    await flushMicrotasks();

    expect(getButton('favorite')?.disabled).toBe(false);
  });
});

describe('pointMarkButtons — click toggle', () => {
  test('click при disabled (нет стопок) — fetch не вызывается', async () => {
    createPopup('p-no-keys');
    installPointMarkButtons();
    await flushMicrotasks();

    getButton('favorite')?.click();
    await flushMicrotasks();

    expect(mockFetch).not.toHaveBeenCalled();
  });

  test('click off→on с одной стопкой — один POST с правильным телом', async () => {
    createPopup('p1');
    setInventory([{ g: 's1', l: 'p1', a: 5, f: 0 }]);
    installPointMarkButtons();
    await flushMicrotasks();

    ok(true);
    getButton('favorite')?.click();
    await flushMicrotasks();

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith('/api/marks', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${AUTH_TOKEN}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ guid: 's1', flag: 'favorite' }),
    });
    expect(getButton('favorite')?.classList.contains('is-filled')).toBe(true);
  });

  test('click на filled звезду off-toggle — POST для всех стопок с битом', async () => {
    createPopup('p1');
    setInventory([
      { g: 's1', l: 'p1', a: 3, f: 0b01 },
      { g: 's2', l: 'p1', a: 2, f: 0b01 },
    ]);
    installPointMarkButtons();
    await flushMicrotasks();

    ok(false); // первая стопка: off
    ok(false); // вторая стопка: off

    jest.useFakeTimers();
    getButton('favorite')?.click();
    // Прокручиваем sequential POST с задержкой 1500мс между ними.
    for (let i = 0; i < 30; i++) {
      await Promise.resolve();
      jest.advanceTimersByTime(500);
      if (mockFetch.mock.calls.length === 2) break;
    }
    jest.useRealTimers();
    await flushMicrotasks();

    expect(mockFetch).toHaveBeenCalledTimes(2);
    const bodies = (mockFetch.mock.calls as [string, { body: string }][])
      .map((call) => JSON.parse(call[1].body) as { guid: string; flag: string })
      .map((p) => p.guid)
      .sort();
    expect(bodies).toEqual(['s1', 's2']);
    expect(getButton('favorite')?.classList.contains('is-filled')).toBe(false);
  });

  test('click при mix-стопках on-toggle — POST только для стопок без бита', async () => {
    createPopup('p1');
    setInventory([
      { g: 's-has-bit', l: 'p1', a: 3, f: 0b01 },
      { g: 's-no-bit', l: 'p1', a: 2, f: 0 },
    ]);
    installPointMarkButtons();
    await flushMicrotasks();

    ok(true); // только для s-no-bit

    jest.useFakeTimers();
    getButton('favorite')?.click();
    for (let i = 0; i < 30; i++) {
      await Promise.resolve();
      jest.advanceTimersByTime(500);
      if (mockFetch.mock.calls.length >= 1) break;
    }
    jest.useRealTimers();
    await flushMicrotasks();

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse((mockFetch.mock.calls[0] as [string, { body: string }])[1].body) as {
      guid: string;
    };
    expect(body.guid).toBe('s-no-bit');
  });

  test('lock-кнопка отправляет flag=locked в payload', async () => {
    createPopup('p1');
    setInventory([{ g: 's1', l: 'p1', a: 5, f: 0 }]);
    installPointMarkButtons();
    await flushMicrotasks();

    ok(true);
    getButton('locked')?.click();
    await flushMicrotasks();

    const body = JSON.parse((mockFetch.mock.calls[0] as [string, { body: string }])[1].body) as {
      flag: string;
    };
    expect(body.flag).toBe('locked');
  });

  test('во время batch обе кнопки disabled, повторный click игнорируется', async () => {
    createPopup('p1');
    setInventory([
      { g: 's1', l: 'p1', a: 3, f: 0 },
      { g: 's2', l: 'p1', a: 2, f: 0 },
    ]);
    installPointMarkButtons();
    await flushMicrotasks();

    // Первый запрос пока в полёте: фабрикуем pending promise.
    type FetchResolveValue = { ok: boolean; json: () => Promise<{ result: boolean }> };
    const pending: { resolve: ((value: FetchResolveValue) => void) | null } = { resolve: null };
    mockFetch.mockImplementationOnce(
      () =>
        new Promise<FetchResolveValue>((resolve) => {
          pending.resolve = resolve;
        }),
    );
    ok(true);

    getButton('favorite')?.click();
    await flushMicrotasks();

    expect(getButton('favorite')?.disabled).toBe(true);
    expect(getButton('locked')?.disabled).toBe(true);

    // Повторный click во время batch — не должен вызвать дополнительный fetch.
    getButton('favorite')?.click();
    getButton('locked')?.click();
    await flushMicrotasks();
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Завершаем первый запрос, прокручиваем задержку перед вторым.
    if (pending.resolve === null) throw new Error('mockFetch implementation not invoked');
    pending.resolve({ ok: true, json: () => Promise.resolve({ result: true }) });
    jest.useFakeTimers();
    for (let i = 0; i < 30; i++) {
      await Promise.resolve();
      jest.advanceTimersByTime(500);
      if (mockFetch.mock.calls.length === 2 && !getButton('favorite')?.disabled) break;
    }
    jest.useRealTimers();
    await flushMicrotasks();

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(getButton('favorite')?.disabled).toBe(false);
  });

  test('сетевая ошибка — кнопка re-enabled, состояние читается из inventory-cache', async () => {
    createPopup('p1');
    setInventory([{ g: 's1', l: 'p1', a: 5, f: 0 }]);
    installPointMarkButtons();
    await flushMicrotasks();

    networkError();
    getButton('favorite')?.click();
    await flushMicrotasks();

    // postMark при network error не трогает кэш — состояние осталось off.
    expect(getButton('favorite')?.disabled).toBe(false);
    expect(getButton('favorite')?.classList.contains('is-filled')).toBe(false);
  });

  test('server result=false при on-toggle — состояние следует реальному кэшу (off)', async () => {
    createPopup('p1');
    setInventory([{ g: 's1', l: 'p1', a: 5, f: 0 }]);
    installPointMarkButtons();
    await flushMicrotasks();

    ok(false); // сервер toggle не поставил флаг
    getButton('favorite')?.click();
    await flushMicrotasks();

    // applyFlagToCache выставит cache по реальному ответу (off), state — не filled.
    expect(getButton('favorite')?.classList.contains('is-filled')).toBe(false);
    expect(getButton('favorite')?.disabled).toBe(false);
  });
});
