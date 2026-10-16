import { and, eq } from "drizzle-orm";

import { auditLogs, quotes } from "@shared/schema";
import { db } from "../../db";
import { storage } from "../../storage";
import { QuotesRepository } from "../../storage/quotes.repo";
import { resolveOrderCustomerContactIds } from "../orderCustomerResolutionService";
import { getEffectiveWorkflowState, isQuoteLocked } from "@shared/quoteWorkflow";

type CreateQuotePayload = Parameters<typeof storage.createQuote>[1];
type UpdateQuotePayload = Parameters<typeof storage.updateQuote>[2];
type QuoteTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export class CanonicalQuoteOperationError extends Error {
  constructor(readonly code: "QUOTE_NOT_FOUND" | "QUOTE_NOT_EDITABLE" | "QUOTE_STALE", message: string) { super(message); }
}

/** Shared boundary for Quote draft and header writes; line pricing remains specialised. */
class CanonicalQuoteOperations {
  async runEditableTransaction<T>(input: {
    organizationId: string;
    actorUserId: string;
    quoteId: string;
    expectedRevision: number;
    auditDescription?: string;
    apply: (tx: QuoteTransaction, existing: typeof quotes.$inferSelect) => Promise<{ changed: boolean; value: T }>;
  }): Promise<T> {
    return db.transaction(async (tx) => {
      // All Quote and child writers serialize through this row and its database-owned revision.
      const [existing] = await tx.select().from(quotes).where(and(eq(quotes.id, input.quoteId), eq(quotes.organizationId, input.organizationId))).for("update").limit(1);
      if (!existing) throw new CanonicalQuoteOperationError("QUOTE_NOT_FOUND", "Quote not found.");
      if (isQuoteLocked(getEffectiveWorkflowState(existing.status, existing.validUntil, Boolean(existing.convertedToOrderId)))) {
        throw new CanonicalQuoteOperationError("QUOTE_NOT_EDITABLE", "This Quote is locked and cannot be edited.");
      }
      if (existing.revision !== input.expectedRevision) throw new CanonicalQuoteOperationError("QUOTE_STALE", "The quote changed after this proposal was prepared. Review the current Quote and try again.");
      const result = await input.apply(tx, existing);
      if (result.changed) {
        await tx.insert(auditLogs).values({ organizationId: input.organizationId, userId: input.actorUserId, actionType: "UPDATE", entityType: "quote", entityId: existing.id, entityName: existing.displayNumber || existing.quoteNumber?.toString() || existing.id, description: input.auditDescription ?? `Updated quote ${existing.displayNumber || existing.quoteNumber}.` });
      }
      return result.value;
    });
  }

  async normalizeOwnerIdentity(input: { organizationId: string; customerId?: string | null; contactId?: string | null }) {
    return resolveOrderCustomerContactIds(input);
  }

  async createDraft(input: { organizationId: string; actorUserId: string; payload: CreateQuotePayload; auditDescription?: string }) {
    const identity = await this.normalizeOwnerIdentity({ organizationId: input.organizationId, customerId: input.payload.customerId, contactId: input.payload.contactId });
    const quote = await storage.createQuote(input.organizationId, { ...input.payload, userId: input.actorUserId, customerId: identity.customerId, contactId: identity.contactId, status: "draft" });
    await db.insert(auditLogs).values({ organizationId: input.organizationId, userId: input.actorUserId, actionType: "CREATE", entityType: "quote", entityId: quote.id, entityName: quote.displayNumber || quote.quoteNumber?.toString() || quote.id, description: input.auditDescription ?? `Created draft quote ${quote.displayNumber || quote.quoteNumber}.` });
    return quote;
  }

  async updateEditableHeader(input: { organizationId: string; actorUserId: string; quoteId: string; changes: UpdateQuotePayload; expectedRevision?: number; requireDraft?: boolean; auditDescription?: string }) {
    return db.transaction(async (tx) => {
      // The row lock serializes both header and child-table writers. Check the
      // integer revision under that lock; timestamps lose PostgreSQL precision in JS.
      const [existing] = await tx.select().from(quotes).where(and(eq(quotes.id, input.quoteId), eq(quotes.organizationId, input.organizationId))).for("update").limit(1);
      if (!existing) throw new CanonicalQuoteOperationError("QUOTE_NOT_FOUND", "Quote not found.");
      if (input.requireDraft && existing.status !== "draft") throw new CanonicalQuoteOperationError("QUOTE_NOT_EDITABLE", "Only draft quotes can be changed by this operation.");
      if (input.expectedRevision !== undefined && existing.revision !== input.expectedRevision) throw new CanonicalQuoteOperationError("QUOTE_STALE", "The quote changed after this proposal was prepared. Review the current Quote and try again.");
      const ownerTouched = input.changes.customerId !== undefined || input.changes.contactId !== undefined;
      const identity = ownerTouched ? await this.normalizeOwnerIdentity({
        organizationId: input.organizationId,
        customerId: input.changes.customerId !== undefined ? input.changes.customerId as string | null : existing.customerId,
        contactId: input.changes.contactId !== undefined ? input.changes.contactId as string | null : existing.contactId,
      }) : null;
      const quote = await new QuotesRepository(tx).updateQuote(input.organizationId, input.quoteId, { ...input.changes, ...(identity ? { customerId: identity.customerId, contactId: identity.contactId } : {}) });
      await tx.insert(auditLogs).values({ organizationId: input.organizationId, userId: input.actorUserId, actionType: "UPDATE", entityType: "quote", entityId: quote.id, entityName: quote.displayNumber || quote.quoteNumber?.toString() || quote.id, description: input.auditDescription ?? `Updated quote ${quote.displayNumber || quote.quoteNumber}.` });
      return quote;
    });
  }
}

export const canonicalQuoteOperations = new CanonicalQuoteOperations();
