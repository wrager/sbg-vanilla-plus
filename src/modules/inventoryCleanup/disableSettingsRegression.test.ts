// Регрессионный тест: enable/disable цикл не должен ломать localStorage.setItem.
import { inventoryCleanup } from './inventoryCleanup';

const SVP_SETTINGS_KEY = 'svp_settings';

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(
    SVP_SETTINGS_KEY,
    JSON.stringify({
      version: 3,
      modules: { inventoryCleanup: true, favoritedPoints: true },
      errors: {},
    }),
  );
});

afterEach(() => {
  // Гарантируем чистый state: если какой-то тест оставил wrapper, снимаем его.
  try {
    void inventoryCleanup.disable();
  } catch {
    // ignore
  }
});

describe('inventoryCleanup disable восстанавливает setItem', () => {
  test('после enable + disable svp_settings целы, записи работают', () => {
    const native = localStorage.setItem;

    void inventoryCleanup.enable();
    expect(localStorage.setItem).not.toBe(native);

    // Во время работы wrapper'а svp_settings должен обновляться корректно.
    localStorage.setItem(
      SVP_SETTINGS_KEY,
      JSON.stringify({
        version: 3,
        modules: { inventoryCleanup: false, favoritedPoints: true },
        errors: {},
      }),
    );

    void inventoryCleanup.disable();
    expect(localStorage.setItem).toBe(native);

    const raw = localStorage.getItem(SVP_SETTINGS_KEY);
    const parsed = JSON.parse(raw ?? '{}') as { modules: Record<string, boolean> };
    expect(parsed.modules.inventoryCleanup).toBe(false);
    expect(parsed.modules.favoritedPoints).toBe(true);
  });

  test('idempotency: двойной enable не создаёт двойной wrapper', () => {
    const native = localStorage.setItem;

    void inventoryCleanup.enable();
    const afterFirst = localStorage.setItem;
    expect(afterFirst).not.toBe(native);

    // Повторный enable без disable: должен быть no-op благодаря guard'у.
    void inventoryCleanup.enable();
    const afterSecond = localStorage.setItem;
    expect(afterSecond).toBe(afterFirst); // тот же wrapper

    // disable один раз восстанавливает native.
    void inventoryCleanup.disable();
    expect(localStorage.setItem).toBe(native);
  });

  test('несколько циклов enable/disable оставляют native после последнего disable', () => {
    const native = localStorage.setItem;
    for (let i = 0; i < 3; i++) {
      void inventoryCleanup.enable();
      expect(localStorage.setItem).not.toBe(native);
      void inventoryCleanup.disable();
      expect(localStorage.setItem).toBe(native);
    }
  });
});
