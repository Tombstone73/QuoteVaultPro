import { and, asc, eq, or } from "drizzle-orm";
import { db } from "../db";
import {
  quoteInternalNotes,
  quotes,
  users,
  type CreateQuoteInternalNote,
  type QuoteInternalNote,
} from "@shared/schema";

export type QuoteInternalNoteRow = QuoteInternalNote & {
  createdByUserName: string | null;
};

export type CreatePersistedQuoteInternalNote = CreateQuoteInternalNote & {
  source?: "manual" | "assistant";
  assistantConversationId?: string | null;
  assistantPlanId?: string | null;
  assistantExecutionId?: string | null;
  domainAuditId?: string | null;
};

export type QuoteInternalReference = {
  id: string;
  displayNumber: string | null;
  quoteNumber: number | null;
  customerName: string | null;
};

/**
 * Persistence boundary for internal quote annotations. It intentionally
 * exposes no update or delete operation, so a caller cannot accidentally turn
 * the staff-note ledger into a mutable quote field.
 */
export class QuoteInternalNotesRepository {
  constructor(private readonly dbInstance = db) {}

  async getQuoteOwnership(organizationId: string, quoteId: string, executor: any = this.dbInstance): Promise<{ quoteId: string } | null> {
    const [row] = await executor
      .select({ quoteId: quotes.id })
      .from(quotes)
      .where(and(eq(quotes.organizationId, organizationId), eq(quotes.id, quoteId)))
      .limit(1);
    return row ?? null;
  }

  async resolveReference(
    organizationId: string,
    reference: { quoteId?: string; expectedQuoteNumber?: string },
    executor: any = this.dbInstance,
  ): Promise<QuoteInternalReference | null> {
    const quoteId = reference.quoteId?.trim();
    const expectedQuoteNumber = reference.expectedQuoteNumber?.trim();
    if (!quoteId && !expectedQuoteNumber) return null;

    const predicates = [eq(quotes.organizationId, organizationId)];
    if (quoteId) {
      predicates.push(eq(quotes.id, quoteId));
    } else if (expectedQuoteNumber) {
      const numeric = Number(expectedQuoteNumber);
      const matches = [eq(quotes.displayNumber, expectedQuoteNumber)];
      if (Number.isSafeInteger(numeric) && numeric >= 0) matches.push(eq(quotes.quoteNumber, numeric));
      predicates.push(or(...matches)!);
    }

    const [row] = await executor
      .select({ id: quotes.id, displayNumber: quotes.displayNumber, quoteNumber: quotes.quoteNumber, customerName: quotes.customerName })
      .from(quotes)
      .where(and(...predicates))
      .limit(1);
    return row ?? null;
  }

  async list(organizationId: string, quoteId: string, executor: any = this.dbInstance): Promise<QuoteInternalNoteRow[]> {
    return executor
      .select({
        id: quoteInternalNotes.id,
        organizationId: quoteInternalNotes.organizationId,
        quoteId: quoteInternalNotes.quoteId,
        noteText: quoteInternalNotes.noteText,
        createdByUserId: quoteInternalNotes.createdByUserId,
        createdAt: quoteInternalNotes.createdAt,
        createdByUserName: users.email,
      })
      .from(quoteInternalNotes)
      .leftJoin(users, eq(quoteInternalNotes.createdByUserId, users.id))
      .where(and(eq(quoteInternalNotes.organizationId, organizationId), eq(quoteInternalNotes.quoteId, quoteId)))
      .orderBy(asc(quoteInternalNotes.createdAt));
  }

  async findByAssistantPlan(organizationId: string, assistantPlanId: string, executor: any = this.dbInstance): Promise<QuoteInternalNote | null> {
    const [row] = await executor
      .select()
      .from(quoteInternalNotes)
      .where(and(eq(quoteInternalNotes.organizationId, organizationId), eq(quoteInternalNotes.assistantPlanId, assistantPlanId)))
      .limit(1);
    return row ?? null;
  }

  async append(
    organizationId: string,
    quoteId: string,
    userId: string | null,
    values: CreatePersistedQuoteInternalNote,
    executor: any = this.dbInstance,
  ): Promise<QuoteInternalNote> {
    const [created] = await executor
      .insert(quoteInternalNotes)
      .values({
        organizationId, quoteId, noteText: values.noteText, createdByUserId: userId,
        source: values.source ?? "manual",
        assistantConversationId: values.assistantConversationId ?? null,
        assistantPlanId: values.assistantPlanId ?? null,
        assistantExecutionId: values.assistantExecutionId ?? null,
        domainAuditId: values.domainAuditId ?? null,
      })
      .returning();
    if (!created) throw new Error("Failed to append quote internal note");
    return created;
  }
}

export const quoteInternalNotesRepository = new QuoteInternalNotesRepository();
