import type { QuoteCheckpoint } from "./contracts.js";
import { canonicalJson } from "../shared/commercialValues.js";
import type { PreparedQuoteDeliveryEvidence } from "./contracts.js";

/** Sales owns publication; consumers receive only explicitly frozen customer facts. */
export type PublishedQuoteSummary = Readonly<{
  quoteId: string; number: string; createdAt: string; requestedDueDate?: string;
  status: string; total: Readonly<{ cents: number; currency: string }>;
  checkpointId: string; evidenceStatus: "modern" | "historical";
  deliveryMode?: "suppressed";
  convertedOrderId?: string;
}>;
export type PublishedQuoteDetail = PublishedQuoteSummary & Readonly<{
  lines: readonly Readonly<{ lineId: string; description: string; quantity: number;
    unitPrice: Readonly<{ cents: number; currency: string }>;
    lineTotal: Readonly<{ cents: number; currency: string }> }>[];
  history: readonly PublishedQuoteSummary[];
}>;
export interface QuotePublicationReadPort {
  list(organizationId: string, customerId: string, cursor?: string): Promise<Readonly<{ items: readonly PublishedQuoteSummary[]; nextCursor?: string }>>;
  get(organizationId: string, customerId: string, quoteId: string, checkpointId?: string): Promise<PublishedQuoteDetail | null>;
  pdf?(organizationId: string, customerId: string, quoteId: string, checkpointId?: string): Promise<Readonly<{ bytes: Uint8Array; number: string; evidence: "archived-pdf" | "checkpoint-preview" }> | null>;
}

export const preparedEvidenceMatchesCheckpoint = (checkpoint: QuoteCheckpoint, prepared: PreparedQuoteDeliveryEvidence): boolean => {
  const sent = checkpoint.sentEvidence;
  return checkpoint.kind === "quote_sent" && !!sent
    && checkpoint.organizationId === prepared.organizationId
    && checkpoint.sourceDocument?.quoteId === prepared.quoteId
    && canonicalJson(checkpoint.commercial) === canonicalJson(prepared.commercial)
    && canonicalJson(checkpoint.customerPresentation) === canonicalJson(prepared.customerPresentation)
    && canonicalJson(checkpoint.organizationPresentation) === canonicalJson(prepared.organizationPresentation)
    && canonicalJson(sent.customerContact) === canonicalJson(prepared.customerContact)
    && sent.recipientEmail === prepared.recipientEmail && sent.documentSha256 === prepared.documentSha256
    && sent.documentNumber === prepared.documentNumber && sent.documentDate === prepared.documentDate;
};

/** A legacy checkpoint can be read without inventing missing recipient/PDF evidence.
 * It is not a modern acceptance source. Missing immutable customer binding is unsafe. */
export const publishedQuoteProjection = (checkpoint: QuoteCheckpoint, organizationId: string, customerId: string,
  evidenceStatus: "modern" | "historical", status = "sent", convertedOrderId?: string): Omit<PublishedQuoteDetail, "history"> | null => {
  const ref = checkpoint.sentEvidence?.customerContact;
  const commercial = checkpoint.commercial;
  if (checkpoint.kind !== "quote_sent" || checkpoint.organizationId !== organizationId
    || ref?.organizationId !== organizationId || ref.customerId !== customerId
    || !checkpoint.sourceDocument?.quoteId || !checkpoint.checkpointId || !Number.isFinite(Date.parse(checkpoint.occurredAt)) || !/^[A-Z]{3}$/u.test(commercial?.currency ?? "") || !Array.isArray(commercial.lines)
    || commercial.taxComposition?.status === "unresolved") return null;
  const lines = commercial.lines.map(line => ({ lineId: line.lineId, description: line.description, quantity: line.quantity,
    unitPrice: line.sellingPriceDecision?.resultingUnitAmount, lineTotal: line.sellingLineAmount }));
  if (lines.some(line => !line.lineId || typeof line.description !== "string" || !Number.isSafeInteger(line.quantity)
    || line.quantity <= 0 || !Number.isSafeInteger(line.unitPrice?.cents) || !Number.isSafeInteger(line.lineTotal?.cents)
    || line.unitPrice.currency !== commercial.currency || line.lineTotal.currency !== commercial.currency)) return null;
  const cents = commercial.taxComposition?.status === "resolved" ? commercial.taxComposition.finalTotalCents
    : lines.reduce((sum, line) => sum + line.lineTotal.cents, 0) + (commercial.sellingAdjustment?.cents ?? 0) + (commercial.commercialCharge?.cents ?? 0);
  if (!Number.isSafeInteger(cents)) return null;
  return { quoteId: checkpoint.sourceDocument.quoteId, number: checkpoint.sentEvidence?.documentNumber ?? "Historical Quote",
    createdAt: checkpoint.occurredAt, ...(commercial.requestedDueDate ? { requestedDueDate: commercial.requestedDueDate } : {}),
    status, total: { cents, currency: commercial.currency }, checkpointId: checkpoint.checkpointId, evidenceStatus,
    ...(checkpoint.sentEvidence?.suppression ? { deliveryMode: "suppressed" as const } : {}),
    ...(convertedOrderId ? { convertedOrderId } : {}), lines };
};
