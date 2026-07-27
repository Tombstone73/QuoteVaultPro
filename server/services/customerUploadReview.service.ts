import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";

import { db } from "../db";
import { applyArtworkSideAssignmentToSpecs } from "@shared/artworkSideAssignment";
import { auditLogs, lineItemFiles, orderAttachments, orderLineItems, orders, quoteAttachments, quotes } from "@shared/schema";
import { getConflictingArtworkSides, type OrderArtworkSide } from "./orderLineItemArtworkAssignmentService";

export const customerUploadReviewStatuses = ["pending_review", "accepted", "rejected"] as const;
export type CustomerUploadReviewStatus = typeof customerUploadReviewStatuses[number];
export type CustomerUploadPromotion = "reference" | "artwork";
export type CustomerUploadAssignmentType = "reference_for_line_item";
export type CustomerUploadArtworkSelectionType = "artwork_side_intake";
export type CustomerUploadArtworkSideDesignation = OrderArtworkSide;
export type CustomerUploadPrimaryArtworkCandidateSide = OrderArtworkSide;

export class CustomerUploadReviewError extends Error {
  constructor(public readonly statusCode: number, message: string) {
    super(message);
  }
}

export type ReviewCustomerUploadInput = {
  organizationId: string;
  entityType: "quote" | "order";
  entityId: string;
  attachmentId: string;
  status: Exclude<CustomerUploadReviewStatus, "pending_review">;
  reviewNote?: string | null;
  actorUserId: string;
  actorUserName: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
};

function normalizeNote(value: string | null | undefined): string | null {
  const note = value?.trim();
  return note ? note : null;
}

/**
 * Reviews a portal customer upload without changing attachment usage or
 * quote/order workflow state. Promotion is deliberately a separate action.
 */
export async function reviewCustomerUpload(input: ReviewCustomerUploadInput) {
  return db.transaction(async (tx) => {
    const entity = input.entityType === "quote"
      ? await tx
        .select({ id: quotes.id })
        .from(quotes)
        .where(and(eq(quotes.id, input.entityId), eq(quotes.organizationId, input.organizationId)))
        .limit(1)
      : await tx
        .select({ id: orders.id })
        .from(orders)
        .where(and(eq(orders.id, input.entityId), eq(orders.organizationId, input.organizationId)))
        .limit(1);

    if (!entity[0]) {
      throw new CustomerUploadReviewError(404, "Customer upload not found.");
    }

    const attachment = input.entityType === "quote"
      ? await tx
        .select()
        .from(quoteAttachments)
        .where(and(
          eq(quoteAttachments.id, input.attachmentId),
          eq(quoteAttachments.quoteId, input.entityId),
          eq(quoteAttachments.organizationId, input.organizationId),
          isNull(quoteAttachments.quoteLineItemId),
        ))
        .limit(1)
      : await tx
        .select()
        .from(orderAttachments)
        .where(and(
          eq(orderAttachments.id, input.attachmentId),
          eq(orderAttachments.orderId, input.entityId),
          isNull(orderAttachments.orderLineItemId),
        ))
        .limit(1);

    const existing = attachment[0];
    if (!existing || existing.portalFileCategory !== "customer_upload") {
      throw new CustomerUploadReviewError(404, "Customer upload not found.");
    }
    if (existing.customerUploadReviewStatus !== "pending_review") {
      throw new CustomerUploadReviewError(409, "This customer upload has already been reviewed.");
    }

    const reviewedAt = new Date();
    const reviewNote = normalizeNote(input.reviewNote);
    const commonPatch = {
      customerUploadReviewStatus: input.status,
      customerUploadReviewedByUserId: input.actorUserId,
      customerUploadReviewedAt: reviewedAt,
      customerUploadReviewNote: reviewNote,
      updatedAt: reviewedAt,
    };

    const [updated] = input.entityType === "quote"
      ? await tx
        .update(quoteAttachments)
        .set(commonPatch)
        .where(and(
          eq(quoteAttachments.id, input.attachmentId),
          eq(quoteAttachments.quoteId, input.entityId),
          eq(quoteAttachments.organizationId, input.organizationId),
        ))
        .returning()
      : await tx
        .update(orderAttachments)
        .set(commonPatch)
        .where(and(eq(orderAttachments.id, input.attachmentId), eq(orderAttachments.orderId, input.entityId)))
        .returning();

    if (!updated) {
      throw new CustomerUploadReviewError(404, "Customer upload not found.");
    }

    await tx.insert(auditLogs).values({
      organizationId: input.organizationId,
      userId: input.actorUserId,
      userName: input.actorUserName,
      actionType: "customer_upload.reviewed",
      entityType: `${input.entityType}_attachment`,
      entityId: input.attachmentId,
      entityName: updated.originalFilename || updated.fileName || input.attachmentId,
      description: input.status === "accepted"
        ? `Customer ${input.entityType} upload accepted for staff reference.`
        : `Customer ${input.entityType} upload rejected.`,
      oldValues: {
        reviewStatus: existing.customerUploadReviewStatus,
        role: input.entityType === "order" ? (existing as typeof orderAttachments.$inferSelect).role : null,
        isPrimary: input.entityType === "order" ? (existing as typeof orderAttachments.$inferSelect).isPrimary : false,
      },
      newValues: {
        reviewStatus: input.status,
        reviewNote,
        promotion: null,
        finalArtwork: false,
        workflowStateChanged: false,
      },
      ipAddress: input.ipAddress || null,
      userAgent: input.userAgent || null,
    });

    return updated;
  });
}

