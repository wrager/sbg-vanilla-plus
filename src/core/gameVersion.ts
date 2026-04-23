export const SBG_COMPATIBLE_VERSIONS: readonly string[] = ['0.6.0', '0.6.1'];

export function checkVersion(version: string): boolean {
  if (!SBG_COMPATIBLE_VERSIONS.includes(version)) {
    console.warn(
      `[SVP] Версия SBG ${version} не входит в список поддерживаемых (${SBG_COMPATIBLE_VERSIONS.join(', ')}). Возможны проблемы.`,
    );
    return false;
  }
  return true;
}

// Статический DOM-маркер 0.6.1: .navi-floater есть в body.html с классом
// hidden и доступен сразу после DOMContentLoaded. SBG_FLAVOR сидит в
// closure игрового скрипта и снаружи не виден, поэтому версию определяем
// по разметке.
export function isSbg061Detected(): boolean {
  return document.querySelector('.navi-floater') !== null;
}

// Модули, чья функциональность реализована нативно в SBG 0.6.1.
// Множество заполняется по одному id за раз — каждый с обоснованием
// перекрытия use case в commit message соответствующего коммита.
const DEPRECATED_SINCE_061: ReadonlySet<string> = new Set<string>([
  'favoritedPoints',
  'inventoryCleanup',
  'keyCountOnPoints',
  'repairAtFullCharge',
  'ngrsZoom',
  'singleFingerRotation',
]);

export function isModuleNativeInCurrentGame(moduleId: string): boolean {
  return isSbg061Detected() && DEPRECATED_SINCE_061.has(moduleId);
}

// Возвращает версию игры, в которой модуль стал нативным. Используется
// только как описание причины — в UI подпись «Реализовано в игре»
// не показывает версию, но функция оставлена для тестов и логов.
export function getGameVersionWhereNative(moduleId: string): string | null {
  if (DEPRECATED_SINCE_061.has(moduleId)) return '0.6.1';
  return null;
}
