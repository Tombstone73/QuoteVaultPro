import { and, eq, isNull } from "drizzle-orm";

import { db } from "../db";
import { auditLogs, orderAttachments, orderLineItems, orders, quoteAttachments, quotes } from "@shared/schema";

export const customerUploadReviewStatuses = ["pending_review", "accepted", "rejected"] as const;
export type CustomerUploadReviewStatus = typeof customerUploadReviewStatuses[number];
export type CustomerUploadPromotion = "reference" | "artwork";
export type CustomerUploadAssignmentType = "reference_for_line_item";

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