export type PromoteCustomerUploadInput = {
  organizationId: string;
  entityType: "quote" | "order";
  entityId: string;
  attachmentId: string;
  promotion: CustomerUploadPromotion;
  actorUserId: string;
  actorUserName: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
};

/**
 * Deliberately promotes an accepted customer upload to a safe usable reference.
 * This only updates attachment metadata; it never assigns a line item, makes
 * artwork primary/final, or advances a quote/order workflow.
 */
export async function promoteCustomerUpload(input: PromoteCustomerUploadInput) {
  if (input.entityType === "quote" && input.promotion === "artwork") {
    throw new CustomerUploadReviewError(400, "Quote uploads can only be promoted as approved references.");
  }

  return db.transaction(async (tx) => {
    const entity = input.entityType === "quote"
      ? await tx
        .select({ id: quotes.id })
        .from(quotes)
        .where(and(eq(quotes.id, input.entityId), eq(quotes.organizationId, input.organizationId)))
        .limit(1)
      : await tx
        .select({ id: orders.id })
        .from(orders)
        .where(and(eq(orders.id, input.entityId), eq(orders.organizationId, input.organizationId)))
        .limit(1);

    if (!entity[0]) {
      throw new CustomerUploadReviewError(404, "Customer upload not found.");
    }

    const attachment = input.entityType === "quote"
      ? await tx
        .select()
        .from(quoteAttachments)
        .where(and(
          eq(quoteAttachments.id, input.attachmentId),
          eq(quoteAttachments.quoteId, input.entityId),
          eq(quoteAttachments.organizationId, input.organizationId),
          isNull(quoteAttachments.quoteLineItemId),
        ))
        .limit(1)
      : await tx
        .select()
        .from(orderAttachments)
        .where(and(
          eq(orderAttachments.id, input.attachmentId),
          eq(orderAttachments.orderId, input.entityId),
          isNull(orderAttachments.orderLineItemId),
        ))
        .limit(1);

    const existing = attachment[0];
    if (!existing || existing.portalFileCategory !== "customer_upload") {
      throw new CustomerUploadReviewError(404, "Customer upload not found.");
    }
    if (existing.customerUploadReviewStatus !== "accepted") {
      throw new CustomerUploadReviewError(409, "Only accepted customer uploads can be promoted.");
    }
    if (existing.customerUploadPromotionType) {
      throw new CustomerUploadReviewError(409, "This customer upload has already been promoted.");
    }

    const promotedAt = new Date();
    const commonPatch = {
      customerUploadPromotionType: input.promotion,
      customerUploadPromotedByUserId: input.actorUserId,
      customerUploadPromotedAt: promotedAt,
      updatedAt: promotedAt,
    };
    const existingOrder = existing as typeof orderAttachments.$inferSelect;
    const [updated] = input.entityType === "quote"
      ? await tx
        .update(quoteAttachments)
        .set(commonPatch)
        .where(and(
          eq(quoteAttachments.id, input.attachmentId),
          eq(quoteAttachments.quoteId, input.entityId),
          eq(quoteAttachments.organizationId, input.organizationId),
          isNull(quoteAttachments.customerUploadPromotionType),
        ))
        .returning()
      : await tx
        .update(orderAttachments)
        .set({
          ...commonPatch,
          role: input.promotion === "artwork" ? "artwork" : "reference",
          isPrimary: false,
        })
        .where(and(
          eq(orderAttachments.id, input.attachmentId),
          eq(orderAttachments.orderId, input.entityId),
          isNull(orderAttachments.customerUploadPromotionType),
        ))
        .returning();

    if (!updated) {
      throw new CustomerUploadReviewError(409, "This customer upload has already been promoted.");
    }

    await tx.insert(auditLogs).values({
      organizationId: input.organizationId,
      userId: input.actorUserId,
      userName: input.actorUserName,
      actionType: "customer_upload.promoted",
      entityType: `${input.entityType}_attachment`,
      entityId: input.attachmentId,
      entityName: updated.originalFilename || updated.fileName || input.attachmentId,
      description: `Accepted customer ${input.entityType} upload promoted as ${input.promotion === "artwork" ? "artwork reference" : "approved reference"}.`,
      oldValues: {
        reviewStatus: existing.customerUploadReviewStatus,
        promotion: existing.customerUploadPromotionType || null,
        role: input.entityType === "order" ? existingOrder.role : null,
        isPrimary: input.entityType === "order" ? existingOrder.isPrimary : false,
      },
      newValues: {
        actorUserId: input.actorUserId,
        promotedAt: promotedAt.toISOString(),
        sourceUploadId: input.attachmentId,
        targetEntityType: input.entityType,
        targetEntityId: input.entityId,
        promotionType: input.promotion,
        outcome: "promoted",
        finalArtwork: false,
        workflowStateChanged: false,
        prepressChanged: false,
        proofChanged: false,
        productionChanged: false,
        billingChanged: false,
        paymentChanged: false,
      },
      ipAddress: input.ipAddress || null,
      userAgent: input.userAgent || null,
    });

    return updated;
  });
}

