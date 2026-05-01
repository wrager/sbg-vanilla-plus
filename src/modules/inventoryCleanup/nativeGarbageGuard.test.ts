import {
  installNativeGarbageGuard,
  uninstallNativeGarbageGuard,
  resetUsegrbPostedFlagForTest,
} from './nativeGarbageGuard';

const AUTH_TOKEN = 'test-auth-token';

let originalFetch: typeof window.fetch;
let mockFetch: jest.Mock;

beforeEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
  localStorage.setItem('auth', AUTH_TOKEN);

  mockFetch = jest.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
  originalFetch = window.fetch;
  Object.defineProperty(window, 'fetch', { value: mockFetch, writable: true });

  // Флаг session-once в модуле живёт между тестами; сбрасываем, чтобы
  // каждый тест видел чистое состояние "POST ещё не отправлялся".
  resetUsegrbPostedFlagForTest();
});

afterEach(() => {
  uninstallNativeGarbageGuard();
  window.fetch = originalFetch;
  document.body.innerHTML = '';
  localStorage.clear();
});

function createGarbageSection(): {
  usegrb: HTMLInputElement;
  values: HTMLInputElement[];
  save: HTMLButtonElement;
} {
  // Каркас из refs/game/dom/body.html:145-161 — чекбокс usegrb,
  // 20 input.garbage-value (10 уровней × 2 типа), кнопка save.
  const section = document.createElement('div');

  const usegrb = document.createElement('input');
  usegrb.type = 'checkbox';
  usegrb.setAttribute('data-setting', 'usegrb');
  usegrb.setAttribute('data-server', '');
  section.appendChild(usegrb);

  const values: HTMLInputElement[] = [];
  for (let level = 1; level <= 10; level++) {
    for (const type of [1, 2]) {
      const input = document.createElement('input');
      input.type = 'number';
      input.className = 'garbage-value';
      input.setAttribute('data-ref', `${type}-${level}`);
      values.push(input);
      section.appendChild(input);
    }
  }

  const save = document.createElement('button');
  save.id = 'garbage-save';
  section.appendChild(save);

  document.body.appendChild(section);
  return { usegrb, values, save };
}

describe('installNativeGarbageGuard — DOM defence', () => {
  test('после install чекбокс usegrb получает атрибут disabled', () => {
    const { usegrb } = createGarbageSection();
    installNativeGarbageGuard();
    expect(usegrb.hasAttribute('disabled')).toBe(true);
  });

  test('все 20 .garbage-value input получают disabled', () => {
    const { values } = createGarbageSection();
    installNativeGarbageGuard();
    for (const input of values) {
      expect(input.hasAttribute('disabled')).toBe(true);
    }
  });

  test('#garbage-save кнопка получает disabled', () => {
    const { save } = createGarbageSection();
    installNativeGarbageGuard();
    expect(save.hasAttribute('disabled')).toBe(true);
  });

  test('disabled, выставленный игрой ДО нашего install, не помечается нашим маркером и не снимается на uninstall', () => {
    const { usegrb } = createGarbageSection();
    usegrb.setAttribute('disabled', '');
    installNativeGarbageGuard();
    uninstallNativeGarbageGuard();
    // Пользователь должен видеть disabled от игры — мы трогаем только то,
    // что сами выставили (помечено data-svp-disabled-by-cleanup).
    expect(usegrb.hasAttribute('disabled')).toBe(true);
  });

  test('uninstall снимает disabled, добавленный нашим модулем', () => {
    const { usegrb, values, save } = createGarbageSection();
    installNativeGarbageGuard();
    uninstallNativeGarbageGuard();
    expect(usegrb.hasAttribute('disabled')).toBe(false);
    for (const input of values) {
      expect(input.hasAttribute('disabled')).toBe(false);
    }
    expect(save.hasAttribute('disabled')).toBe(false);
  });

  test('observer догоняет элементы, добавленные ПОСЛЕ install', async () => {
    installNativeGarbageGuard();
    const { usegrb } = createGarbageSection();

    // MutationObserver работает асинхронно — даём микротаску.
    await Promise.resolve();
    await Promise.resolve();

    expect(usegrb.hasAttribute('disabled')).toBe(true);
  });
});

