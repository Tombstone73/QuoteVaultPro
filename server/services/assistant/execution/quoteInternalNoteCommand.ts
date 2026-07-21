import { z } from "zod";
import type {
  AssistantCanonicalCommandAdapter,
  AssistantCommandDefinition,
  AssistantCommandExecutionContext,
} from "./commandRegistry";

export const quoteInternalNoteCommandName = "quotes.add_internal_note" as const;
export const quoteInternalNoteCommandVersion = "v1" as const;
export const quoteInternalNoteMaximumLength = 4_000;
export const quoteInternalNoteConfirmationTtlMs = 5 * 60_000;

const safePlainText = z.string()
  .max(quoteInternalNoteMaximumLength, `Internal notes cannot exceed ${quoteInternalNoteMaximumLength} characters.`)
  .transform((value) => value.trim())
  .refine((value) => value.length > 0, "Internal note text is required.")
  // Keep line breaks and tabs, but reject NUL and other non-rendering control
  // characters. Rendering remains ordinary escaped text in the UI.
  .refine((value) => !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value), "Internal note text contains unsupported control characters.");

/** Model/user input only. Identity, permissions, tokens, and command metadata
 * are never accepted here; they come from the trusted execution context. */
export const quoteInternalNoteCommandInputSchema = z.object({
  quoteId: z.string().trim().min(1).max(128),
  noteText: safePlainText,
  /** Display-only guard; quoteId remains the sole record selector. */
  expectedQuoteNumber: z.string().trim().min(1).max(64).optional(),
}).strict();
export type QuoteInternalNoteCommandInput = z.infer<typeof quoteInternalNoteCommandInputSchema>;

export const quoteInternalNotePreviewSchema = z.object({
  quote: z.object({
    id: z.string().min(1),
    displayNumber: z.string().min(1),
    customerName: z.string().min(1).nullable(),
    sourceLink: z.string().regex(/^\/quotes\/[^\s/]+$/),
  }).strict(),
  noteText: z.string().min(1).max(quoteInternalNoteMaximumLength),
  classification: z.literal("internal_only"),
  affectedRecordCount: z.literal(1),
  unchanged: z.tuple([
    z.literal("pricing"),
    z.literal("quote_status"),
    z.literal("customer_facing_notes"),
    z.literal("order_state"),
    z.literal("production"),
    z.literal("invoice"),
    z.literal("payment"),
  ]),
}).strict();
export type QuoteInternalNotePreview = z.infer<typeof quoteInternalNotePreviewSchema>;

export const quoteInternalNoteCommandResultSchema = z.object({
  quote: z.object({
    id: z.string().min(1),
    displayNumber: z.string().min(1),
    sourceLink: z.string().regex(/^\/quotes\/[^\s/]+$/),
  }).strict(),
  note: z.object({
    id: z.string().min(1),
    content: z.string().min(1).max(quoteInternalNoteMaximumLength),
    createdAt: z.string().datetime(),
    classification: z.literal("internal_only"),
  }).strict(),
  domainAuditReference: z.string().min(1).optional(),
}).strict();
export type QuoteInternalNoteCommandResult = z.infer<typeof quoteInternalNoteCommandResultSchema>;

/**
 * The adapter deliberately exposes a single canonical domain operation. It
 * cannot receive an Express request, repository, database connection, SQL, or
 * HTTP client. The domain service remains responsible for tenant ownership,
 * actor access, append-only persistence, and the canonical domain audit link.
 */
export interface QuoteInternalNoteCanonicalService {
  addInternalNote(input: QuoteInternalNoteCommandInput & {
    organizationId: string;
    actorUserId: string;
    assistantPlanId: string;
    idempotencyKey: string;
    correlationId: string;
  }): Promise<QuoteInternalNoteCommandResult>;
}

export function createQuoteInternalNoteCanonicalAdapter(
  service: QuoteInternalNoteCanonicalService,
): AssistantCanonicalCommandAdapter<QuoteInternalNoteCommandInput, QuoteInternalNoteCommandResult> {
  return {
    async execute(input: QuoteInternalNoteCommandInput, context: AssistantCommandExecutionContext) {
      const normalized = quoteInternalNoteCommandInputSchema.parse(input);
      const result = await service.addInternalNote({
        ...normalized,
        organizationId: context.organizationId,
        actorUserId: context.actorUserId,
        assistantPlanId: context.planId,
        idempotencyKey: context.idempotencyKey,
        correlationId: context.correlationId,
      });
      return quoteInternalNoteCommandResultSchema.parse(result);
    },
  };
}

/**
 * Exactly one reviewed production command. Application composition supplies
 * the canonical domain service adapter; this definition never creates a
 * database handle or reaches an HTTP route.
 */
export function createQuoteInternalNoteCommandDefinition(
  service: QuoteInternalNoteCanonicalService,
): AssistantCommandDefinition<QuoteInternalNoteCommandInput, QuoteInternalNotePreview, QuoteInternalNoteCommandResult> {
  return {
    name: quoteInternalNoteCommandName,
    version: quoteInternalNoteCommandVersion,
    domain: "quotes",
    mode: "write",
    description: "Append one internal-only staff note to one tenant-scoped quote.",
    risk: "low",
    requiredCapability: "assistant.quotes.add_internal_note",
    allowedRoles: ["owner", "admin", "manager", "employee"],
    inputSchema: quoteInternalNoteCommandInputSchema,
    previewSchema: quoteInternalNotePreviewSchema,
    resultSchema: quoteInternalNoteCommandResultSchema,
    maxAffectedRecords: 1,
    bulkAllowed: false,
    confirmationRequired: true,
    reauthenticationRequired: false,
    confirmationExpiresInMs: quoteInternalNoteConfirmationTtlMs,
    idempotencyPolicy: "server_generated_with_request_hash",
    // Quotes have no universal updated_at version column; the domain service
    // must hash the selected quote fields used to authorize this append.
    recordFingerprintStrategy: "stable_field_hash",
    transactionPolicy: "required",
    partialFailurePolicy: "forbid",
    auditCategory: "assistant_quote_internal_note",
    undoSupport: "metadata_only",
    abandonmentPolicy: "none",
    testOnly: false,
    devEnabled: true,
    mainEnabled: true,
    adapter: createQuoteInternalNoteCanonicalAdapter(service),
  };
}