export type AssignPromotedCustomerUploadInput = {
  organizationId: string;
  sourceOrderId: string;
  targetOrderId: string;
  targetLineItemId: string;
  attachmentId: string;
  assignmentType: CustomerUploadAssignmentType;
  assignmentNote?: string | null;
  actorUserId: string;
  actorUserName: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
};

/**
 * Assigns a promoted customer artwork reference to an order line item as a
 * reference only. It deliberately does not attach the file to the production
 * artwork-side workflow, set primary artwork, or invoke proof/prepress logic.
 */
export async function assignPromotedCustomerUpload(input: AssignPromotedCustomerUploadInput) {
  return db.transaction(async (tx) => {
    const [sourceOrder] = await tx
      .select({ id: orders.id, customerId: orders.customerId })
      .from(orders)
      .where(and(eq(orders.id, input.sourceOrderId), eq(orders.organizationId, input.organizationId)))
      .limit(1);
    if (!sourceOrder) {
      throw new CustomerUploadReviewError(404, "Customer upload not found.");
    }

    const [targetOrder] = await tx
      .select({ id: orders.id, customerId: orders.customerId })
      .from(orders)
      .where(and(eq(orders.id, input.targetOrderId), eq(orders.organizationId, input.organizationId)))
      .limit(1);
    if (!targetOrder || targetOrder.id !== sourceOrder.id || targetOrder.customerId !== sourceOrder.customerId) {
      throw new CustomerUploadReviewError(404, "Target order is not available for this customer upload.");
    }

    const [lineItem] = await tx
      .select({ id: orderLineItems.id })
      .from(orderLineItems)
      .where(and(eq(orderLineItems.id, input.targetLineItemId), eq(orderLineItems.orderId, input.targetOrderId)))
      .limit(1);
    if (!lineItem) {
      throw new CustomerUploadReviewError(404, "Target order line item not found.");
    }

    const [existing] = await tx
      .select()
      .from(orderAttachments)
      .where(and(
        eq(orderAttachments.id, input.attachmentId),
        eq(orderAttachments.orderId, input.sourceOrderId),
        isNull(orderAttachments.orderLineItemId),
      ))
      .limit(1);

    if (!existing || existing.portalFileCategory !== "customer_upload") {
      throw new CustomerUploadReviewError(404, "Customer upload not found.");
    }
    if (existing.customerUploadReviewStatus !== "accepted" || existing.customerUploadPromotionType !== "artwork") {
      throw new CustomerUploadReviewError(409, "Only promoted artwork-reference customer uploads can be assigned.");
    }
    if (existing.customerUploadAssignmentType) {
      throw new CustomerUploadReviewError(409, "This customer upload is already assigned to a line item reference.");
    }

    const assignedAt = new Date();
    const assignmentNote = normalizeNote(input.assignmentNote);
    const [updated] = await tx
      .update(orderAttachments)
      .set({
        customerUploadAssignedToOrderLineItemId: input.targetLineItemId,
        customerUploadAssignmentType: input.assignmentType,
        customerUploadAssignedByUserId: input.actorUserId,
        customerUploadAssignedAt: assignedAt,
        customerUploadAssignmentNote: assignmentNote,
        updatedAt: assignedAt,
      })
      .where(and(
        eq(orderAttachments.id, input.attachmentId),
        eq(orderAttachments.orderId, input.sourceOrderId),
        isNull(orderAttachments.orderLineItemId),
        isNull(orderAttachments.customerUploadAssignmentType),
      ))
      .returning();
    if (!updated) {
      throw new CustomerUploadReviewError(409, "This customer upload is already assigned to a line item reference.");
    }

    await tx.insert(auditLogs).values({
      organizationId: input.organizationId,
      userId: input.actorUserId,
      userName: input.actorUserName,
      actionType: "customer_upload.assigned",
      entityType: "order_attachment",
      entityId: input.attachmentId,
      entityName: updated.originalFilename || updated.fileName || input.attachmentId,
      description: "Promoted customer artwork reference assigned to an order line item as a reference only.",
      oldValues: {
        assignmentType: existing.customerUploadAssignmentType || null,
        targetOrderId: null,
        targetLineItemId: existing.customerUploadAssignedToOrderLineItemId || null,
        orderLineItemId: existing.orderLineItemId || null,
        isPrimary: existing.isPrimary,
      },
      newValues: {
        actorUserId: input.actorUserId,
        assignedAt: assignedAt.toISOString(),
        sourceUploadId: input.attachmentId,
        targetOrderId: input.targetOrderId,
        targetLineItemId: input.targetLineItemId,
        assignmentType: input.assignmentType,
        assignmentNote,
        outcome: "assigned",
        finalArtwork: false,
        primaryArtworkChanged: false,
        workflowStateChanged: false,
        prepressChanged: false,
        proofChanged: false,
        productionChanged: false,
        billingChanged: false,
        paymentChanged: false,
        epsChanged: false,
      },
      ipAddress: input.ipAddress || null,
      userAgent: input.userAgent || null,
    });

    return updated;
  });
}

