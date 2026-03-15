declare const __SVP_VERSION__: string;

import type { IFeatureModule } from './moduleRegistry';
import { formatErrorLog } from './errorLog';
import { loadSettings, isModuleEnabled } from './settings/storage';

const REPO_URL = 'https://github.com/wrager/sbg-vanilla-plus';

export function buildModuleList(modules: readonly IFeatureModule[]): string {
  const settings = loadSettings();
  return modules
    .map((mod) => {
      const enabled = isModuleEnabled(settings, mod.id, mod.defaultEnabled);
      return `${enabled ? '✅' : '⬜'} ${mod.id}`;
    })
    .join('\n');
}

export function buildBugReportUrl(modules: readonly IFeatureModule[]): string {
  const params = new URLSearchParams({
    template: 'bug_report.yml',
    version: __SVP_VERSION__,
    browser: navigator.userAgent,
    modules: buildModuleList(modules),
  });

  return `${REPO_URL}/issues/new?${params.toString()}`;
}

export function buildDiagnosticClipboard(modules: readonly IFeatureModule[]): string {
  const settings = loadSettings();
  const sections: string[] = [];

  sections.push(`Версия: ${__SVP_VERSION__}`);
  sections.push(`Браузер: ${navigator.userAgent}`);

  const moduleLines = modules
    .map((mod) => {
      const enabled = isModuleEnabled(settings, mod.id, mod.defaultEnabled);
      const error = settings.errors[mod.id];
      let line = `${enabled ? '✅' : '⬜'} ${mod.id}`;
      if (error) {
        line += ` ❌ ${error}`;
      }
      return line;
    })
    .join('\n');
  sections.push(`Модули:\n${moduleLines}`);

  const errorLog = formatErrorLog();
  if (errorLog) {
    sections.push(`Лог ошибок:\n${errorLog}`);
  }

  return sections.join('\n\n');
}
