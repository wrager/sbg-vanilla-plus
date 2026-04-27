export const SBG_COMPATIBLE_VERSIONS: readonly string[] = ['0.6.0', '0.6.1'];

// Сервер SBG ставит заголовок `x-sbg-version` на ответы обычных игровых
// запросов к /api/*. Игра сама берёт версию именно так: в
// refs/game/script.js:363 после fetch /api/self выполняется
// `VERSION = request.headers.get('x-sbg-version')`. CUI
// (refs/cui/index.js:1494-1501, функция getSelfData делает
// `fetch('/api/self')` и читает заголовок из ответа) и EUI
// (refs/eui/src/informer/index.js:8-11, тот же паттерн с /api/self)
// поступают так же.
//
// Мы НЕ делаем отдельного запроса за версией: перехватываем window.fetch
// в document-start (до загрузки игрового скрипта) и на первом ответе с
// заголовком x-sbg-version запоминаем версию. Плюсы: нет лишнего /api/*
// трафика; нет зависимости от конкретного endpoint-а. Раньше код делал
// HEAD /api/version в надежде, что middleware всегда ставит заголовок —
// оказалось, 404 от несуществующего endpoint-а приходит без x-sbg-version,
// и детект всегда возвращал null.
const VERSION_HEADER = 'x-sbg-version';
const DEFAULT_DETECTION_TIMEOUT_MS = 5000;

let cachedVersion: string | null | undefined;
let detectionWaiters: Array<() => void> = [];

function normalizeVersion(raw: string): string {
  // Сервер отдаёт форматы `0.6.0` (прод) и `0.6.1-beta` (бета) — для
  // сравнения с SBG_COMPATIBLE_VERSIONS отрезаем пре-релизный суффикс.
  return raw.split('-')[0];
}

function recordCapturedVersion(raw: string): void {
  // Первый пойманный заголовок фиксируем. Повторы игнорируем: версия
  // не должна меняться в середине сессии — если игра обновится на
  // сервере, её собственный код покажет «требуется обновление», а нам
  // важно знать версию на момент загрузки страницы.
  if (cachedVersion) return;
  cachedVersion = normalizeVersion(raw);
  const resolved = detectionWaiters;
  detectionWaiters = [];
  for (const resolve of resolved) resolve();
}

/**
 * Ставит monkey-patch на `window.fetch`, чтобы подсматривать заголовок
 * `x-sbg-version` в ответах на игровые /api/* запросы. Должна быть
 * вызвана в document-start — до того как игровой скрипт начнёт слать
 * запросы, иначе первые ответы пролетят мимо.
 */
export function installGameVersionCapture(): void {
  const originalFetch = window.fetch;
  window.fetch = function patchedFetch(
    this: typeof window,
    ...args: Parameters<typeof window.fetch>
  ): Promise<Response> {
    const responsePromise = originalFetch.apply(this, args);
    void responsePromise.then(
      (response) => {
        const raw = response.headers.get(VERSION_HEADER);
        if (raw) recordCapturedVersion(raw);
      },
      () => {
        // Оригинальный fetch упал — версии нет, но rejection оригинала
        // уже идёт наружу через возвращаемый responsePromise.
      },
    );
    return responsePromise;
  };
}

/**
 * Ждёт, пока перехватчик поймает версию из /api/* ответа. Если за
 * `timeoutMs` ни один ответ не принёс заголовок — фиксирует null
 * (safe default: модули работают как на минимальной совместимой версии).
 * Идемпотентна: повторные вызовы после первого захвата/таймаута
 * резолвятся сразу.
 */
export function initGameVersionDetection(
  timeoutMs: number = DEFAULT_DETECTION_TIMEOUT_MS,
): Promise<void> {
  if (cachedVersion !== undefined) return Promise.resolve();

  return new Promise<void>((resolve) => {
    const waiter = (): void => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      if (cachedVersion === undefined) cachedVersion = null;
      const idx = detectionWaiters.indexOf(waiter);
      if (idx !== -1) detectionWaiters.splice(idx, 1);
      resolve();
    }, timeoutMs);
    detectionWaiters.push(waiter);
  });
}

/** Сбрасывает кэш и ожидающих. Только для тестов. */
export function resetDetectedVersionForTest(): void {
  cachedVersion = undefined;
  detectionWaiters = [];
}

/** Переопределяет кэш напрямую. Только для тестов. */
export function setDetectedVersionForTest(version: string | null): void {
  cachedVersion = version;
}

/**
 * Возвращает обнаруженную версию игры. null — если детект не запускался,
 * ни один ответ не принёс заголовок или истёк таймаут. Синхронна:
 * `installGameVersionCapture()` в document-start + await
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

export function isSbgGreaterThan(version: string): boolean {
  const detected = getDetectedVersion();
  if (detected === null) return false;
  return compareVersions(detected, version) > 0;
}

// Модули, чью функциональность игра реализовала нативно. Множество заполняется
// по одному id за раз — каждый с обоснованием перекрытия use case в commit
// message соответствующего коммита. На 0.6.1 список изначально содержал
// favoritedPoints, inventoryCleanup, keyCountOnPoints (переименован в
// keyCountFix), singleFingerRotation, nextPointNavigation — после полноценной
// адаптации модули возвращены (с переосмыслением и/или runtime-детекцией
// native), сет очищен.
const DEPRECATED_MODULES_NATIVE: ReadonlySet<string> = new Set<string>([]);

export function isModuleNativeInCurrentGame(moduleId: string): boolean {
  return isSbgGreaterThan('0.6.0') && DEPRECATED_MODULES_NATIVE.has(moduleId);
}

// Модули, которые конфликтуют с новой версией SBG: use case у нашей
// реализации не перекрыт нативом, но новая версия ввела жест/событие
// на тех же DOM-элементах, что слушает наш модуль — одновременная
// работа даёт сломанный UX (двойное срабатывание, перехват жеста и т. п.).
// Отличие от DEPRECATED_MODULES_NATIVE принципиальное: там игра заменила
// нашу фичу — подпись «Реализовано в игре»; здесь наш функционал
// пропадает без нативной замены — подпись «Конфликтует с новой версией игры».
const DEPRECATED_MODULES_CONFLICTED: ReadonlySet<string> = new Set<string>([]);

export function isModuleConflictingWithCurrentGame(moduleId: string): boolean {
  return isSbgGreaterThan('0.6.0') && DEPRECATED_MODULES_CONFLICTED.has(moduleId);
}
