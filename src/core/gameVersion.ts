export const SBG_COMPATIBLE_VERSIONS: readonly string[] = ['0.6.0', '0.6.1'];

// Сервер SBG ставит заголовок `x-sbg-version` на КАЖДЫЙ ответ /api/*,
// включая 404. CUI (refs/cui/index.js:1499-1501) и EUI
// (refs/eui/src/constants/index.js:24) детектят версию именно так.
// Мы опираемся на этот же публичный API-контракт: он стабильнее любого
// клиентского сигнала (DOM-маркера, имени скрипта, inline-текста) —
// тех вещей, которые игра может переформатировать в любой версии, не
// трогая backend. Используем HEAD /api/version — эндпоинт не существует
// (404), поэтому запрос максимально лёгкий, но middleware всё равно
// возвращает нужный заголовок.
const VERSION_ENDPOINT = '/api/version';
const VERSION_HEADER = 'x-sbg-version';

let cachedVersion: string | null | undefined;

function normalizeVersion(raw: string): string {
  // Сервер отдаёт форматы `0.6.0` (прод) и `0.6.1-beta` (бета) — для
  // сравнения с SBG_COMPATIBLE_VERSIONS отрезаем пре-релизный суффикс.
  return raw.split('-')[0];
}

export async function initGameVersionDetection(): Promise<void> {
  try {
    const response = await fetch(VERSION_ENDPOINT, { method: 'HEAD' });
    const raw = response.headers.get(VERSION_HEADER);
    cachedVersion = raw ? normalizeVersion(raw) : null;
  } catch {
    cachedVersion = null;
  }
}

/** Сбрасывает кэш. Только для тестов. */
export function resetDetectedVersionForTest(): void {
  cachedVersion = undefined;
}

/** Переопределяет кэш напрямую. Только для тестов. */
export function setDetectedVersionForTest(version: string | null): void {
  cachedVersion = version;
}

/**
 * Возвращает обнаруженную версию игры. null — если детект не запускался,
 * сервер не ответил или заголовок отсутствовал. Синхронна: запускайте
 * `initGameVersionDetection()` до первого вызова.
 */
export function getDetectedVersion(): string | null {
  if (cachedVersion === undefined) {
    console.warn(
      '[SVP] getDetectedVersion() вызвана до initGameVersionDetection(); возвращаю null.',
    );
    return null;
  }
  return cachedVersion;
}

/** Сравнение версий вида `0.6.1`. Возвращает <0, 0, >0 — как Array#sort. */
export function compareVersions(a: string, b: string): number {
  const partsA = a.split('.').map(Number);
  const partsB = b.split('.').map(Number);
  const length = Math.max(partsA.length, partsB.length);
  for (let i = 0; i < length; i++) {
    const diff = (partsA[i] ?? 0) - (partsB[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export function isSbgAtLeast(minVersion: string): boolean {
  const detected = getDetectedVersion();
  if (detected === null) return false;
  return compareVersions(detected, minVersion) >= 0;
}

// Модули, чью функциональность игра реализовала нативно в SBG 0.6.1.
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
  return isSbgAtLeast('0.6.1') && DEPRECATED_SINCE_061.has(moduleId);
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
  return isSbgAtLeast('0.6.1') && CONFLICTS_WITH_061.has(moduleId);
}
