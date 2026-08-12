import { and, eq } from "drizzle-orm";

import { auditLogs, quotes } from "@shared/schema";
import { db } from "../../db";
import { storage } from "../../storage";
import { resolveOrderCustomerContactIds } from "../orderCustomerResolutionService";

type CreateQuotePayload = Parameters<typeof storage.createQuote>[1];
type UpdateQuotePayload = Parameters<typeof storage.updateQuote>[2];

export class CanonicalQuoteOperationError extends Error {
  constructor(readonly code: "QUOTE_NOT_FOUND" | "QUOTE_NOT_EDITABLE" | "QUOTE_STALE", message: string) { super(message); }
}

/** Shared boundary for Quote draft and header writes; line pricing remains specialised. */
class CanonicalQuoteOperations {
  async normalizeOwnerIdentity(input: { organizationId: string; customerId?: string | null; contactId?: string | null }) {
    return resolveOrderCustomerContactIds(input);
  }

  async createDraft(input: { organizationId: string; actorUserId: string; payload: CreateQuotePayload; auditDescription?: string }) {
    const identity = await this.normalizeOwnerIdentity({ organizationId: input.organizationId, customerId: input.payload.customerId, contactId: input.payload.contactId });
    const quote = await storage.createQuote(input.organizationId, { ...input.payload, userId: input.actorUserId, customerId: identity.customerId, contactId: identity.contactId, status: "draft" });
    await db.insert(auditLogs).values({ organizationId: input.organizationId, userId: input.actorUserId, actionType: "CREATE", entityType: "quote", entityId: quote.id, entityName: quote.displayNumber || quote.quoteNumber?.toString() || quote.id, description: input.auditDescription ?? `Created draft quote ${quote.displayNumber || quote.quoteNumber}.` });
    return quote;
  }

  async updateEditableHeader(input: { organizationId: string; actorUserId: string; quoteId: string; changes: UpdateQuotePayload; expectedUpdatedAt?: Date | string | null; requireDraft?: boolean; auditDescription?: string }) {
    const [existing] = await db.select().from(quotes).where(and(eq(quotes.id, input.quoteId), eq(quotes.organizationId, input.organizationId))).limit(1);
    if (!existing) throw new CanonicalQuoteOperationError("QUOTE_NOT_FOUND", "Quote not found.");
    if (input.requireDraft && existing.status !== "draft") throw new CanonicalQuoteOperationError("QUOTE_NOT_EDITABLE", "Only draft quotes can be changed by this operation.");
    if (input.expectedUpdatedAt && String(existing.updatedAt) !== String(input.expectedUpdatedAt)) throw new CanonicalQuoteOperationError("QUOTE_STALE", "The quote changed after this proposal was prepared.");
    const ownerTouched = input.changes.customerId !== undefined || input.changes.contactId !== undefined;
    const identity = ownerTouched ? await this.normalizeOwnerIdentity({
      organizationId: input.organizationId,
      customerId: input.changes.customerId !== undefined ? input.changes.customerId as string | null : existing.customerId,
      contactId: input.changes.contactId !== undefined ? input.changes.contactId as string | null : existing.contactId,
    }) : null;
    const quote = await storage.updateQuote(input.organizationId, input.quoteId, { ...input.changes, ...(identity ? { customerId: identity.customerId, contactId: identity.contactId } : {}) });
    await db.insert(auditLogs).values({ organizationId: input.organizationId, userId: input.actorUserId, actionType: "UPDATE", entityType: "quote", entityId: quote.id, entityName: quote.displayNumber || quote.quoteNumber?.toString() || quote.id, description: input.auditDescription ?? `Updated quote ${quote.displayNumber || quote.quoteNumber}.` });
    return quote;
  }
}

export const canonicalQuoteOperations = new CanonicalQuoteOperations();
