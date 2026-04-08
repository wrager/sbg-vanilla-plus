import {
  getFavoritesProtectionSnapshot,
  resetFavoritesProtectionForTests,
  syncFavoritesProtection,
} from './favoritesProtection';

const PROTECTED_KEY = 'svp_favorites_protected_v1';
const BACKUP_KEY = 'svp_favorites_backup_v1';

beforeEach(() => {
  localStorage.clear();
  resetFavoritesProtectionForTests();
});

afterEach(() => {
  resetFavoritesProtectionForTests();
});

describe('favoritesProtection', () => {
  test('sync сохраняет текущие избранные в sticky-защиту', () => {
    const first = syncFavoritesProtection(new Set(['p1', 'p2']));
    expect(first.storageHealthy).toBe(true);
    expect(first.protectedGuids).toEqual(new Set(['p1', 'p2']));

    const second = syncFavoritesProtection(new Set());
    expect(second.storageHealthy).toBe(true);
    // sticky: p1/p2 остаются защищёнными даже при пустом текущем избранном
    expect(second.protectedGuids).toEqual(new Set(['p1', 'p2']));
  });

  test('snapshot объединяет текущие + backup + protected', () => {
    localStorage.setItem(
      PROTECTED_KEY,
      JSON.stringify({
        version: 1,
        guids: ['p-protected'],
      }),
    );
    localStorage.setItem(
      BACKUP_KEY,
      JSON.stringify({
        version: 1,
        guids: ['p-backup'],
      }),
    );

    const snapshot = getFavoritesProtectionSnapshot(new Set(['p-current']));
    expect(snapshot.storageHealthy).toBe(true);
    expect(snapshot.protectedGuids).toEqual(new Set(['p-current', 'p-protected', 'p-backup']));
  });

  test('битый protected-store переводит snapshot в unhealthy (fail-closed)', () => {
    localStorage.setItem(PROTECTED_KEY, '{broken');
    const snapshot = getFavoritesProtectionSnapshot(new Set(['p-current']));
    expect(snapshot.storageHealthy).toBe(false);
    // Текущее избранное всё равно учитывается как защищённое в памяти.
    expect(snapshot.protectedGuids).toEqual(new Set(['p-current']));
  });

  test('битый backup-store переводит sync в unhealthy и не перезаписывается автоматически', () => {
    localStorage.setItem(BACKUP_KEY, '{broken');
    const snapshot = syncFavoritesProtection(new Set(['p1']));
    expect(snapshot.storageHealthy).toBe(false);
    expect(snapshot.protectedGuids).toEqual(new Set(['p1']));
    expect(localStorage.getItem(BACKUP_KEY)).toBe('{broken');
  });
});

