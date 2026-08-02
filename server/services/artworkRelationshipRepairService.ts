import { and, eq, inArray } from "drizzle-orm";
import { buildArtworkAllocationStatus } from "@shared/artworkAllocation";
import { lineItemFiles, orderAttachments, orderAuditLog, orderLineItems, orders } from "@shared/schema";
import { db } from "../db";

type RepairResult = {
  retainedRelationshipIds: string[];
  retiredRelationshipIds: string[];
  unresolvedRelationshipIds: string[];
  activeSourceFiles: string[];
  activeFinalFiles: string[];
  allocationTotal: number;
  remainingBlockers: string[];
  storageCleanup: { attempted: false; reason: string };
};

/**
 * Repairs only an Order attachment's duplicated `original` mirror.  The
 * repair never guesses between two active Order relationships, never touches
 * final production art, and never deletes storage; a retired mirror may still
 * be needed by audit or a derived production file.
 */
export async function repairArtworkRelationshipsForLineItem(args: {
  organizationId: string;
  orderId: string;
  lineItemId: string;
  actorUserId: string;
  actorName: string;
}): Promise<RepairResult> {
  return db.transaction(async (tx) => {
    const [line] = await tx.select({ id: orderLineItems.id, quantity: orderLineItems.quantity })
      .from(orderLineItems)
      .innerJoin(orders, and(eq(orders.id, orderLineItems.orderId), eq(orders.organizationId, args.organizationId)))
      .where(and(eq(orderLineItems.id, args.lineItemId), eq(orderLineItems.orderId, args.orderId)))
      .limit(1);
    if (!line) throw Object.assign(new Error("Order line item not found."), { statusCode: 404 });

    const attachments = await tx.select({
      id: orderAttachments.id, fileRecordId: orderAttachments.fileRecordId, role: orderAttachments.role,
      side: orderAttachments.side, productionQuantity: orderAttachments.productionQuantity,
      productionGroupId: orderAttachments.productionGroupId,
    }).from(orderAttachments).where(and(
      eq(orderAttachments.orderId, args.orderId),
      eq(orderAttachments.orderLineItemId, args.lineItemId),
      inArray(orderAttachments.role, ["artwork", "output"]),
    ));
    const originals = await tx.select({
      id: lineItemFiles.id, fileRecordId: lineItemFiles.fileRecordId,
      sourceOrderAttachmentId: lineItemFiles.sourceOrderAttachmentId,
    }).from(lineItemFiles).where(and(
      eq(lineItemFiles.organizationId, args.organizationId), eq(lineItemFiles.orderId, args.orderId),
      eq(lineItemFiles.lineItemId, args.lineItemId), eq(lineItemFiles.role, "original"), eq(lineItemFiles.status, "active"),
    ));
    const finals = await tx.select({ id: lineItemFiles.id }).from(lineItemFiles).where(and(
      eq(lineItemFiles.organizationId, args.organizationId), eq(lineItemFiles.orderId, args.orderId),
      eq(lineItemFiles.lineItemId, args.lineItemId), eq(lineItemFiles.role, "final"), eq(lineItemFiles.status, "active"),
    ));

    const attachmentById = new Map(attachments.map((attachment) => [attachment.id, attachment]));
    const attachmentsByFileRecord = new Map<string, typeof attachments>();
    for (const attachment of attachments) {
      if (!attachment.fileRecordId) continue;
      attachmentsByFileRecord.set(String(attachment.fileRecordId), [...(attachmentsByFileRecord.get(String(attachment.fileRecordId)) ?? []), attachment]);
    }
    const retireIds: string[] = [];
    const unresolvedRelationshipIds: string[] = [];
    for (const original of originals) {
      if (original.sourceOrderAttachmentId && attachmentById.has(original.sourceOrderAttachmentId)) {
        retireIds.push(original.id);
        continue;
      }
      const sameRecordAttachments = original.fileRecordId ? attachmentsByFileRecord.get(String(original.fileRecordId)) ?? [] : [];
      // Legacy mirrors did not record provenance. A single active attachment
      // with the same canonical file record is safe to identify as its mirror.
      if (!original.sourceOrderAttachmentId && sameRecordAttachments.length === 1) {
        retireIds.push(original.id);
      } else if (!original.sourceOrderAttachmentId && sameRecordAttachments.length > 1) {
        unresolvedRelationshipIds.push(original.id);
      }
    }
    if (retireIds.length > 0) {
      await tx.update(lineItemFiles).set({ status: "retired" }).where(inArray(lineItemFiles.id, retireIds));
    }
    const allocation = buildArtworkAllocationStatus({
      lineQuantity: line.quantity,
      members: attachments.map((attachment) => ({
        id: attachment.id, role: attachment.role, side: attachment.side,
        productionQuantity: attachment.productionQuantity, productionGroupId: attachment.productionGroupId,
      })),
    });
    const remainingBlockers = [
      ...(unresolvedRelationshipIds.length > 0 ? ["Ambiguous legacy artwork mirrors require an explicit admin selection."] : []),
      ...(allocation.valid ? [] : [allocation.issue ?? "Artwork allocation is unresolved."]),
    ];
    await tx.insert(orderAuditLog).values({
      orderId: args.orderId, orderLineItemId: args.lineItemId, userId: args.actorUserId, userName: args.actorName,
      actionType: "artwork_relationship_repaired", fromStatus: null, toStatus: null,
      note: retireIds.length ? "Retired duplicate Order-artwork traceability mirrors." : "Artwork relationships inspected; no safe duplicate retirement was available.",
      metadata: { retainedRelationshipIds: attachments.map((attachment) => attachment.id), retiredRelationshipIds: retireIds, unresolvedRelationshipIds },
    } as any);
    return {
      retainedRelationshipIds: attachments.map((attachment) => attachment.id), retiredRelationshipIds: retireIds,
      unresolvedRelationshipIds, activeSourceFiles: attachments.map((attachment) => attachment.id),
      activeFinalFiles: finals.map((file) => file.id), allocationTotal: allocation.allocatedTotal,
      remainingBlockers, storageCleanup: { attempted: false, reason: "No storage object was deleted; retired relationships may remain referenced by production history." },
    };
  });
}
