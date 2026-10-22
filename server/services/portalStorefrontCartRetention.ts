import { and, eq, isNull, lt } from 'drizzle-orm';
import { fileRecords, portalStorefrontCartFiles, portalStorefrontCarts, storagePlacements } from '@shared/schema';
import { db } from '../db';
import { deleteStoredObjectKeysIfUnreferenced } from './storage/storageReferenceGuard';

/**
 * A dormant, unsubmitted cart is retained for 90 days after its last edit.
 * Staged files removed by a customer or abandoned with a cart receive a 30-day
 * grace period before physical cleanup. Submitted Order artwork is never pruned.
 */
export const PORTAL_CART_INACTIVITY_DAYS = 90;
export const PORTAL_CART_REMOVED_FILE_GRACE_DAYS = 30;

export async function cleanupAbandonedPortalCarts(now = new Date()): Promise<{ abandoned: number; filesDeleted: number }> {
  const inactiveBefore = new Date(now.getTime() - PORTAL_CART_INACTIVITY_DAYS * 86_400_000);
  const removedBefore = new Date(now.getTime() - PORTAL_CART_REMOVED_FILE_GRACE_DAYS * 86_400_000);
  const candidates = await db.select({ id: portalStorefrontCarts.id }).from(portalStorefrontCarts)
    .where(and(eq(portalStorefrontCarts.status, 'open'), lt(portalStorefrontCarts.updatedAt, inactiveBefore))).limit(25);
  let abandoned = 0;
  for (const candidate of candidates) {
    const changed = await db.transaction(async tx => {
      const [cart] = await tx.update(portalStorefrontCarts).set({ status: 'abandoned', review: null, updatedAt: now })
        .where(and(eq(portalStorefrontCarts.id, candidate.id), eq(portalStorefrontCarts.status, 'open'),
          lt(portalStorefrontCarts.updatedAt, inactiveBefore))).returning({ id: portalStorefrontCarts.id });
      if (!cart) return false;
      await tx.update(portalStorefrontCartFiles).set({ removedAt: now })
        .where(and(eq(portalStorefrontCartFiles.cartId, cart.id), isNull(portalStorefrontCartFiles.removedAt),
          isNull(portalStorefrontCartFiles.orderAttachmentId)));
      return true;
    });
    if (changed) abandoned += 1;
  }

  const expired = await db.select({ file: portalStorefrontCartFiles, cart: portalStorefrontCarts })
    .from(portalStorefrontCartFiles)
    .innerJoin(portalStorefrontCarts, eq(portalStorefrontCartFiles.cartId, portalStorefrontCarts.id))
    .where(and(lt(portalStorefrontCartFiles.removedAt, removedBefore),
      isNull(portalStorefrontCartFiles.orderAttachmentId))).limit(25);
  let filesDeleted = 0;
  for (const { file, cart } of expired) {
    const [record] = await db.select({ lifecycleState: fileRecords.lifecycleState })
      .from(fileRecords).where(and(eq(fileRecords.id, file.fileRecordId), eq(fileRecords.organizationId, file.organizationId))).limit(1);
    if (!record || record.lifecycleState === 'deleted') continue;
    const [placement] = await db.select().from(storagePlacements)
      .where(and(eq(storagePlacements.fileRecordId, file.fileRecordId), eq(storagePlacements.placementState, 'active'))).limit(1);
    const key = placement?.objectKey ?? placement?.localPathRef;
    if (!placement || !key) continue;
    // Keep the cart row as audit metadata. The shared guard checks every other
    // known live consumer, including submitted Order attachments, before delete.
    const result = await deleteStoredObjectKeysIfUnreferenced({
      organizationId: file.organizationId, fileRecordId: file.fileRecordId,
      sourcePlacementId: placement.id, keys: [key], logContext: { portalCartId: cart.id },
    });
    if (result.skipped || result.failedKeys.length || result.deletedKeys.length !== 1) continue;
    await db.transaction(async tx => {
      await tx.update(storagePlacements).set({ placementState: 'deleted' })
        .where(and(eq(storagePlacements.id, placement.id), eq(storagePlacements.fileRecordId, file.fileRecordId)));
      await tx.update(fileRecords).set({ lifecycleState: 'deleted', updatedAt: now })
        .where(and(eq(fileRecords.id, file.fileRecordId), eq(fileRecords.organizationId, file.organizationId)));
    });
    filesDeleted += 1;
  }
  return { abandoned, filesDeleted };
}
