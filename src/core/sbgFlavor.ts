declare const __SVP_VERSION__: string;

const FLAVOR_HEADER = 'x-sbg-flavor';
const FLAVOR_VALUE = `VanillaPlus/${__SVP_VERSION__}`;

export function installSbgFlavor(): void {
  const originalFetch = window.fetch;

  window.fetch = function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const headers = new Headers(init?.headers);

    const existing = headers.get(FLAVOR_HEADER);
    if (existing) {
      const flavors = existing.split(' ');
      if (!flavors.includes(FLAVOR_VALUE)) {
        flavors.push(FLAVOR_VALUE);
      }
      headers.set(FLAVOR_HEADER, flavors.join(' '));
    } else {
      headers.set(FLAVOR_HEADER, FLAVOR_VALUE);
    }

    return originalFetch.call(this, input, { ...init, headers });
  };
}
