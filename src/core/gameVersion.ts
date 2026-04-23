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