describe('installNativeGarbageGuard — сторона API', () => {
  test('шлёт POST /api/settings { usegrb: false } с auth-токеном', () => {
    createGarbageSection();
    installNativeGarbageGuard();

    expect(mockFetch).toHaveBeenCalledWith('/api/settings', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${AUTH_TOKEN}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ usegrb: false }),
    });
  });

  test('без auth-токена POST не отправляется', () => {
    localStorage.removeItem('auth');
    createGarbageSection();
    installNativeGarbageGuard();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test('сетевая ошибка не ломает install (DOM-defence остаётся)', async () => {
    mockFetch.mockRejectedValue(new Error('network'));
    const { usegrb } = createGarbageSection();
    installNativeGarbageGuard();

    // Дождёмся обработки rejection.
    await Promise.resolve();
    await Promise.resolve();

    // DOM остался задизейбленным даже при сетевой ошибке.
    expect(usegrb.hasAttribute('disabled')).toBe(true);
  });

  test('disable не шлёт повторного POST (только enable инициирует)', () => {
    createGarbageSection();
    installNativeGarbageGuard();
    mockFetch.mockClear();

    uninstallNativeGarbageGuard();

    expect(mockFetch).not.toHaveBeenCalled();
  });

  test('повторный install за сессию не шлёт второй POST', () => {
    // Пользователь часто toggle модуля через настройки или модуль сам
    // флаппится из-за чужого скрипта - без session-once флага мы спамили
    // бы /api/settings на каждый enable. Сервер всё равно дросселирует,
    // но клиентский лишний вызов выглядит как ошибка рантайма; флаг
    // убирает шум в логах сервера и в DevTools Network.
    createGarbageSection();
    installNativeGarbageGuard();
    expect(mockFetch).toHaveBeenCalledTimes(1);

    uninstallNativeGarbageGuard();
    installNativeGarbageGuard();

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  test('после resetUsegrbPostedFlagForTest install шлёт POST заново', () => {
    // Контр-тест к session-once: симуляция перезагрузки страницы
    // (resetUsegrbPostedFlagForTest имитирует свежий page-load).
    // Без этого механизма пользователь, наткнувшийся на сетевую ошибку
    // при первом fetch, не смог бы переотправить POST даже после reload.
    createGarbageSection();
    installNativeGarbageGuard();
    expect(mockFetch).toHaveBeenCalledTimes(1);
    uninstallNativeGarbageGuard();

    resetUsegrbPostedFlagForTest();
    installNativeGarbageGuard();
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});

// ── обёртка fieldset'а с подписью и opacity ──────────────────────────────────

function createGarbageFieldset(): {
  fieldset: HTMLFieldSetElement;
  legend: HTMLLegendElement;
  usegrb: HTMLInputElement;
  values: HTMLInputElement[];
  save: HTMLButtonElement;
} {
  // Структура из refs/game/index.html:205-227: fieldset > legend, label с
  // input usegrb, .garbage-table, кнопка #garbage-save, текстовые подсказки.
  const fieldset = document.createElement('fieldset');
  fieldset.className = 'settings-block vertical';

  const legend = document.createElement('legend');
  legend.textContent = 'Сборщик мусора';
  fieldset.appendChild(legend);

  const label = document.createElement('label');
  const usegrb = document.createElement('input');
  usegrb.type = 'checkbox';
  usegrb.setAttribute('data-setting', 'usegrb');
  label.appendChild(usegrb);
  fieldset.appendChild(label);

  const table = document.createElement('div');
  table.className = 'garbage-table';
  const values: HTMLInputElement[] = [];
  for (let level = 1; level <= 10; level++) {
    for (const type of [1, 2]) {
      const input = document.createElement('input');
      input.type = 'number';
      input.className = 'garbage-value';
      input.setAttribute('data-ref', `${type}-${level}`);
      values.push(input);
      table.appendChild(input);
    }
  }
  fieldset.appendChild(table);

  const save = document.createElement('button');
  save.id = 'garbage-save';
  fieldset.appendChild(save);

  const guide = document.createElement('div');
  guide.className = 'text-faint';
  guide.textContent = 'How garbage works';
  fieldset.appendChild(guide);

  document.body.appendChild(fieldset);
  return { fieldset, legend, usegrb, values, save };
}

describe('installNativeGarbageGuard — обёртка fieldset', () => {
  test('после install подпись с .svp-garbage-disabled-note вставлена сразу после legend', () => {
    const { fieldset, legend } = createGarbageFieldset();
    installNativeGarbageGuard();

    const note = fieldset.querySelector<HTMLDivElement>(':scope > .svp-garbage-disabled-note');
    expect(note).not.toBeNull();
    expect(legend.nextElementSibling).toBe(note);
    expect(note?.textContent).toMatch(/Vanilla\+|auto-cleanup/i);
  });

  test('содержимое fieldset (всё кроме legend и подписи) обёрнуто в .svp-garbage-disabled-content', () => {
    const { fieldset, save } = createGarbageFieldset();
    installNativeGarbageGuard();

    const wrapper = fieldset.querySelector<HTMLDivElement>(
      ':scope > .svp-garbage-disabled-content',
    );
    expect(wrapper).not.toBeNull();
    // garbage-table, кнопка save, text-faint - все внутри wrapper.
    expect(wrapper?.querySelector('.garbage-table')).not.toBeNull();
    expect(wrapper?.querySelector('#garbage-save')).toBe(save);
    expect(wrapper?.querySelector('.text-faint')).not.toBeNull();
    // legend и подпись - НЕ внутри wrapper, а прямые дети fieldset.
    expect(wrapper?.querySelector('legend')).toBeNull();
    expect(wrapper?.querySelector('.svp-garbage-disabled-note')).toBeNull();
  });

  test('повторный install идемпотентен (note и wrapper не дублируются)', () => {
    createGarbageFieldset();
    installNativeGarbageGuard();
    uninstallNativeGarbageGuard();
    installNativeGarbageGuard();

    expect(document.querySelectorAll('.svp-garbage-disabled-note').length).toBe(1);
    expect(document.querySelectorAll('.svp-garbage-disabled-content').length).toBe(1);
  });

  test('uninstall возвращает содержимое fieldset в исходное состояние', () => {
    const { fieldset, legend, usegrb, save } = createGarbageFieldset();
    const childrenBefore = Array.from(fieldset.children);
    installNativeGarbageGuard();
    uninstallNativeGarbageGuard();

    // Подпись и wrapper удалены.
    expect(fieldset.querySelector('.svp-garbage-disabled-note')).toBeNull();
    expect(fieldset.querySelector('.svp-garbage-disabled-content')).toBeNull();
    // legend на месте, и порядок прямых детей восстановлен.
    expect(fieldset.children[0]).toBe(legend);
    const childrenAfter = Array.from(fieldset.children);
    expect(childrenAfter).toEqual(childrenBefore);
    // Inputs тоже снова доступны (закрытые в wrapper они оставались доступны через querySelector,
    // но именно структура fieldset > * восстановилась).
    expect(usegrb.closest('fieldset')).toBe(fieldset);
    expect(save.closest('fieldset')).toBe(fieldset);
  });

  test('observer догоняет fieldset, добавленный после install', async () => {
    installNativeGarbageGuard();
    const { fieldset } = createGarbageFieldset();
    await Promise.resolve();
    await Promise.resolve();

    expect(fieldset.querySelector('.svp-garbage-disabled-note')).not.toBeNull();
    expect(fieldset.querySelector('.svp-garbage-disabled-content')).not.toBeNull();
  });
});
