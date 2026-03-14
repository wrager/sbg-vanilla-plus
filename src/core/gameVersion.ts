export const SBG_COMPATIBLE_VERSION = '0.6.0';

export function checkVersion(version: string): boolean {
  if (version !== SBG_COMPATIBLE_VERSION) {
    console.warn(
      `[SVP] Версия SBG ${version} не совпадает с ожидаемой ${SBG_COMPATIBLE_VERSION}. Возможны проблемы.`,
    );
    return false;
  }
  return true;
}
