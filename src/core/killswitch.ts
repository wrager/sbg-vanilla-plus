const STORAGE_KEY = 'svp_disabled';

export function isDisabled(): boolean {
  const hash = location.hash;
  const match = /[#&]svp-disabled=([01])/.exec(hash);

  if (match) {
    if (match[1] === '1') {
      sessionStorage.setItem(STORAGE_KEY, '1');
    } else {
      sessionStorage.removeItem(STORAGE_KEY);
    }
  }

  return sessionStorage.getItem(STORAGE_KEY) === '1';
}
