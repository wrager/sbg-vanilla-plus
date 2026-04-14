export function isSbgScout(): boolean {
  return navigator.userAgent.includes('SbgScout/');
}

// Модули, несовместимые с SBG Scout. Scout — Android WebView с нативным
// управлением экраном, поэтому Wake Lock API от keepScreenOn конфликтует
// с хостом и модуль там не должен работать.
const DISALLOWED_IN_SCOUT: ReadonlySet<string> = new Set<string>(['keepScreenOn']);

export function isModuleDisallowedInCurrentHost(moduleId: string): boolean {
  return isSbgScout() && DISALLOWED_IN_SCOUT.has(moduleId);
}
