import { getCssVariable, getTextColor, getBackgroundColor } from './themeColors';

let cssVarMap: Record<string, string> = {};

beforeEach(() => {
  cssVarMap = {};
  jest.spyOn(window, 'getComputedStyle').mockReturnValue({
    getPropertyValue: (name: string) => cssVarMap[name] ?? '',
  } as CSSStyleDeclaration);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('getCssVariable', () => {
  test('returns trimmed value when present', () => {
    cssVarMap['--text'] = '  #ff0000  ';
    expect(getCssVariable('--text', '#000')).toBe('#ff0000');
  });

  test('returns fallback when empty', () => {
    expect(getCssVariable('--text', '#000')).toBe('#000');
  });

  test('returns fallback when only whitespace', () => {
    cssVarMap['--text'] = '   ';
    expect(getCssVariable('--text', '#000')).toBe('#000');
  });
});

describe('getTextColor', () => {
  test('returns --text value', () => {
    cssVarMap['--text'] = '#123456';
    expect(getTextColor()).toBe('#123456');
  });

  test('returns #000000 as fallback', () => {
    expect(getTextColor()).toBe('#000000');
  });
});

describe('getBackgroundColor', () => {
  test('returns --background value', () => {
    cssVarMap['--background'] = '#abcdef';
    expect(getBackgroundColor()).toBe('#abcdef');
  });

  test('returns #ffffff as fallback', () => {
    expect(getBackgroundColor()).toBe('#ffffff');
  });
});
