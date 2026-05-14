import { getFavoritedGuids, isFavoritesSnapshotReady, isLockMigrationDone } from './favoritesStore';
import { isModuleEnabledByUser } from './moduleRegistry';

/**
 * Тот же инвариант, что `blockReferences` в inventoryCleanup.runCleanupImpl и
 * видимость slow-кнопки в slowRefsDelete.shouldShowButton: пока пользователь не
 * подтвердил миграцию SVP/CUI-избранных в native lock и в IDB остаётся legacy
 * или снимок ещё не готов, массовое удаление ключей по inventory-cache
 * опасно (нативные f-флаги не отражают legacy-избранное).
 */
export function isReferenceMassDeleteBlockedByLegacyMigration(): boolean {
  return (
    !isLockMigrationDone() &&
    isModuleEnabledByUser('favoritesMigration') &&
    (!isFavoritesSnapshotReady() || getFavoritedGuids().size > 0)
  );
}

type LegacyMigrationRefsDeletionBlockReason = 'snapshot' | 'legacy';

/**
 * Если {@link isReferenceMassDeleteBlockedByLegacyMigration} true - дискретная
 * причина для пользовательского сообщения (см. slowRefsDelete.runSlowDelete).
 */
export function getLegacyMigrationRefsDeletionBlockReason(): LegacyMigrationRefsDeletionBlockReason | null {
  if (!isReferenceMassDeleteBlockedByLegacyMigration()) return null;
  if (
    !isLockMigrationDone() &&
    isModuleEnabledByUser('favoritesMigration') &&
    !isFavoritesSnapshotReady()
  ) {
    return 'snapshot';
  }
  return 'legacy';
}
