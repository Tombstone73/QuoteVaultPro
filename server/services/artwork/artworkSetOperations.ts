import { and, eq, inArray } from "drizzle-orm";
import { randomUUID } from "crypto";
import { buildArtworkAllocationStatus } from "@shared/artworkAllocation";
import { lineItemArtwork, lineItemFiles, orderAttachments, orderAuditLog, orderLineItems, orders } from "@shared/schema";
import { db } from "../../db";

export class ArtworkSetOperationError extends Error {
  constructor(message: string, readonly statusCode = 400, readonly code = "ARTWORK_SET_INVALID") {
    super(message);
  }
}

type Actor = { userId?: string | null; userName?: string | null };

type ApplyArtworkSetInput = Actor & {
  organizationId: string;
  orderId: string;
  lineItemId: string;
  artworkIds: string[];
  productionQuantity: number;
  productionGroupId?: string;
};

function validatedQuantity(value: unknown): number {
  const quantity = Number(value);
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new ArtworkSetOperationError("Artwork Set quantity must be a positive whole number.");
  }
  return quantity;
}

function newArtworkSetId() {
  return `artwork-set:${randomUUID()}`;
}

async function resolveArtworkSetMembers(tx: any, input: ApplyArtworkSetInput) {
  const requestedIds = Array.from(new Set(input.artworkIds.map((id) => String(id).trim()).filter(Boolean)));
  if (requestedIds.length === 0) {
    throw new ArtworkSetOperationError("Select at least one production artwork file.");
  }

  const [lineItem] = await tx
    .select({ id: orderLineItems.id, quantity: orderLineItems.quantity })
    .from(orderLineItems)
    .innerJoin(orders, and(eq(orders.id, orderLineItems.orderId), eq(orders.organizationId, input.organizationId)))
    .where(and(eq(orderLineItems.id, input.lineItemId), eq(orderLineItems.orderId, input.orderId)))
    .limit(1);
  if (!lineItem) throw new ArtworkSetOperationError("Order line item not found.", 404, "LINE_ITEM_NOT_FOUND");

  const [canonicalById, compatibilityRows] = await Promise.all([
    tx.select({
      id: lineItemArtwork.id,
      fileRecordId: lineItemArtwork.fileRecordId,
    }).from(lineItemArtwork).where(and(
      eq(lineItemArtwork.organizationId, input.organizationId),
      eq(lineItemArtwork.orderId, input.orderId),
      eq(lineItemArtwork.lineItemId, input.lineItemId),
      eq(lineItemArtwork.status, "current"),
      inArray(lineItemArtwork.id, requestedIds),
    )),
    tx.select({
      id: orderAttachments.id,
      fileRecordId: orderAttachments.fileRecordId,
      role: orderAttachments.role,
        }).from(orderAttachments).where(and(
          eq(orderAttachments.orderId, input.orderId),
          eq(orderAttachments.orderLineItemId, input.lineItemId),
          inArray(orderAttachments.id, requestedIds),
    )),
  ]);

  if (compatibilityRows.some((row: any) => !["artwork", "output"].includes(String(row.role)))) {
    throw new ArtworkSetOperationError("Only production artwork can belong to an Artwork Set.", 409, "ARTWORK_SET_REFERENCE_MEMBER");
  }

  const compatibilityFileRecordIds = compatibilityRows
    .map((row: any) => row.fileRecordId)
    .filter((id: string | null): id is string => Boolean(id));
  const canonicalByFileRecord = compatibilityFileRecordIds.length > 0
    ? await tx.select({ id: lineItemArtwork.id, fileRecordId: lineItemArtwork.fileRecordId })
      .from(lineItemArtwork)
      .where(and(
        eq(lineItemArtwork.organizationId, input.organizationId),
        eq(lineItemArtwork.orderId, input.orderId),
        eq(lineItemArtwork.lineItemId, input.lineItemId),
        eq(lineItemArtwork.status, "current"),
        inArray(lineItemArtwork.fileRecordId, compatibilityFileRecordIds),
      ))
    : [];
  const canonicalMembers = Array.from(new Map([...canonicalById, ...canonicalByFileRecord].map((row: any) => [row.id, row])).values());

  const resolvedHandles = new Set([
    ...canonicalById.map((row: any) => row.id),
    ...compatibilityRows.map((row: any) => row.id),
  ]);
  if (resolvedHandles.size !== requestedIds.length || canonicalMembers.length !== requestedIds.length) {
    throw new ArtworkSetOperationError("One or more selected artwork files are no longer available for this order line.", 404, "ARTWORK_SET_MEMBER_NOT_FOUND");
  }
  return { lineItem, compatibilityRows, canonicalMembers };
}

