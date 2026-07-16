export const ORDER_ARTWORK_SIDES = ["front", "back", "both"] as const;
export type OrderArtworkSide = typeof ORDER_ARTWORK_SIDES[number];

export type OrderAttachmentMetadataPatch = {
  role: "artwork";
  side: OrderArtworkSide;
};

export class OrderLineItemArtworkAssignmentError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly code: string,
  ) {
    super(message);
    this.name = "OrderLineItemArtworkAssignmentError";
  }
}

export function isOrderArtworkSide(value: unknown): value is OrderArtworkSide {
  return typeof value === "string" && ORDER_ARTWORK_SIDES.includes(value as OrderArtworkSide);
}

export function getConflictingArtworkSides(side: OrderArtworkSide): OrderArtworkSide[] {
  if (side === "both") return ["front", "back", "both"];
  return [side, "both"];
}

export type OrderLineItemArtworkAssignmentStore<TAttachment extends { id: string }> = {
  findOrder: (organizationId: string, orderId: string) => Promise<{ id: string } | null>;
  findLineItem: (orderId: string, lineItemId: string) => Promise<{ id: string } | null>;
  findAttachment: (orderId: string, lineItemId: string, fileId: string) => Promise<TAttachment | null>;
  clearConflictingSides: (args: {
    orderId: string;
    lineItemId: string;
    exceptFileId: string;
    sides: OrderArtworkSide[];
  }) => Promise<void>;
  updateAttachmentMetadata: (fileId: string, patch: OrderAttachmentMetadataPatch) => Promise<TAttachment | null>;
};

/**
 * Assigns one order-attachment row to a production side. The store is expected
 * to execute these operations in one transaction so a failed update cannot
 * leave partially-cleared Front/Back assignments.
 */
export async function assignOrderLineItemArtworkSide<TAttachment extends { id: string }>(args: {
  organizationId: string;
  orderId: string;
  lineItemId: string;
  fileId: string;
  side: OrderArtworkSide;
  store: OrderLineItemArtworkAssignmentStore<TAttachment>;
}): Promise<TAttachment> {
  const order = await args.store.findOrder(args.organizationId, args.orderId);
  if (!order) {
    throw new OrderLineItemArtworkAssignmentError("Order not found", 404, "ORDER_NOT_FOUND");
  }

  const lineItem = await args.store.findLineItem(args.orderId, args.lineItemId);
  if (!lineItem) {
    throw new OrderLineItemArtworkAssignmentError("Line item not found", 404, "LINE_ITEM_NOT_FOUND");
  }

  const attachment = await args.store.findAttachment(args.orderId, args.lineItemId, args.fileId);
  if (!attachment) {
    throw new OrderLineItemArtworkAssignmentError(
      "Artwork file is not attached to this line item",
      404,
      "LINE_ITEM_ARTWORK_NOT_FOUND",
    );
  }

  await args.store.clearConflictingSides({
    orderId: args.orderId,
    lineItemId: args.lineItemId,
    exceptFileId: attachment.id,
    sides: getConflictingArtworkSides(args.side),
  });

  const updated = await args.store.updateAttachmentMetadata(attachment.id, {
    role: "artwork",
    side: args.side,
  });
  if (!updated) {
    throw new OrderLineItemArtworkAssignmentError(
      "Artwork file could not be updated",
      404,
      "LINE_ITEM_ARTWORK_NOT_FOUND",
    );
  }
  return updated;
}
