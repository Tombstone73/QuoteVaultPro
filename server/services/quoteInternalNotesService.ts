import { createHash } from "node:crypto";
import { insertQuoteInternalNoteSchema, type CreateQuoteInternalNote, type QuoteInternalNote } from "@shared/schema";
import { quoteInternalNotesRepository, type CreatePersistedQuoteInternalNote, type QuoteInternalNoteRow, type QuoteInternalReference } from "../storage/quoteInternalNotes.repo";
import { AuditRepository } from "../storage/audit.repo";

export interface QuoteInternalNotesStore {
  getQuoteOwnership(organizationId: string, quoteId: string, executor?: unknown): Promise<{ quoteId: string } | null>;
  resolveReference(organizationId: string, reference: { quoteId?: string; expectedQuoteNumber?: string }, executor?: unknown): Promise<QuoteInternalReference | null>;
  list(organizationId: string, quoteId: string, executor?: unknown): Promise<QuoteInternalNoteRow[]>;
  append(organizationId: string, quoteId: string, userId: string | null, values: CreatePersistedQuoteInternalNote, executor?: unknown): Promise<QuoteInternalNote>;
  findByAssistantPlan?(organizationId: string, assistantPlanId: string, executor?: unknown): Promise<QuoteInternalNote | null>;
}

/**
 * Canonical service for staff-only quote annotations. It deliberately has no
 * route, portal, PDF, email, export, edit, or delete surface.  Future command
 * adapters may use the fingerprint helper for pre-execution revalidation.
 */
export class QuoteInternalNotesService {
  constructor(
    private readonly repository: QuoteInternalNotesStore = quoteInternalNotesRepository,
    private readonly audit: Pick<AuditRepository, "createAuditLog"> = new AuditRepository(),
  ) {}

  async list(args: { organizationId: string; quoteId: string; executor?: unknown }): Promise<QuoteInternalNoteRow[] | null> {
    const ownership = await this.repository.getQuoteOwnership(args.organizationId, args.quoteId, args.executor);
    if (!ownership) return null;
    return this.repository.list(args.organizationId, args.quoteId, args.executor);
  }

  async append(args: { organizationId: string; quoteId: string; userId: string | null; values: unknown; executor?: unknown }): Promise<QuoteInternalNote | null> {
    const parsed = insertQuoteInternalNoteSchema.parse(args.values);
    const ownership = await this.repository.getQuoteOwnership(args.organizationId, args.quoteId, args.executor);
    if (!ownership) return null;
    return this.repository.append(args.organizationId, args.quoteId, args.userId, { noteText: parsed.noteText.trim() }, args.executor);
  }

  /** The single assistant adapter entrypoint. It remains a canonical domain
   * operation: trusted actor/tenant context is supplied by the executor, and
   * the note can never be marked customer-visible by an input field. */
  async addInternalNote(args: {
    organizationId: string;
    actorUserId: string;
    quoteId: string;
    noteText: string;
    expectedQuoteNumber?: string;
    assistantPlanId: string;
    idempotencyKey: string;
    correlationId: string;
  }): Promise<{
    quote: { id: string; displayNumber: string; sourceLink: string };
    note: { id: string; content: string; createdAt: string; classification: "internal_only" };
    domainAuditReference: string;
  }> {
    const parsed = insertQuoteInternalNoteSchema.parse({ noteText: args.noteText });
    const reference = await this.resolveQuoteReference({ organizationId: args.organizationId, quoteId: args.quoteId });
    if (!reference) throw new Error("Quote not found.");
    const displayNumber = reference.displayNumber ?? String(reference.quoteNumber ?? "");
    if (!displayNumber || (args.expectedQuoteNumber && args.expectedQuoteNumber !== displayNumber && args.expectedQuoteNumber !== String(reference.quoteNumber ?? ""))) {
      throw new Error("Quote not found.");
    }

    const existing = await this.repository.findByAssistantPlan?.(args.organizationId, args.assistantPlanId);
    if (existing) return {
      quote: { id: reference.id, displayNumber, sourceLink: `/quotes/${reference.id}` },
      note: { id: existing.id, content: existing.noteText, createdAt: existing.createdAt.toISOString(), classification: "internal_only" },
      domainAuditReference: existing.domainAuditId ?? `assistant-plan:${args.assistantPlanId}`,
    };

    const audit = await this.audit.createAuditLog(args.organizationId, {
      userId: args.actorUserId,
      actionType: "CREATE",
      // Quote TimelinePanel intentionally consumes quote audit events only, so
      // this links the internal-only entry to the existing staff timeline
      // without adding any portal-facing query or a second note display.
      entityType: "quote",
      entityId: reference.id,
      entityName: displayNumber,
      description: `Assistant added an internal-only note to Quote ${displayNumber}.`,
      newValues: { quoteId: reference.id, source: "assistant", assistantPlanId: args.assistantPlanId, idempotencyKey: args.idempotencyKey, correlationId: args.correlationId },
    });
    const created = await this.repository.append(args.organizationId, reference.id, args.actorUserId, {
      noteText: parsed.noteText.trim(), source: "assistant", assistantPlanId: args.assistantPlanId,
      assistantExecutionId: args.assistantPlanId, domainAuditId: audit.id,
    });
    return {
      quote: { id: reference.id, displayNumber, sourceLink: `/quotes/${reference.id}` },
      note: { id: created.id, content: created.noteText, createdAt: created.createdAt.toISOString(), classification: "internal_only" },
      domainAuditReference: audit.id,
    };
  }

  /**
   * Tenant-scoped, reduced lookup for planning. It is intentionally unable to
   * return quote line items, addresses, pricing, workflow notes, or the note
   * ledger itself.
   */
  async resolveQuoteReference(args: { organizationId: string; quoteId?: string; expectedQuoteNumber?: string; executor?: unknown }): Promise<(QuoteInternalReference & { fingerprint: string }) | null> {
    const reference = await this.repository.resolveReference(
      args.organizationId,
      { quoteId: args.quoteId, expectedQuoteNumber: args.expectedQuoteNumber },
      args.executor,
    );
    if (!reference) return null;
    return {
      ...reference,
      fingerprint: createHash("sha256")
        .update(`${args.organizationId}:${reference.id}:${reference.displayNumber ?? ""}:${reference.quoteNumber ?? ""}`)
        .digest("hex"),
    };
  }

  /** Fingerprint only quote ownership/identity. Existing notes do not make an append plan stale. */
  async getQuoteFingerprint(args: { organizationId: string; quoteId: string; executor?: unknown }): Promise<string | null> {
    const reference = await this.resolveQuoteReference(args);
    return reference?.fingerprint ?? null;
  }
}

export const quoteInternalNotesService = new QuoteInternalNotesService();