export type SelectAssignedCustomerUploadForArtworkInput = {
  organizationId: string;
  sourceOrderId: string;
  targetOrderId: string;
  targetLineItemId: string;
  attachmentId: string;
  artworkSelectionType: CustomerUploadArtworkSelectionType;
  artworkSelectionNote?: string | null;
  actorUserId: string;
  actorUserName: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
};

/**
 * Makes an assigned customer artwork reference available to the existing
 * line-item artwork-side controls. This is an intake step only: it leaves the
 * file non-primary with side `na` and does not invoke proof or prepress logic.
 */
export async function selectAssignedCustomerUploadForArtwork(input: SelectAssignedCustomerUploadForArtworkInput) {
  return db.transaction(async (tx) => {
    const [sourceOrder] = await tx
      .select({ id: orders.id, customerId: orders.customerId })
      .from(orders)
      .where(and(eq(orders.id, input.sourceOrderId), eq(orders.organizationId, input.organizationId)))
      .limit(1);
    if (!sourceOrder) throw new CustomerUploadReviewError(404, "Customer upload not found.");

    const [targetOrder] = await tx
      .select({ id: orders.id, customerId: orders.customerId })
      .from(orders)
      .where(and(eq(orders.id, input.targetOrderId), eq(orders.organizationId, input.organizationId)))
      .limit(1);
    if (!targetOrder || targetOrder.id !== sourceOrder.id || targetOrder.customerId !== sourceOrder.customerId) {
      throw new CustomerUploadReviewError(404, "Target order is not available for this customer upload.");
    }

    const [lineItem] = await tx
      .select({ id: orderLineItems.id })
      .from(orderLineItems)
      .where(and(eq(orderLineItems.id, input.targetLineItemId), eq(orderLineItems.orderId, input.targetOrderId)))
      .limit(1);
    if (!lineItem) throw new CustomerUploadReviewError(404, "Target order line item not found.");

    const [existing] = await tx
      .select()
      .from(orderAttachments)
      .where(and(
        eq(orderAttachments.id, input.attachmentId),
        eq(orderAttachments.orderId, input.sourceOrderId),
        isNull(orderAttachments.orderLineItemId),
      ))
      .limit(1);
    if (!existing || existing.portalFileCategory !== "customer_upload") {
      throw new CustomerUploadReviewError(404, "Customer upload not found.");
    }
    if (
      existing.customerUploadReviewStatus !== "accepted"
      || existing.customerUploadPromotionType !== "artwork"
      || existing.customerUploadAssignmentType !== "reference_for_line_item"
      || existing.customerUploadAssignedToOrderLineItemId !== input.targetLineItemId
      || existing.role !== "artwork"
      || existing.side !== "na"
      || existing.isPrimary
    ) {
      throw new CustomerUploadReviewError(409, "Only assigned artwork-reference customer uploads can enter artwork-side selection.");
    }
    if (existing.customerUploadArtworkSelectionType) {
      throw new CustomerUploadReviewError(409, "This customer upload is already available for artwork-side selection.");
    }

    const selectedAt = new Date();
    const artworkSelectionNote = normalizeNote(input.artworkSelectionNote);
    const [updated] = await tx
      .update(orderAttachments)
      .set({
        orderLineItemId: input.targetLineItemId,
        customerUploadArtworkSelectionType: input.artworkSelectionType,
        customerUploadArtworkSelectedByUserId: input.actorUserId,
        customerUploadArtworkSelectedAt: selectedAt,
        customerUploadArtworkSelectionNote: artworkSelectionNote,
        updatedAt: selectedAt,
      })
      .where(and(
        eq(orderAttachments.id, input.attachmentId),
        eq(orderAttachments.orderId, input.sourceOrderId),
        isNull(orderAttachments.orderLineItemId),
        eq(orderAttachments.customerUploadAssignedToOrderLineItemId, input.targetLineItemId),
        isNull(orderAttachments.customerUploadArtworkSelectionType),
      ))
      .returning();
    if (!updated) {
      throw new CustomerUploadReviewError(409, "This customer upload is already available for artwork-side selection.");
    }

    await tx.insert(auditLogs).values({
      organizationId: input.organizationId,
      userId: input.actorUserId,
      userName: input.actorUserName,
      actionType: "customer_upload.artwork_side_selected",
      entityType: "order_attachment",
      entityId: input.attachmentId,
      entityName: updated.originalFilename || updated.fileName || input.attachmentId,
      description: "Assigned customer artwork reference made available for existing artwork-side selection.",
      oldValues: {
        orderLineItemId: existing.orderLineItemId || null,
        assignedLineItemId: existing.customerUploadAssignedToOrderLineItemId || null,
        artworkSelectionType: existing.customerUploadArtworkSelectionType || null,
        side: existing.side,
        isPrimary: existing.isPrimary,
      },
      newValues: {
        actorUserId: input.actorUserId,
        selectedAt: selectedAt.toISOString(),
        sourceAttachmentId: input.attachmentId,
        targetOrderId: input.targetOrderId,
        targetLineItemId: input.targetLineItemId,
        artworkSideAction: input.artworkSelectionType,
        artworkSelectionNote,
        outcome: "selected_for_artwork_side_intake",
        finalArtwork: false,
        primaryArtworkChanged: false,
        workflowStateChanged: false,
        prepressChanged: false,
        proofChanged: false,
        productionChanged: false,
        billingChanged: false,
        paymentChanged: false,
        epsChanged: false,
      },
      ipAddress: input.ipAddress || null,
      userAgent: input.userAgent || null,
    });

    return updated;
  });
}

