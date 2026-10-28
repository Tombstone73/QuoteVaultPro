import { createHash } from "node:crypto";
import { createRedoOrderSchema, type CreateRedoOrderRequest } from "@shared/orderRedo";
import { getInitialWorkflowState, transitionLineItemWorkflowState } from "./lineItemWorkflowService";
import { synchronizeOrderBackedInvoiceFromOrderInTransaction } from "../invoicesService";
import { and, eq, inArray, sql } from "drizzle-orm";

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
  constructor(readonly code: "ORDER_NOT_FOUND" | "ORDER_HAS_NO_LINE_ITEMS" | "INVALID_REDO" | "STALE_SOURCE" | "REDO_KEY_CONFLICT", message: string) {
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
  redo?: CreateRedoOrderRequest;
}) {
  const redo = input.redo ? createRedoOrderSchema.parse(input.redo) : undefined;
  const fingerprint = redo ? createHash("sha256").update(JSON.stringify({ sourceOrderId: input.sourceOrderId, actorUserId: input.actorUserId, ...redo, lines: [...redo.lines].sort((a,b) => a.sourceLineItemId.localeCompare(b.sourceLineItemId)) })).digest("hex") : null;
  return db.transaction(async (tx) => {
    const repository = new OrdersRepository(tx, true);
    if (redo) {
      // Database-scoped lock plus durable key survives retries, workers and restarts.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${input.organizationId + ":redo:" + redo.requestKey}, 0))`);
      const [previous] = await tx.select().from(orders).where(and(eq(orders.organizationId, input.organizationId), eq(orders.redoRequestKey, redo.requestKey))).limit(1);
      if (previous) {
        if (previous.redoRequestFingerprint !== fingerprint) throw new OrderDuplicationError("REDO_KEY_CONFLICT", "This request was already used with different replacement details.");
        return repository.getOrderById(input.organizationId, previous.id);
      }
    }
    const [sourceOrder] = await tx
      .select()
      .from(orders)
      .where(and(eq(orders.id, input.sourceOrderId), eq(orders.organizationId, input.organizationId)))
      .limit(1).for("update");
    if (!sourceOrder) throw new OrderDuplicationError("ORDER_NOT_FOUND", "Order not found.");

    const allSourceLines = await tx
      .select()
      .from(orderLineItems)
      .where(eq(orderLineItems.orderId, sourceOrder.id))
      .orderBy(orderLineItems.sortOrder, orderLineItems.createdAt).for("update");
    let sourceLines = allSourceLines;
    if (redo) {
      if (new Date(sourceOrder.updatedAt).getTime() !== new Date(redo.expectedUpdatedAt).getTime()) throw new OrderDuplicationError("STALE_SOURCE", "The source order changed. Refresh before creating a replacement.");
      const requested = new Map(redo.lines.map(line => [line.sourceLineItemId, line]));
      if (requested.size !== redo.lines.length) throw new OrderDuplicationError("INVALID_REDO", "Each source line may be selected only once.");
      sourceLines = allSourceLines.filter(line => requested.has(line.id));
      if (sourceLines.length !== requested.size) throw new OrderDuplicationError("INVALID_REDO", "Selected lines must belong to this source order.");
      for (const line of sourceLines) {
        const selection = requested.get(line.id)!;
        if (line.updatedAt.getTime() !== new Date(selection.expectedUpdatedAt).getTime()) throw new OrderDuplicationError("STALE_SOURCE", "A selected source line changed. Refresh before creating a replacement.");
        if (selection.quantity > line.quantity) throw new OrderDuplicationError("INVALID_REDO", "Replacement quantities cannot exceed the selected source quantity.");
        const children = allSourceLines.filter(child => child.parentLineItemId === line.id);
        if (children.length && line.lineItemRole !== "parent") throw new OrderDuplicationError("INVALID_REDO", "Source product group has an invalid parent role.");
        const ancestors = new Set([line.id]);
        let ancestorId = line.parentLineItemId;
        while (ancestorId) {
          if (ancestors.has(ancestorId)) throw new OrderDuplicationError("INVALID_REDO", "Source product group contains a cycle. Repair it before creating a replacement.");
          ancestors.add(ancestorId);
          ancestorId = allSourceLines.find(parent => parent.id === ancestorId)?.parentLineItemId ?? null;
        }
        if (children.some(child => !requested.has(child.id))) throw new OrderDuplicationError("INVALID_REDO", "Select the complete product group with proportionate quantities.");
        if (line.lineItemRole === "child" && !line.parentLineItemId) throw new OrderDuplicationError("INVALID_REDO", "Source product has an orphan child. Repair the source configuration first.");
        if (line.parentLineItemId) {
          const parent = allSourceLines.find(parent => parent.id === line.parentLineItemId);
          const parentSelection = requested.get(line.parentLineItemId);
          if (!parent || !parentSelection || parent.lineItemRole !== "parent" || parentSelection.quantity * line.quantity !== selection.quantity * parent.quantity) throw new OrderDuplicationError("INVALID_REDO", "Select the parent and every component with proportionate whole-piece quantities.");
        }
      }
    }
    if (sourceLines.length === 0) {
      throw new OrderDuplicationError("ORDER_HAS_NO_LINE_ITEMS", "Orders without line items cannot be duplicated.");
    }

    const lineItems: CreateOrderLineItemInput[] = sourceLines.map((line, index) => {
      const quantity = redo ? redo.lines.find(item => item.sourceLineItemId === line.id)!.quantity : line.quantity;
      const partial = !!redo && quantity !== line.quantity;
      const capacity = Number(line.nestingConfigSnapshot?.itemsPerSheet);
      const hasSheetPlan = Number(line.nestingConfigSnapshot?.totalSheets) > 0;
      const needsFreshSheetPlan = partial && hasSheetPlan && !(Number.isFinite(capacity) && capacity > 0);
      const nestingConfigSnapshot = partial && line.nestingConfigSnapshot
        ? { ...line.nestingConfigSnapshot, totalSheets: Number.isFinite(capacity) && capacity > 0 ? Math.ceil(quantity / capacity) : undefined }
        : line.nestingConfigSnapshot;
      return ({
      productId: line.productId,
      productVariantId: line.productVariantId,
      productType: line.productType,
      description: line.description,
      width: line.width,
      height: line.height,
      quantity,
      redoSourceLineItemId: redo ? line.id : null,
      ...(redo ? { workflowState: "new" as const } : {}),
      sqft: line.sqft,
      unitPrice: line.unitPrice,
      totalPrice: line.totalPrice,
      specsJson: redo ? { ...(line.specsJson as Record<string, unknown> ?? {}), priceOverride: { mode: "override_total_after_margin", valueCents: 0 } } : line.specsJson,
      selectedOptions: line.selectedOptions,
      optionSelectionsJson: line.optionSelectionsJson,
      // Reuse saved layout capacity, never the historical run's sheet count.
      nestingConfigSnapshot,
      materialId: line.materialId,
      materialUsageJson: redo ? null : line.materialUsageJson,
      materialUsages: redo ? [] : line.materialUsages,
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
      requiresPrepress: line.requiresPrepress || needsFreshSheetPlan,
      productionNotes: needsFreshSheetPlan ? [line.productionNotes, "Action needed: review a fresh sheet layout for the replacement quantity in Prepress."].filter(Boolean).join("\n") : line.productionNotes,
      pbv2TreeVersionId: line.pbv2TreeVersionId,
      pbv2SnapshotJson: line.pbv2SnapshotJson,
      pricedAt: line.pricedAt,
      sortOrder: line.sortOrder ?? index,
      overridePriceCents: redo ? 0 : line.overridePriceCents,
      overrideReason: redo ? `No customer charge replacement: ${redo.reason}` : line.overrideReason,
      lineItemRole: line.lineItemRole,
      childDisplayMode: line.childDisplayMode,
      parentPriceMode: line.parentPriceMode,
      childCalculatedTotalCents: redo ? 0 : line.childCalculatedTotalCents,
      taxAmount: redo ? "0" : line.taxAmount,
      isTaxableSnapshot: line.isTaxableSnapshot,
      });
    });

    // Use the same repository create path as normal orders: new document
    // number, new line IDs, standard draft invoice, and normal job intake.
    const duplicated = await repository.createOrder(input.organizationId, {
      redo: redo ? { redoRootOrderId: sourceOrder.redoRootOrderId ?? sourceOrder.id, redoSourceOrderId: sourceOrder.id, redoReason: redo.reason, redoExplanation: redo.explanation, redoDisposition: redo.disposition, redoRequestKey: redo.requestKey, redoRequestFingerprint: fingerprint } : undefined,
      customerId: sourceOrder.customerId,
      contactId: sourceOrder.contactId,
      label: sourceOrder.label,
      // A Redo promise also sets the canonical due date used by overdue queues.
      // Ordinary duplicates clear transaction-specific PO and date commitments.
      poNumber: null,
      dueDate: redo?.promisedDate ?? null,
      promisedDate: redo?.promisedDate ?? null,
      requestedDueDate: null,
      status: "new",
      priority: sourceOrder.priority,
      discount: redo ? 0 : Number(sourceOrder.discount ?? 0),
      notesInternal: null,
      createdByUserId: input.actorUserId,
      lineItems,
      taxRate: sourceOrder.taxRate == null ? undefined : Number(sourceOrder.taxRate),
      taxAmount: redo ? 0 : Number(sourceOrder.taxAmount ?? sourceOrder.tax ?? 0),
      taxableSubtotal: redo ? 0 : sourceOrder.taxableSubtotal == null ? undefined : Number(sourceOrder.taxableSubtotal),
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
      shippingCents: redo ? 0 : sourceOrder.shippingCents,
      shippingChargeDecision: redo ? 'free' : sourceOrder.shippingChargeDecision === 'ups_rate' ? 'manual'
        : sourceOrder.shippingChargeDecision as 'unset' | 'manual' | 'free' | 'legacy',
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

    const routingBlockers: Array<{ lineItemId: string; message: string }> = [];
    if (redo) {
      // Parent/child remapping changes invoice snapshots; synchronize through the canonical boundary.
      await synchronizeOrderBackedInvoiceFromOrderInTransaction(tx, { organizationId: input.organizationId, orderId: duplicated.id, actorUserId: input.actorUserId });
      for (const line of duplicated.lineItems) {
        if (line.lineItemRole === "parent") continue;
        // Same ownership transition used by Quote conversion; proof/design gates stay authoritative.
        try {
          // A savepoint keeps a legitimate intake blocker from losing the promised order.
          await tx.transaction(routingTx => transitionLineItemWorkflowState(routingTx, {
            organizationId: input.organizationId, lineItemId: line.id,
            toState: getInitialWorkflowState({ requiresDesign: line.requiresDesign, requiresPrepress: line.requiresPrepress, requiresProofApproval: line.requiresProofApproval }),
            actorUserId: input.actorUserId, metadata: { source: "redo_order_creation", sourceOrderId: sourceOrder.id },
          }));
        } catch (error: any) {
          const missingStation = error.statusCode === 409 && error.lineItemId === line.id && (error.stationKey || error.targetStationKey);
          if (!missingStation && !["PRODUCTION_CREDIT_HOLD", "PROOF_APPROVAL_REQUIRED"].includes(error.code)) throw error;
          const message = missingStation ? "Configure production station " + (error.stationKey || error.targetStationKey) + ". Then use Save & Route Jobs." : error.message + " Resolve the hold, then use Save & Route Jobs.";
          routingBlockers.push({ lineItemId: line.id, message });
          await tx.update(orderLineItems).set({ productionNotes: [line.productionNotes, "Action needed: " + message].filter(Boolean).join("\n") }).where(eq(orderLineItems.id, line.id));
        }
      }
    }
    const sourceNumber = sourceOrder.displayNumber || sourceOrder.orderNumber;
    const duplicateNumber = duplicated.displayNumber || duplicated.orderNumber;
    const auditMetadata = { sourceOrderId: sourceOrder.id, sourceOrderNumber: sourceNumber, reusedArtworkCount: reusableArtwork.length, ...(redo ? { rootOrderId: sourceOrder.redoRootOrderId ?? sourceOrder.id, routingBlockers, redoOrderId: duplicated.id, redoOrderNumber: duplicateNumber, lines: redo.lines.map(line => ({ sourceLineItemId: line.sourceLineItemId, redoLineItemId: newLineBySourceId.get(line.sourceLineItemId), quantity: line.quantity })), reason: redo.reason, explanation: redo.explanation, promisedDate: redo.promisedDate, disposition: redo.disposition, actorUserId: input.actorUserId } : {}) };
    await tx.insert(auditLogs).values({
      organizationId: input.organizationId,
      userId: input.actorUserId,
      userName: input.actorName ?? null,
      actionType: "CREATE",
      entityType: "order",
      entityId: duplicated.id,
      entityName: duplicateNumber,
      description: `${redo ? "Created replacement for" : "Duplicated order"} ${sourceNumber} as ${duplicateNumber}.`,
      newValues: auditMetadata,
    });
    await tx.insert(orderAuditLog).values({
      orderId: duplicated.id,
      userId: input.actorUserId,
      userName: input.actorName ?? null,
      actionType: redo ? "redo_order_created" : "order_duplicated",
      fromStatus: null,
      toStatus: "new",
      note: `Duplicated from order ${sourceNumber}. Historical invoices, payments, production, fulfillment, proofs, and audit records were not copied.`,
      metadata: auditMetadata,
    });

    return redo ? repository.getOrderById(input.organizationId, duplicated.id) : duplicated;
  });
}
