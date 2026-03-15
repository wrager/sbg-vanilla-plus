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

  const moduleErrors = modules
    .filter((mod) => settings.errors[mod.id])
    .map((mod) => `${mod.id}: ${settings.errors[mod.id]}`)
    .join('\n');
  if (moduleErrors) {
    sections.push(`Ошибки модулей:\n${moduleErrors}`);
  }

  const errorLog = formatErrorLog();
  if (errorLog) {
    sections.push(`Лог консоли:\n${errorLog}`);
  }

  if (sections.length === 0) {
    return 'Ошибок не обнаружено';
  }

  return sections.join('\n\n');
}