export type DesignateCustomerUploadArtworkSideInput = {
  organizationId: string;
  sourceOrderId: string;
  targetOrderId: string;
  targetLineItemId: string;
  attachmentId: string;
  side: CustomerUploadArtworkSideDesignation;
  designationNote?: string | null;
  actorUserId: string;
  actorUserName: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
};

/**
 * Explicitly designates Front, Back, or Both for an intake-selected customer
 * artwork reference. This deliberately follows the established order-side
 * conflict behavior, but never invokes proof, prepress, final-art, primary,
 * production, billing, payment, or EPS workflows.
 */
export async function designateCustomerUploadArtworkSide(input: DesignateCustomerUploadArtworkSideInput) {
  try {
    return await db.transaction(async (tx) => {
    const [sourceOrder] = await tx
      .select({ id: orders.id, customerId: orders.customerId })
      .from(orders)
      .where(and(eq(orders.id, input.sourceOrderId), eq(orders.organizationId, input.organizationId)))
      .limit(1);
    if (!sourceOrder) throw new CustomerUploadReviewError(404, "Customer upload not found.");

    const [targetOrder] = await tx
      .select({ id: orders.id, customerId: orders.customerId })
      .from(orders)
      .where(and(eq(orders.id, input.targetOrderId), eq(orders.organizationId, input.organizationId)))
      .limit(1);
    if (!targetOrder || targetOrder.id !== sourceOrder.id || targetOrder.customerId !== sourceOrder.customerId) {
      throw new CustomerUploadReviewError(404, "Target order is not available for this customer upload.");
    }

    const [lineItem] = await tx
      .select({ id: orderLineItems.id, specsJson: orderLineItems.specsJson })
      .from(orderLineItems)
      .where(and(eq(orderLineItems.id, input.targetLineItemId), eq(orderLineItems.orderId, input.targetOrderId)))
      .limit(1);
    if (!lineItem) throw new CustomerUploadReviewError(404, "Target order line item not found.");

    const [existing] = await tx
      .select()
      .from(orderAttachments)
      .where(and(
        eq(orderAttachments.id, input.attachmentId),
        eq(orderAttachments.orderId, input.sourceOrderId),
        eq(orderAttachments.orderLineItemId, input.targetLineItemId),
      ))
      .limit(1);
    if (!existing || existing.portalFileCategory !== "customer_upload") {
      throw new CustomerUploadReviewError(404, "Customer upload not found.");
    }
    if (
      existing.customerUploadReviewStatus !== "accepted"
      || existing.customerUploadPromotionType !== "artwork"
      || existing.customerUploadAssignmentType !== "reference_for_line_item"
      || existing.customerUploadAssignedToOrderLineItemId !== input.targetLineItemId
      || existing.customerUploadArtworkSelectionType !== "artwork_side_intake"
      || existing.role !== "artwork"
      || existing.side !== "na"
      || existing.isPrimary
    ) {
      throw new CustomerUploadReviewError(409, "Only intake-selected artwork-reference customer uploads can have an artwork side designated.");
    }

    if (existing.fileRecordId) {
      const [finalFile] = await tx
        .select({ id: lineItemFiles.id })
        .from(lineItemFiles)
        .where(and(
          eq(lineItemFiles.organizationId, input.organizationId),
          eq(lineItemFiles.orderId, input.targetOrderId),
          eq(lineItemFiles.lineItemId, input.targetLineItemId),
          eq(lineItemFiles.fileRecordId, existing.fileRecordId),
          eq(lineItemFiles.role, "final"),
          eq(lineItemFiles.status, "active"),
        ))
        .limit(1);
      if (finalFile) {
        throw new CustomerUploadReviewError(409, "Final-art customer uploads cannot have an artwork side designated through this workflow.");
      }
    }

    const designatedAt = new Date();
    const designationNote = normalizeNote(input.designationNote);
    const conflictingSides = getConflictingArtworkSides(input.side);
    await tx
      .update(orderAttachments)
      .set({ side: "na", updatedAt: designatedAt })
      .where(and(
        eq(orderAttachments.orderId, input.targetOrderId),
        eq(orderAttachments.orderLineItemId, input.targetLineItemId),
        ne(orderAttachments.id, input.attachmentId),
        inArray(orderAttachments.side, conflictingSides),
        // Candidate supersession belongs to the separately-confirmed candidate
        // action. Clearing an active candidate's attachment side here would
        // violate 0146, which requires its candidate side to match `side`.
        isNull(orderAttachments.customerUploadPrimaryCandidateSide),
      ));

    const [updated] = await tx
      .update(orderAttachments)
      .set({ side: input.side, updatedAt: designatedAt })
      .where(and(
        eq(orderAttachments.id, input.attachmentId),
        eq(orderAttachments.orderId, input.sourceOrderId),
        eq(orderAttachments.orderLineItemId, input.targetLineItemId),
        eq(orderAttachments.portalFileCategory, "customer_upload"),
        eq(orderAttachments.customerUploadReviewStatus, "accepted"),
        eq(orderAttachments.customerUploadPromotionType, "artwork"),
        eq(orderAttachments.customerUploadAssignmentType, "reference_for_line_item"),
        eq(orderAttachments.customerUploadAssignedToOrderLineItemId, input.targetLineItemId),
        eq(orderAttachments.customerUploadArtworkSelectionType, "artwork_side_intake"),
        eq(orderAttachments.role, "artwork"),
        eq(orderAttachments.side, "na"),
        eq(orderAttachments.isPrimary, false),
      ))
      .returning();
    if (!updated) {
      throw new CustomerUploadReviewError(409, "This customer upload is no longer eligible for artwork-side designation.");
    }

    await tx
      .update(orderLineItems)
      .set({
        specsJson: applyArtworkSideAssignmentToSpecs({
          specsJson: lineItem.specsJson,
          fileId: updated.id,
          fileRecordId: updated.fileRecordId,
          side: input.side,
        }),
        updatedAt: designatedAt,
      })
      .where(and(eq(orderLineItems.id, input.targetLineItemId), eq(orderLineItems.orderId, input.targetOrderId)));

    await tx.insert(auditLogs).values({
      organizationId: input.organizationId,
      userId: input.actorUserId,
      userName: input.actorUserName,
      actionType: "customer_upload.artwork_side_designated",
      entityType: "order_attachment",
      entityId: input.attachmentId,
      entityName: updated.originalFilename || updated.fileName || input.attachmentId,
      description: `Customer artwork reference explicitly designated as ${input.side}.`,
      oldValues: {
        side: existing.side,
        isPrimary: existing.isPrimary,
        artworkSelectionType: existing.customerUploadArtworkSelectionType,
      },
      newValues: {
        actorUserId: input.actorUserId,
        designatedAt: designatedAt.toISOString(),
        sourceAttachmentId: input.attachmentId,
        targetOrderId: input.targetOrderId,
        targetLineItemId: input.targetLineItemId,
        selectedSide: input.side,
        action: "artwork_side_designation",
        designationNote,
        outcome: "side_designated",
        finalArtwork: false,
        primaryArtworkChanged: false,
        workflowStateChanged: false,
        prepressChanged: false,
        proofChanged: false,
        productionChanged: false,
        billingChanged: false,
        paymentChanged: false,
        epsChanged: false,
      },
      ipAddress: input.ipAddress || null,
      userAgent: input.userAgent || null,
    });

    return updated;
    });
  } catch (error: any) {
    // A concurrent legacy/conflicting side update must be a controlled denial,
    // never a staff-facing HTTP 500. Normal candidate conflicts are handled by
    // the candidate-selection transaction after designation succeeds.
    if (error?.code === "23514") {
      throw new CustomerUploadReviewError(409, "Artwork-side designation conflicts with an active customer artwork candidate.");
    }
    throw error;
  }
}

