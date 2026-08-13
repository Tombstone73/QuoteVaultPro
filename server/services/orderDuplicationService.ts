import { and, eq, inArray } from "drizzle-orm";

import {
  auditLogs,
  lineItemArtwork,
  orderAttachments,
  orderAuditLog,
  orderLineItems,
  orders,
} from "@shared/schema";
import { db } from "../db";
import { OrdersRepository, type CreateOrderLineItemInput } from "../storage/orders.repo";

export class OrderDuplicationError extends Error {
  constructor(readonly code: "ORDER_NOT_FOUND" | "ORDER_HAS_NO_LINE_ITEMS", message: string) {
    super(message);
  }
}

/**
 * Create a new commercial order from a historical or active order.
 *
 * This intentionally does not copy any execution history: invoices/payments,
 * production, fulfillment, proofs, reservations, cancellation data, or audit
 * records remain attached only to the source.  Customer-source artwork is
 * reused by creating new relationships to the same immutable file record.
 */
export async function duplicateOrder(input: {
  organizationId: string;
  sourceOrderId: string;
  actorUserId: string;
  actorName?: string | null;
}) {
  return db.transaction(async (tx) => {
    const [sourceOrder] = await tx
      .select()
      .from(orders)
      .where(and(eq(orders.id, input.sourceOrderId), eq(orders.organizationId, input.organizationId)))
      .limit(1);
    if (!sourceOrder) throw new OrderDuplicationError("ORDER_NOT_FOUND", "Order not found.");

    const sourceLines = await tx
      .select()
      .from(orderLineItems)
      .where(eq(orderLineItems.orderId, sourceOrder.id))
      .orderBy(orderLineItems.sortOrder, orderLineItems.createdAt);
    if (sourceLines.length === 0) {
      throw new OrderDuplicationError("ORDER_HAS_NO_LINE_ITEMS", "Orders without line items cannot be duplicated.");
    }

    const lineItems: CreateOrderLineItemInput[] = sourceLines.map((line, index) => ({
      productId: line.productId,
      productVariantId: line.productVariantId,
      productType: line.productType,
      description: line.description,
      width: line.width,
      height: line.height,
      quantity: line.quantity,
      sqft: line.sqft,
      unitPrice: line.unitPrice,
      totalPrice: line.totalPrice,
      specsJson: line.specsJson,
      selectedOptions: line.selectedOptions,
      optionSelectionsJson: line.optionSelectionsJson,
      nestingConfigSnapshot: line.nestingConfigSnapshot,
      materialId: line.materialId,
      materialUsageJson: line.materialUsageJson,
      materialUsages: line.materialUsages,
      requiresInventory: line.requiresInventory,
      requiresDesignSnapshot: line.requiresDesignSnapshot,
      designBriefRequiredSnapshot: line.designBriefRequiredSnapshot,
      estimatedDesignMinutesSnapshot: line.estimatedDesignMinutesSnapshot,
      includedDesignMinutesSnapshot: line.includedDesignMinutesSnapshot,
      designPricingModeSnapshot: line.designPricingModeSnapshot,
      flatFeeAmountSnapshot: line.flatFeeAmountSnapshot,
      hourlyRateSnapshot: line.hourlyRateSnapshot,
      overageRateSnapshot: line.overageRateSnapshot,
      internalLaborRateSnapshot: line.internalLaborRateSnapshot,
      needsDesignOverride: line.needsDesignOverride,
      requiresDesign: line.requiresDesign,
      requiresProofApproval: line.requiresProofApproval,
      requiresPrepress: line.requiresPrepress,
      productionNotes: line.productionNotes,
      pbv2TreeVersionId: line.pbv2TreeVersionId,
      pbv2SnapshotJson: line.pbv2SnapshotJson,
      pricedAt: line.pricedAt,
      sortOrder: line.sortOrder ?? index,
      overridePriceCents: line.overridePriceCents,
      overrideReason: line.overrideReason,
      lineItemRole: line.lineItemRole,
      childDisplayMode: line.childDisplayMode,
      parentPriceMode: line.parentPriceMode,
      childCalculatedTotalCents: line.childCalculatedTotalCents,
      taxAmount: line.taxAmount,
      isTaxableSnapshot: line.isTaxableSnapshot,
    } as CreateOrderLineItemInput));

    // Use the same repository create path as normal orders: new document
    // number, new line IDs, standard draft invoice, and normal job intake.
    const repository = new OrdersRepository(tx, true);
    const duplicated = await repository.createOrder(input.organizationId, {
      customerId: sourceOrder.customerId,
      contactId: sourceOrder.contactId,
      label: sourceOrder.label,
      // A PO and dates are transaction-specific commitments, never history.
      poNumber: null,
      dueDate: null,
      promisedDate: null,
      requestedDueDate: null,
      status: "new",
      priority: sourceOrder.priority,
      discount: Number(sourceOrder.discount ?? 0),
      notesInternal: null,
      createdByUserId: input.actorUserId,
      lineItems,
      taxRate: sourceOrder.taxRate == null ? undefined : Number(sourceOrder.taxRate),
      taxAmount: Number(sourceOrder.taxAmount ?? sourceOrder.tax ?? 0),
      taxableSubtotal: sourceOrder.taxableSubtotal == null ? undefined : Number(sourceOrder.taxableSubtotal),
      billToName: sourceOrder.billToName,
      billToCompany: sourceOrder.billToCompany,
      billToAddress1: sourceOrder.billToAddress1,
      billToAddress2: sourceOrder.billToAddress2,
      billToCity: sourceOrder.billToCity,
      billToState: sourceOrder.billToState,
      billToPostalCode: sourceOrder.billToPostalCode,
      billToCountry: sourceOrder.billToCountry,
      billToPhone: sourceOrder.billToPhone,
      billToEmail: sourceOrder.billToEmail,
      shippingMethod: sourceOrder.shippingMethod,
      shippingMode: sourceOrder.shippingMode,
      shipToName: sourceOrder.shipToName,
      shipToCompany: sourceOrder.shipToCompany,
      shipToAddress1: sourceOrder.shipToAddress1,
      shipToAddress2: sourceOrder.shipToAddress2,
      shipToCity: sourceOrder.shipToCity,
      shipToState: sourceOrder.shipToState,
      shipToPostalCode: sourceOrder.shipToPostalCode,
      shipToCountry: sourceOrder.shipToCountry,
      shipToPhone: sourceOrder.shipToPhone,
      shipToEmail: sourceOrder.shipToEmail,
      carrier: sourceOrder.carrier,
      carrierAccountNumber: sourceOrder.carrierAccountNumber,
      shippingInstructions: sourceOrder.shippingInstructions,
      shippingCents: sourceOrder.shippingCents,
      invoiceAuditSource: "order_created",
    });

    const newLineBySourceId = new Map(sourceLines.map((sourceLine, index) => [sourceLine.id, duplicated.lineItems[index]?.id]));
    for (const sourceLine of sourceLines) {
      if (!sourceLine.parentLineItemId) continue;
      const newLineId = newLineBySourceId.get(sourceLine.id);
      const newParentLineItemId = newLineBySourceId.get(sourceLine.parentLineItemId);
      if (newLineId && newParentLineItemId) {
        await tx.update(orderLineItems).set({ parentLineItemId: newParentLineItemId }).where(eq(orderLineItems.id, newLineId));
      }
    }

    const sourceLineIds = sourceLines.map((line) => line.id);
    const reusableArtwork = sourceLineIds.length
      ? await tx.select().from(lineItemArtwork).where(and(
        eq(lineItemArtwork.organizationId, input.organizationId),
        eq(lineItemArtwork.orderId, sourceOrder.id),
        eq(lineItemArtwork.role, "customer_source"),
        eq(lineItemArtwork.status, "current"),
        inArray(lineItemArtwork.lineItemId, sourceLineIds),
      ))
      : [];
    const sourceAttachments = reusableArtwork.length
      ? await tx.select().from(orderAttachments).where(and(
        eq(orderAttachments.orderId, sourceOrder.id),
        eq(orderAttachments.role, "artwork"),
        inArray(orderAttachments.fileRecordId, reusableArtwork.map((artwork) => artwork.fileRecordId)),
      ))
      : [];

    for (const artwork of reusableArtwork) {
      const newLineItemId = newLineBySourceId.get(artwork.lineItemId);
      if (!newLineItemId) continue;
      await tx.insert(lineItemArtwork).values({
        organizationId: input.organizationId,
        orderId: duplicated.id,
        lineItemId: newLineItemId,
        fileRecordId: artwork.fileRecordId,
        role: "customer_source",
        status: "current",
        side: artwork.side,
        allocationQuantity: null,
        allocationGroupId: null,
        // Preserve the truthful original intake provenance.  The audit below
        // records that this relationship was reused for the duplicate.
        origin: artwork.origin,
        createdByUserId: input.actorUserId,
      });

      const attachment = sourceAttachments.find((candidate) => candidate.orderLineItemId === artwork.lineItemId && candidate.fileRecordId === artwork.fileRecordId);
      if (attachment) {
        await tx.insert(orderAttachments).values({
          orderId: duplicated.id,
          orderLineItemId: newLineItemId,
          fileRecordId: attachment.fileRecordId,
          uploadedByUserId: attachment.uploadedByUserId,
          uploadedByName: attachment.uploadedByName,
          fileName: attachment.fileName,
          fileUrl: attachment.fileUrl,
          fileSize: attachment.fileSize,
          mimeType: attachment.mimeType,
          description: attachment.description,
          originalFilename: attachment.originalFilename,
          storedFilename: attachment.storedFilename,
          relativePath: attachment.relativePath,
          storageProvider: attachment.storageProvider,
          extension: attachment.extension,
          sizeBytes: attachment.sizeBytes,
          checksum: attachment.checksum,
          thumbnailRelativePath: attachment.thumbnailRelativePath,
          thumbnailGeneratedAt: attachment.thumbnailGeneratedAt,
          thumbStatus: attachment.thumbStatus,
          thumbKey: attachment.thumbKey,
          previewKey: attachment.previewKey,
          thumbnailUrl: attachment.thumbnailUrl,
          role: "artwork",
          side: attachment.side,
          isPrimary: attachment.isPrimary,
          // Allocation, portal and customer-upload workflow state belong to
          // the source order and must not be copied into a fresh order.
          customerVisible: false,
        });
      }
    }

    const sourceNumber = sourceOrder.displayNumber || sourceOrder.orderNumber;
    const duplicateNumber = duplicated.displayNumber || duplicated.orderNumber;
    const auditMetadata = { sourceOrderId: sourceOrder.id, sourceOrderNumber: sourceNumber, reusedArtworkCount: reusableArtwork.length };
    await tx.insert(auditLogs).values({
      organizationId: input.organizationId,
      userId: input.actorUserId,
      userName: input.actorName ?? null,
      actionType: "CREATE",
      entityType: "order",
      entityId: duplicated.id,
      entityName: duplicateNumber,
      description: `Duplicated order ${sourceNumber} as ${duplicateNumber}.`,
      newValues: auditMetadata,
    } as any);
    await tx.insert(orderAuditLog).values({
      orderId: duplicated.id,
      userId: input.actorUserId,
      userName: input.actorName ?? null,
      actionType: "order_duplicated",
      fromStatus: null,
      toStatus: "new",
      note: `Duplicated from order ${sourceNumber}. Historical invoices, payments, production, fulfillment, proofs, and audit records were not copied.`,
      metadata: auditMetadata,
    } as any);

    return duplicated;
  });
}
