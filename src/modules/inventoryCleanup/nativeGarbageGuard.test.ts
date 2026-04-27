import { installNativeGarbageGuard, uninstallNativeGarbageGuard } from './nativeGarbageGuard';

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
  // Каркас из refs/game-beta/dom/body.html:145-161 — чекбокс usegrb,
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
});