export type SelectCustomerUploadPrimaryArtworkCandidateInput = {
  organizationId: string;
  sourceOrderId: string;
  targetOrderId: string;
  targetLineItemId: string;
  attachmentId: string;
  side: CustomerUploadPrimaryArtworkCandidateSide;
  candidateNote?: string | null;
  actorUserId: string;
  actorUserName: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
};

/**
 * Marks a side-designated customer upload as a staff-only primary artwork
 * candidate. This intentionally uses separate candidate metadata rather than
 * orderAttachments.isPrimary, which is consumed by operational workflows.
 */
export async function selectCustomerUploadPrimaryArtworkCandidate(input: SelectCustomerUploadPrimaryArtworkCandidateInput) {
  return db.transaction(async (tx) => {
    const [sourceOrder] = await tx
      .select({ id: orders.id, customerId: orders.customerId })
      .from(orders)
      .where(and(eq(orders.id, input.sourceOrderId), eq(orders.organizationId, input.organizationId)))
      .limit(1);
    if (!sourceOrder) throw new CustomerUploadReviewError(404, "Customer upload not found.");

    const [targetOrder] = await tx
      .select({ id: orders.id, customerId: orders.customerId })
      .from(orders)
      .where(and(eq(orders.id, input.targetOrderId), eq(orders.organizationId, input.organizationId)))
      .limit(1);
    if (!targetOrder || targetOrder.id !== sourceOrder.id || targetOrder.customerId !== sourceOrder.customerId) {
      throw new CustomerUploadReviewError(404, "Target order is not available for this customer upload.");
    }

    const [lineItem] = await tx
      .select({ id: orderLineItems.id })
      .from(orderLineItems)
      .where(and(eq(orderLineItems.id, input.targetLineItemId), eq(orderLineItems.orderId, input.targetOrderId)))
      .limit(1);
    if (!lineItem) throw new CustomerUploadReviewError(404, "Target order line item not found.");

    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`customer-upload-primary-candidate:${input.organizationId}:${input.targetOrderId}:${input.targetLineItemId}`}))`);

    const [existing] = await tx
      .select()
      .from(orderAttachments)
      .where(and(
        eq(orderAttachments.id, input.attachmentId),
        eq(orderAttachments.orderId, input.sourceOrderId),
        eq(orderAttachments.orderLineItemId, input.targetLineItemId),
      ))
      .limit(1);
    if (!existing || existing.portalFileCategory !== "customer_upload") {
      throw new CustomerUploadReviewError(404, "Customer upload not found.");
    }
    if (
      existing.customerUploadReviewStatus !== "accepted"
      || existing.customerUploadPromotionType !== "artwork"
      || existing.customerUploadAssignmentType !== "reference_for_line_item"
      || existing.customerUploadAssignedToOrderLineItemId !== input.targetLineItemId
      || existing.customerUploadArtworkSelectionType !== "artwork_side_intake"
      || existing.role !== "artwork"
      || existing.side !== input.side
      || existing.isPrimary
      || existing.customerUploadPrimaryCandidateSide
    ) {
      throw new CustomerUploadReviewError(409, "Only side-designated, non-primary customer artwork references can become primary artwork candidates.");
    }

    if (existing.fileRecordId) {
      const [finalFile] = await tx
        .select({ id: lineItemFiles.id })
        .from(lineItemFiles)
        .where(and(
          eq(lineItemFiles.organizationId, input.organizationId),
          eq(lineItemFiles.orderId, input.targetOrderId),
          eq(lineItemFiles.lineItemId, input.targetLineItemId),
          eq(lineItemFiles.fileRecordId, existing.fileRecordId),
          eq(lineItemFiles.role, "final"),
          eq(lineItemFiles.status, "active"),
        ))
        .limit(1);
      if (finalFile) {
        throw new CustomerUploadReviewError(409, "Final-art customer uploads cannot become primary artwork candidates through this workflow.");
      }
    }

    const candidateAt = new Date();
    const candidateNote = normalizeNote(input.candidateNote);
    const conflictingSides = getConflictingArtworkSides(input.side);
    const previousCandidates = await tx
      .select({
        id: orderAttachments.id,
        candidateSide: orderAttachments.customerUploadPrimaryCandidateSide,
        candidateByUserId: orderAttachments.customerUploadPrimaryCandidateByUserId,
        candidateAt: orderAttachments.customerUploadPrimaryCandidateAt,
      })
      .from(orderAttachments)
      .where(and(
        eq(orderAttachments.orderId, input.targetOrderId),
        eq(orderAttachments.orderLineItemId, input.targetLineItemId),
        ne(orderAttachments.id, input.attachmentId),
        inArray(orderAttachments.customerUploadPrimaryCandidateSide, conflictingSides),
      ));

    await tx
      .update(orderAttachments)
      .set({
        customerUploadPrimaryCandidateSide: null,
        customerUploadPrimaryCandidateByUserId: null,
        customerUploadPrimaryCandidateAt: null,
        customerUploadPrimaryCandidateNote: null,
        updatedAt: candidateAt,
      })
      .where(and(
        eq(orderAttachments.orderId, input.targetOrderId),
        eq(orderAttachments.orderLineItemId, input.targetLineItemId),
        ne(orderAttachments.id, input.attachmentId),
        inArray(orderAttachments.customerUploadPrimaryCandidateSide, conflictingSides),
      ));

    const [updated] = await tx
      .update(orderAttachments)
      .set({
        customerUploadPrimaryCandidateSide: input.side,
        customerUploadPrimaryCandidateByUserId: input.actorUserId,
        customerUploadPrimaryCandidateAt: candidateAt,
        customerUploadPrimaryCandidateNote: candidateNote,
        updatedAt: candidateAt,
      })
      .where(and(
        eq(orderAttachments.id, input.attachmentId),
        eq(orderAttachments.orderId, input.sourceOrderId),
        eq(orderAttachments.orderLineItemId, input.targetLineItemId),
        eq(orderAttachments.portalFileCategory, "customer_upload"),
        eq(orderAttachments.customerUploadReviewStatus, "accepted"),
        eq(orderAttachments.customerUploadPromotionType, "artwork"),
        eq(orderAttachments.customerUploadAssignmentType, "reference_for_line_item"),
        eq(orderAttachments.customerUploadAssignedToOrderLineItemId, input.targetLineItemId),
        eq(orderAttachments.customerUploadArtworkSelectionType, "artwork_side_intake"),
        eq(orderAttachments.role, "artwork"),
        eq(orderAttachments.side, input.side),
        eq(orderAttachments.isPrimary, false),
        isNull(orderAttachments.customerUploadPrimaryCandidateSide),
      ))
      .returning();
    if (!updated) {
      throw new CustomerUploadReviewError(409, "This customer upload is no longer eligible for primary artwork candidate selection.");
    }

    await tx.insert(auditLogs).values({
      organizationId: input.organizationId,
      userId: input.actorUserId,
      userName: input.actorUserName,
      actionType: "customer_upload.primary_artwork_candidate_selected",
      entityType: "order_attachment",
      entityId: input.attachmentId,
      entityName: updated.originalFilename || updated.fileName || input.attachmentId,
      description: `Customer artwork reference selected as the ${input.side} primary artwork candidate.`,
      oldValues: {
        primaryCandidateSide: existing.customerUploadPrimaryCandidateSide || null,
        isPrimary: existing.isPrimary,
        side: existing.side,
        replacedCandidates: previousCandidates,
      },
      newValues: {
        actorUserId: input.actorUserId,
        candidateAt: candidateAt.toISOString(),
        sourceAttachmentId: input.attachmentId,
        targetOrderId: input.targetOrderId,
        targetLineItemId: input.targetLineItemId,
        selectedSide: input.side,
        action: "primary_artwork_candidate_selection",
        candidateNote,
        confirmPrimaryArtworkCandidate: true,
        outcome: "primary_candidate_selected",
        replacedCandidateIds: previousCandidates.map((candidate) => candidate.id),
        replacedCandidateDetails: previousCandidates,
        finalArtwork: false,
        primaryArtworkChanged: false,
        proofChanged: false,
        prepressChanged: false,
        productionChanged: false,
        billingChanged: false,
        paymentChanged: false,
        epsChanged: false,
      },
      ipAddress: input.ipAddress || null,
      userAgent: input.userAgent || null,
    });

    return updated;
  });
}