async function applyArtworkSetInTransaction(tx: any, input: ApplyArtworkSetInput) {
  const productionQuantity = validatedQuantity(input.productionQuantity);
  const groupId = input.productionGroupId?.trim() || newArtworkSetId();
  const { lineItem, compatibilityRows, canonicalMembers } = await resolveArtworkSetMembers(tx, input);
  const canonicalIds = canonicalMembers.map((member: any) => member.id);
  const fileRecordIds = canonicalMembers.map((member: any) => member.fileRecordId);
  const compatibilityIds = compatibilityRows.map((member: any) => member.id);

  await tx.update(lineItemArtwork).set({
    allocationQuantity: productionQuantity,
    allocationGroupId: groupId,
  }).where(and(eq(lineItemArtwork.organizationId, input.organizationId), inArray(lineItemArtwork.id, canonicalIds)));

  if (fileRecordIds.length > 0) {
    await tx.update(orderAttachments).set({
      productionQuantity,
      productionGroupId: groupId,
      updatedAt: new Date(),
    }).where(and(
      eq(orderAttachments.orderId, input.orderId),
      eq(orderAttachments.orderLineItemId, input.lineItemId),
      inArray(orderAttachments.fileRecordId, fileRecordIds),
    ));
  }
  if (compatibilityIds.length > 0) {
    await tx.update(lineItemFiles).set({
      productionQuantity,
      productionGroupId: groupId,
    }).where(and(
      eq(lineItemFiles.organizationId, input.organizationId),
      eq(lineItemFiles.orderId, input.orderId),
      eq(lineItemFiles.lineItemId, input.lineItemId),
      eq(lineItemFiles.role, "final"),
      eq(lineItemFiles.status, "active"),
      inArray(lineItemFiles.sourceOrderAttachmentId, compatibilityIds),
    ));
  }

  const finalMembers = await tx.select({
    id: lineItemFiles.id,
    role: lineItemFiles.role,
    side: lineItemFiles.sourceArtworkSide,
    productionQuantity: lineItemFiles.productionQuantity,
    productionGroupId: lineItemFiles.productionGroupId,
  }).from(lineItemFiles).where(and(
    eq(lineItemFiles.organizationId, input.organizationId),
    eq(lineItemFiles.lineItemId, input.lineItemId),
    eq(lineItemFiles.role, "final"),
    eq(lineItemFiles.status, "active"),
  ));
  const sourceMembers = await tx.select({
    id: lineItemArtwork.id,
    role: lineItemArtwork.role,
    side: lineItemArtwork.side,
    productionQuantity: lineItemArtwork.allocationQuantity,
    productionGroupId: lineItemArtwork.allocationGroupId,
  }).from(lineItemArtwork).where(and(
    eq(lineItemArtwork.organizationId, input.organizationId),
    eq(lineItemArtwork.lineItemId, input.lineItemId),
    eq(lineItemArtwork.status, "current"),
  ));
  const members = finalMembers.length > 0 ? finalMembers : sourceMembers;
  const allocation = buildArtworkAllocationStatus({ lineQuantity: lineItem.quantity, members });

  await tx.insert(orderAuditLog).values({
    orderId: input.orderId,
    orderLineItemId: input.lineItemId,
    userId: input.userId ?? null,
    userName: input.userName ?? "Artwork Set update",
    actionType: "artwork_set_updated",
    fromStatus: null,
    toStatus: null,
    note: `Artwork Set updated: ${productionQuantity} finished piece${productionQuantity === 1 ? "" : "s"} across ${canonicalIds.length} required file${canonicalIds.length === 1 ? "" : "s"}.`,
    metadata: { productionGroupId: groupId, productionQuantity, artworkIds: canonicalIds },
  } as any);

  return { productionGroupId: groupId, productionQuantity, allocation, artworkIds: canonicalIds };
}

export async function createArtworkSet(input: ApplyArtworkSetInput) {
  if (input.artworkIds.length < 2) {
    throw new ArtworkSetOperationError("Select two or more files to group as the same finished output.");
  }
  return db.transaction((tx) => applyArtworkSetInTransaction(tx, input));
}

export async function updateArtworkSetQuantity(input: Omit<ApplyArtworkSetInput, "artworkIds" | "productionGroupId"> & { productionGroupId: string }) {
  const groupId = input.productionGroupId.trim();
  if (!groupId) throw new ArtworkSetOperationError("Artwork Set not found.", 404, "ARTWORK_SET_NOT_FOUND");
  return db.transaction(async (tx) => {
    const members = await tx.select({ id: lineItemArtwork.id }).from(lineItemArtwork).where(and(
      eq(lineItemArtwork.organizationId, input.organizationId),
      eq(lineItemArtwork.orderId, input.orderId),
      eq(lineItemArtwork.lineItemId, input.lineItemId),
      eq(lineItemArtwork.status, "current"),
      eq(lineItemArtwork.allocationGroupId, groupId),
    ));
    if (members.length === 0) throw new ArtworkSetOperationError("Artwork Set not found.", 404, "ARTWORK_SET_NOT_FOUND");
    return applyArtworkSetInTransaction(tx, { ...input, artworkIds: members.map((member: any) => member.id), productionGroupId: groupId });
  });
}
