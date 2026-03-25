/** Читает значение CSS custom property с fallback. */
export function getCssVariable(name: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

export function getTextColor(): string {
  return getCssVariable('--text', '#000000');
}

export function getBackgroundColor(): string {
  return getCssVariable('--background', '#ffffff');
}
