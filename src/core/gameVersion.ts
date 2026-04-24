export const SBG_COMPATIBLE_VERSIONS: readonly string[] = ['0.6.0', '0.6.1'];

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
  'nextPointNavigation',
]);

export function isModuleNativeInCurrentGame(moduleId: string): boolean {
  return isSbg061Detected() && DEPRECATED_SINCE_061.has(moduleId);
}

// Модули, которые конфликтуют с новой версией SBG: use case у нашей
// реализации не перекрыт нативом, но новая версия ввела жест/событие
// на тех же DOM-элементах, что слушает наш модуль — одновременная
// работа даёт сломанный UX (двойное срабатывание, перехват жеста и т. п.).
// Отличие от DEPRECATED_SINCE_061 принципиальное: там игра заменила
// нашу фичу — подпись «Реализовано в игре»; здесь наш функционал
// пропадает без нативной замены — подпись «Конфликтует с новой версией игры».
const CONFLICTS_WITH_061: ReadonlySet<string> = new Set<string>(['swipeToClosePopup']);

export function isModuleConflictingWithCurrentGame(moduleId: string): boolean {
  return isSbg061Detected() && CONFLICTS_WITH_061.has(moduleId);
}
