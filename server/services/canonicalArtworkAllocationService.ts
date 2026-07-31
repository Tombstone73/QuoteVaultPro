import { and, eq } from "drizzle-orm";
import { buildArtworkAllocationStatus, getSafeArtworkAllocationDefaults } from "@shared/artworkAllocation";
import { lineItemFiles, orderAuditLog, orderLineItems, orders } from "@shared/schema";
import { db } from "../db";

type FinalArtworkRow = {
  id: string;
  side: "front" | "back" | "both" | "na" | null;
  productionQuantity: number | null;
  productionGroupId: string | null;
};

async function readFinalArtworkAllocation(tx: any, args: { organizationId: string; lineItemId: string }) {
  const [lineItem] = await tx
    .select({ orderId: orderLineItems.orderId, quantity: orderLineItems.quantity })
    .from(orderLineItems)
    .innerJoin(orders, and(eq(orders.id, orderLineItems.orderId), eq(orders.organizationId, args.organizationId)))
    .where(eq(orderLineItems.id, args.lineItemId))
    .limit(1);
  if (!lineItem) return null;

  const files: FinalArtworkRow[] = await tx
    .select({
      id: lineItemFiles.id,
      side: lineItemFiles.sourceArtworkSide,
      productionQuantity: lineItemFiles.productionQuantity,
      productionGroupId: lineItemFiles.productionGroupId,
    })
    .from(lineItemFiles)
    .where(and(
      eq(lineItemFiles.organizationId, args.organizationId),
      eq(lineItemFiles.lineItemId, args.lineItemId),
      eq(lineItemFiles.role, "final"),
      eq(lineItemFiles.status, "active"),
    ));

  return { lineItem, files };
}

function allocationStatus(lineQuantity: unknown, files: FinalArtworkRow[]) {
  return buildArtworkAllocationStatus({
    lineQuantity,
    members: files.map((file) => ({
      id: file.id,
      role: "final",
      side: file.side,
      productionQuantity: file.productionQuantity,
      productionGroupId: file.productionGroupId,
    })),
  });
}

export async function normalizeFinalProductionArtworkAllocations(args: {
  organizationId: string;
  lineItemId: string;
  actorUserId?: string | null;
  actorName?: string | null;
}) {
  return db.transaction(async (tx) => {
    const current = await readFinalArtworkAllocation(tx, args);
    if (!current) return null;

    const defaults = getSafeArtworkAllocationDefaults({
      lineQuantity: current.lineItem.quantity,
      members: current.files.map((file) => ({ ...file, role: "final" })),
    });
    if (defaults.length > 0) {
      for (const update of defaults) {
        await tx.update(lineItemFiles)
          .set({ productionQuantity: update.productionQuantity })
          .where(and(eq(lineItemFiles.id, update.id), eq(lineItemFiles.organizationId, args.organizationId)));
      }
      await tx.insert(orderAuditLog).values({
        orderId: current.lineItem.orderId,
        orderLineItemId: args.lineItemId,
        userId: args.actorUserId ?? null,
        userName: args.actorName ?? "System allocation repair",
        actionType: "production_artwork_allocation_normalized",
        fromStatus: null,
        toStatus: null,
        note: "Applied an unambiguous production-artwork quantity default.",
        metadata: { productionFileIds: defaults.map((update) => update.id), source: "canonical_final_artwork" },
      } as any);
      const quantityById = new Map(defaults.map((update) => [update.id, update.productionQuantity]));
      current.files = current.files.map((file) => ({
        ...file,
        productionQuantity: quantityById.get(file.id) ?? file.productionQuantity,
      }));
    }

    return {
      normalized: defaults.length > 0,
      updatedFileIds: defaults.map((update) => update.id),
      allocation: allocationStatus(current.lineItem.quantity, current.files),
    };
  });
}

export async function synchronizeFinalArtworkForLineQuantityChange(args: {
  organizationId: string;
  lineItemId: string;
  previousLineQuantity: unknown;
  actorUserId?: string | null;
  actorName?: string | null;
}) {
  return db.transaction(async (tx) => {
    const current = await readFinalArtworkAllocation(tx, args);
    if (!current) return null;
    const previousQuantity = Number(args.previousLineQuantity);
    const nextQuantity = Number(current.lineItem.quantity);
    const oneOutputGroup = new Set(current.files.map((file) => file.productionGroupId?.trim() || file.id)).size === 1;
    const followsPreviousLineQuantity = current.files.length > 0 && current.files.every((file) => Number(file.productionQuantity) === previousQuantity);

    let updatedFileIds: string[] = [];
    if (Number.isInteger(nextQuantity) && nextQuantity > 0 && oneOutputGroup && followsPreviousLineQuantity && previousQuantity !== nextQuantity) {
      updatedFileIds = current.files.map((file) => file.id);
      for (const fileId of updatedFileIds) {
        await tx.update(lineItemFiles)
          .set({ productionQuantity: nextQuantity })
          .where(and(eq(lineItemFiles.id, fileId), eq(lineItemFiles.organizationId, args.organizationId)));
      }
      current.files = current.files.map((file) => ({ ...file, productionQuantity: nextQuantity }));
    } else {
      const defaults = getSafeArtworkAllocationDefaults({
        lineQuantity: current.lineItem.quantity,
        members: current.files.map((file) => ({ ...file, role: "final" })),
      });
      for (const update of defaults) {
        await tx.update(lineItemFiles)
          .set({ productionQuantity: update.productionQuantity })
          .where(and(eq(lineItemFiles.id, update.id), eq(lineItemFiles.organizationId, args.organizationId)));
      }
      if (defaults.length > 0) {
        const quantityById = new Map(defaults.map((update) => [update.id, update.productionQuantity]));
        current.files = current.files.map((file) => ({ ...file, productionQuantity: quantityById.get(file.id) ?? file.productionQuantity }));
        updatedFileIds = defaults.map((update) => update.id);
      }
    }

    if (updatedFileIds.length > 0) {
      await tx.insert(orderAuditLog).values({
        orderId: current.lineItem.orderId,
        orderLineItemId: args.lineItemId,
        userId: args.actorUserId ?? null,
        userName: args.actorName ?? "System allocation repair",
        actionType: "production_artwork_allocation_synchronized",
        fromStatus: null,
        toStatus: null,
        note: "Synchronized an unambiguous final production-artwork allocation after the line quantity changed.",
        metadata: { productionFileIds: updatedFileIds, previousLineQuantity: previousQuantity, lineQuantity: nextQuantity },
      } as any);
    }

    return {
      updatedFileIds,
      allocation: allocationStatus(current.lineItem.quantity, current.files),
      requiresReview: updatedFileIds.length === 0 && !allocationStatus(current.lineItem.quantity, current.files).valid,
    };
  });
}
