import { and, eq, isNull } from "drizzle-orm";

import { db } from "../db";
import { auditLogs, orderAttachments, orders, quoteAttachments, quotes } from "@shared/schema";

export const customerUploadReviewStatuses = ["pending_review", "accepted", "rejected"] as const;
export type CustomerUploadReviewStatus = typeof customerUploadReviewStatuses[number];
export type CustomerUploadPromotion = "reference" | "artwork";

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
  promotion?: CustomerUploadPromotion;
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
 * Reviews a portal customer upload without changing quote/order workflow state.
 * Order artwork promotion intentionally remains non-primary and does not create
 * production, prepress, or proof records.
 */
export async function reviewCustomerUpload(input: ReviewCustomerUploadInput) {
  if (input.entityType === "quote" && input.promotion === "artwork") {
    throw new CustomerUploadReviewError(400, "Quote uploads can only be accepted as reviewed attachments.");
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
    if (existing.customerUploadReviewStatus !== "pending_review") {
      throw new CustomerUploadReviewError(409, "This customer upload has already been reviewed.");
    }

    const reviewedAt = new Date();
    const reviewNote = normalizeNote(input.reviewNote);
    const existingOrder = existing as typeof orderAttachments.$inferSelect;
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
        .set({
          ...commonPatch,
          // Even when classified as artwork, this is not primary/final art and is not routed.
          role: input.status === "accepted" && input.promotion === "artwork" ? "artwork" : existingOrder.role,
          isPrimary: false,
        })
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
        role: input.entityType === "order" ? existingOrder.role : null,
        isPrimary: input.entityType === "order" ? existingOrder.isPrimary : false,
      },
      newValues: {
        reviewStatus: input.status,
        reviewNote,
        promotion: input.entityType === "order" && input.status === "accepted" ? input.promotion || "reference" : null,
        finalArtwork: false,
        workflowStateChanged: false,
      },
      ipAddress: input.ipAddress || null,
      userAgent: input.userAgent || null,
    });

    return updated;
  });
}
