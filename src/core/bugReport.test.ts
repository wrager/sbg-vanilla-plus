import type { IFeatureModule } from './moduleRegistry';
import { buildBugReportUrl, buildModuleList, buildDiagnosticClipboard } from './bugReport';

function createMockModule(overrides: Partial<IFeatureModule> = {}): IFeatureModule {
  return {
    id: 'testModule',
    name: { en: 'Test', ru: 'Тест' },
    description: { en: 'Test module', ru: 'Тестовый модуль' },
    defaultEnabled: true,
    category: 'ui',
    init: jest.fn(),
    enable: jest.fn(),
    disable: jest.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
});

describe('buildModuleList', () => {
  test('shows enabled modules with checkmark', () => {
    const mod = createMockModule({ id: 'myFeature', defaultEnabled: true });
    const result = buildModuleList([mod]);
    expect(result).toBe('✅ myFeature');
  });

  test('shows disabled modules with empty box', () => {
    const mod = createMockModule({ id: 'myFeature', defaultEnabled: false });
    const result = buildModuleList([mod]);
    expect(result).toBe('⬜ myFeature');
  });

  test('respects saved settings over defaults', () => {
    localStorage.setItem(
      'svp_settings',
      JSON.stringify({ version: 2, modules: { myFeature: false }, errors: {} }),
    );
    const mod = createMockModule({ id: 'myFeature', defaultEnabled: true });
    const result = buildModuleList([mod]);
    expect(result).toBe('⬜ myFeature');
  });
});

describe('buildBugReportUrl', () => {
  test('includes template parameter', () => {
    const url = buildBugReportUrl([]);
    expect(url).toContain('template=bug_report.yml');
  });

  test('includes version', () => {
    const url = buildBugReportUrl([]);
    expect(url).toContain('version=');
  });

  test('includes browser user agent', () => {
    const url = buildBugReportUrl([]);
    expect(url).toContain('browser=');
  });

  test('includes module list', () => {
    const mod = createMockModule({ id: 'testMod' });
    const url = buildBugReportUrl([mod]);
    expect(url).toContain('testMod');
  });

  test('starts with correct repo URL', () => {
    const url = buildBugReportUrl([]);
    expect(url).toMatch(/^https:\/\/github\.com\/wrager\/sbg-vanilla-plus\/issues\/new\?/);
  });
});

describe('buildDiagnosticClipboard', () => {
  test('includes version header', () => {
    const result = buildDiagnosticClipboard([]);
    expect(result).toContain('Версия:');
  });

  test('includes browser info', () => {
    const result = buildDiagnosticClipboard([]);
    expect(result).toContain('Браузер:');
  });

  test('includes module errors', () => {
    localStorage.setItem(
      'svp_settings',
      JSON.stringify({
        version: 2,
        modules: { broken: true },
        errors: { broken: 'Something went wrong' },
      }),
    );
    const mod = createMockModule({ id: 'broken' });
    const result = buildDiagnosticClipboard([mod]);
    expect(result).toContain('❌ Something went wrong');
  });

  test('includes module list section', () => {
    const mod = createMockModule({ id: 'featureA', defaultEnabled: true });
    const result = buildDiagnosticClipboard([mod]);
    expect(result).toContain('Модули:');
    expect(result).toContain('✅ featureA');
  });
});
