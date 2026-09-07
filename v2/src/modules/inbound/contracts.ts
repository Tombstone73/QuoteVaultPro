import type { CreateOrderInput } from "../sales/orderApplication.js";
import type { ArtworkFileId, ContactId, CustomerId, InboundAttachmentId, InboundIntakeId, OrderId, OrganizationId, ProductId } from "../shared/commercialValues.js";

export const inboundIntakeStates = [
  "received", "needs_review", "ready", "converting", "converted",
  "duplicate", "rejected", "failed", "action_required",
] as const;
export type InboundIntakeState = (typeof inboundIntakeStates)[number];
export type InboundSourceProvider = "gmail" | "manual" | "imported";

/** Raw source evidence is immutable; reviewDraft is the only operator-editable projection. */
export type InboundIntake = Readonly<{
  id: InboundIntakeId;
  organizationId: OrganizationId;
  sourceProvider: InboundSourceProvider;
  sourceMessageId?: string;
  sourceMailbox?: string;
  senderName?: string;
  senderEmail?: string;
  recipientEmail?: string;
  subject?: string;
  receivedAt: string;
  rawSource: Readonly<Record<string, unknown>>;
  normalizedBody?: string;
  extractedDraft: Readonly<Record<string, unknown>>;
  reviewDraft: InboundReviewDraft;
  state: InboundIntakeState;
  matchedCustomerId?: CustomerId;
  matchedContactId?: ContactId;
  convertedOrderId?: OrderId;
  conversionRequestId?: string;
  decisionReason?: string;
  failureCode?: string;
  failureMessage?: string;
  createdAt: string;
  updatedAt: string;
  convertedAt?: string;
}>;

export type InboundReviewLine = Readonly<{
  productId: ProductId;
  description?: string;
  quantity: number;
  selections?: Readonly<Record<string, unknown>>;
  dimensions?: CreateOrderInput["lines"][number]["dimensions"];
}>;
export type InboundReviewDraft = Readonly<{
  purchaseOrderNumber?: string;
  requestedDueDate?: string;
  requestedFulfillment?: CreateOrderInput["requestedFulfillment"];
  notes?: string;
  lines?: readonly InboundReviewLine[];
  artworkAttachmentIds?: readonly InboundAttachmentId[];
}>;

export type InboundIntakeAttachment = Readonly<{
  id: InboundAttachmentId;
  intakeId: InboundIntakeId;
  sourceAttachmentId: string;
  filename: string;
  contentType?: string;
  byteSize?: number;
  sourceReference: Readonly<Record<string, unknown>>;
  canonicalArtworkFileId?: ArtworkFileId;
  createdAt: string;
}>;

export type InboundIntakeEvent = Readonly<{
  id: string;
  intakeId: InboundIntakeId;
  type: string;
  businessRequestId?: string;
  detail: Readonly<Record<string, unknown>>;
  actor: Readonly<{ principalKind: string; principalSubject: string; staffActorUserId?: string }>;
  createdAt: string;
}>;

export type InboundIntakeDetail = Readonly<{
  intake: InboundIntake;
  attachments: readonly InboundIntakeAttachment[];
  events: readonly InboundIntakeEvent[];
}>;
export type InboundIntakePage = Readonly<{
  records: readonly InboundIntake[];
  nextCursor?: string;
}>;
export type InboundIntakeQuery = Readonly<{
  limit: number;
  cursor?: string;
  status?: InboundIntakeState;
  search?: string;
}>;

export type IngestInboundIntake = Readonly<{
  sourceProvider: InboundSourceProvider;
  sourceMessageId?: string;
  sourceMailbox?: string;
  senderName?: string;
  senderEmail?: string;
  recipientEmail?: string;
  subject?: string;
  receivedAt: string;
  rawSource: Readonly<Record<string, unknown>>;
  normalizedBody?: string;
  extractedDraft?: Readonly<Record<string, unknown>>;
}>;
export type ReviewInboundIntake = Readonly<{
  businessRequestId: string;
  reviewDraft: InboundReviewDraft;
  matchedCustomerId?: CustomerId;
  matchedContactId?: ContactId;
  /** Ready is only accepted after the deterministic conversion gate passes. */
  state?: "needs_review" | "ready";
}>;

export type InboundOrderConversionCommand = Readonly<{
  businessRequestId: string;
  customerId: CustomerId;
  contactId?: ContactId;
  purchaseOrderNumber?: string;
  requestedDueDate?: string;
  requestedFulfillment?: CreateOrderInput["requestedFulfillment"];
  lines: readonly InboundReviewLine[];
}>;

export function assertInboundReviewDraftReady(
  draft: InboundReviewDraft,
  customerId: CustomerId | undefined,
): asserts draft is InboundReviewDraft & Readonly<{ lines: readonly InboundReviewLine[] }> {
  if (!customerId) throw new Error("A canonical Customer must be selected before conversion.");
  if (!draft.lines?.length) throw new Error("Add at least one canonical Product line before conversion.");
  for (const line of draft.lines) {
    if (!line.productId || !Number.isSafeInteger(line.quantity) || line.quantity <= 0)
      throw new Error("Each proposed line needs a canonical Product and positive whole quantity.");
  }
}
