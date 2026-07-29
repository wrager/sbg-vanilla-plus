declare const __SVP_VERSION__: string;

const FLAVOR_HEADER = 'x-sbg-flavor';

/** Идентификатор скрипта в формате игры (`Stock/0.7.0`, `CUI/x.y.z`). */
export const SVP_FLAVOR = `VanillaPlus/${__SVP_VERSION__}`;

export function installSbgFlavor(): void {
  const originalFetch = window.fetch;

  window.fetch = function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const headers = new Headers(init?.headers);

    const existing = headers.get(FLAVOR_HEADER);
    if (existing) {
      const flavors = existing.split(' ');
      if (!flavors.includes(SVP_FLAVOR)) {
        flavors.push(SVP_FLAVOR);
      }
      headers.set(FLAVOR_HEADER, flavors.join(' '));
    } else {
      headers.set(FLAVOR_HEADER, SVP_FLAVOR);
    }

    return originalFetch.call(this, input, { ...init, headers });
  };
}
