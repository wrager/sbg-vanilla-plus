import {
  isGameScript,
  applyPatches,
  EXPECTED_PATCHES_COUNT,
  installGameScriptPatcher,
} from './gameScriptPatcher';

// ── isGameScript ─────────────────────────────────────────────────────────────

describe('isGameScript', () => {
  test('returns true for game script element', () => {
    const script = document.createElement('script');
    script.type = 'module';
    script.setAttribute('src', 'script@0.6.0.7eda6a0935.1.js');
    expect(isGameScript(script)).toBe(true);
  });

  test('returns false for non-module script', () => {
    const script = document.createElement('script');
    script.setAttribute('src', 'script@0.6.0.7eda6a0935.1.js');
    expect(isGameScript(script)).toBe(false);
  });

  test('returns false for module script with different src', () => {
    const script = document.createElement('script');
    script.type = 'module';
    script.setAttribute('src', 'intel@0.6.0.abc123.js');
    expect(isGameScript(script)).toBe(false);
  });

  test('returns false for module script without src', () => {
    const script = document.createElement('script');
    script.type = 'module';
    expect(isGameScript(script)).toBe(false);
  });

  test('returns false for text node', () => {
    expect(isGameScript('some text')).toBe(false);
  });

  test('returns false for non-script element', () => {
    const div = document.createElement('div');
    expect(isGameScript(div)).toBe(false);
  });
});

// ── applyPatches ─────────────────────────────────────────────────────────────

describe('applyPatches', () => {
  // Воспроизводит блок из refs/game/script.js:722-726 с LF — именно так,
  // как мы ожидаем в production-сборке скрипта игры.
  const NATIVE_HAMMER_BLOCK = [
    "  const hammer_info = new Hammer(document.querySelector('.info'), {",
    '    recognizers: [',
    '      [Hammer.Swipe, { direction: Hammer.DIRECTION_HORIZONTAL }],',
    '    ],',
    '  })',
    "  hammer_info.on('swipeleft swiperight', function(event) {})",
  ].join('\n');

  test('applies showInfo patch when marker found', () => {
    const source = `const x = 1; class Bitfield { }\n${NATIVE_HAMMER_BLOCK}`;
    const { result, appliedCount } = applyPatches(source);
    expect(result).toContain('window.showInfo = showInfo');
    expect(result).toContain('class Bitfield');
    expect(appliedCount).toBe(EXPECTED_PATCHES_COUNT);
  });

  test('disables native .info hammer swipe', () => {
    const source = `class Bitfield { }\n${NATIVE_HAMMER_BLOCK}`;
    const { result, appliedCount } = applyPatches(source);
    expect(result).toContain('__svpNativeInfoSwipeDisabled = true');
    expect(result).toContain('{ on() {} }');
    // Нативного new Hammer(...) больше нет в выходе:
    expect(result).not.toMatch(/new Hammer\(document\.querySelector\('\.info'\)/);
    expect(appliedCount).toBe(EXPECTED_PATCHES_COUNT);
  });

  test('returns original when marker not found', () => {
    const source = 'const x = 1; const y = 2;';
    const { result, appliedCount } = applyPatches(source);
    expect(result).toBe(source);
    expect(appliedCount).toBe(0);
  });

  test('expected patches count is positive', () => {
    expect(EXPECTED_PATCHES_COUNT).toBeGreaterThan(0);
  });
});

// ── installGameScriptPatcher ─────────────────────────────────────────────────

describe('installGameScriptPatcher', () => {
  let originalAppend: Element['append'];

  beforeEach(() => {
    originalAppend = Element.prototype.append;
  });

  afterEach(() => {
    // Восстановить оригинальный append на случай если тест не сработал
    Element.prototype.append = originalAppend;
  });

  test('overrides Element.prototype.append', () => {
    installGameScriptPatcher();
    expect(Element.prototype.append).not.toBe(originalAppend);
    // Восстанавливаем
    Element.prototype.append = originalAppend;
  });

  test('restores original append after intercepting game script', () => {
    installGameScriptPatcher();

    const script = document.createElement('script');
    script.type = 'module';
    script.setAttribute('src', 'script@0.6.0.test.js');

    // fetch не сработает в jsdom, но override должен восстановиться синхронно
    document.head.append(script);

    expect(Element.prototype.append).toBe(originalAppend);
  });

  test('passes non-game scripts through to original append', () => {
    installGameScriptPatcher();

    const div = document.createElement('div');
    div.id = 'patcher-test-passthrough';
    document.body.append(div);

    expect(document.getElementById('patcher-test-passthrough')).not.toBeNull();

    // Cleanup
    div.remove();
    Element.prototype.append = originalAppend;
  });
});
