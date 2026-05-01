import { betterRefPopoverClosing } from './betterRefPopoverClosing';

describe('betterRefPopoverClosing - metadata', () => {
  test('id', () => {
    expect(betterRefPopoverClosing.id).toBe('betterRefPopoverClosing');
  });
  test('category fix (поведенческий патч игрового UX, не визуальный)', () => {
    expect(betterRefPopoverClosing.category).toBe('fix');
  });
  test('defaultEnabled', () => {
    expect(betterRefPopoverClosing.defaultEnabled).toBe(true);
  });
  test('localized name and description', () => {
    expect(betterRefPopoverClosing.name.ru).toBeTruthy();
    expect(betterRefPopoverClosing.name.en).toBeTruthy();
    expect(betterRefPopoverClosing.description.ru).toBeTruthy();
    expect(betterRefPopoverClosing.description.en).toBeTruthy();
  });
});

describe('betterRefPopoverClosing - lifecycle', () => {
  afterEach(() => {
    void betterRefPopoverClosing.disable();
    document.body.innerHTML = '';
    document.head.innerHTML = '';
  });

  test('enable не инжектит CSS (модуль перестал тащить 3-line layout)', async () => {
    await betterRefPopoverClosing.enable();
    expect(document.querySelectorAll('style').length).toBe(0);
  });

  test('enable идемпотентен по lifecycle (повторный enable не падает)', async () => {
    await betterRefPopoverClosing.enable();
    expect(() => betterRefPopoverClosing.enable()).not.toThrow();
  });
});
