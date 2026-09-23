import { and, asc, eq } from "drizzle-orm";
import { quotes, quoteLineItems } from "@shared/schema";
import { getEffectiveWorkflowState, isQuoteLocked, type QuoteStatusDB } from "@shared/quoteWorkflow";
import { validateQuoteLineOrder } from "@shared/quoteLineOrder";
import type { db } from "../db";

/** Sequence-only write: no repricing, financial snapshot, or totals refresh. */
export async function persistQuoteLineOrder(database: typeof db, input: {
  organizationId: string; quoteId: string; userId?: string;
  orderedIds: string[]; expectedIds: string[];
}) {
  return database.transaction(async (tx) => {
    const [quote] = await tx.select().from(quotes).where(and(
      eq(quotes.id, input.quoteId), eq(quotes.organizationId, input.organizationId),
      input.userId ? eq(quotes.userId, input.userId) : undefined,
    )).for("update");
    if (!quote) throw Object.assign(new Error("Quote not found"), { statusCode: 404 });
    if (isQuoteLocked(getEffectiveWorkflowState(quote.status as QuoteStatusDB, quote.validUntil, !!quote.convertedToOrderId))) {
      throw Object.assign(new Error("This Quote is locked and cannot be reordered."), { statusCode: 409 });
    }
    const lines = await tx.select().from(quoteLineItems).where(eq(quoteLineItems.quoteId, input.quoteId))
      .orderBy(asc(quoteLineItems.displayOrder), asc(quoteLineItems.id)).for("update");
    validateQuoteLineOrder(lines, input.orderedIds, input.expectedIds);
    for (let displayOrder = 0; displayOrder < input.orderedIds.length; displayOrder++) {
      const id = input.orderedIds[displayOrder];
      await tx.update(quoteLineItems).set({ displayOrder }).where(and(eq(quoteLineItems.id, id), eq(quoteLineItems.quoteId, input.quoteId)));
    }
    return input.orderedIds.map((id, displayOrder) => ({ id, displayOrder }));
  });
}
