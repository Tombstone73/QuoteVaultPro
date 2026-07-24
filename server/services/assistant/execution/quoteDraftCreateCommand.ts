import { z } from "zod";
import type {
  AssistantCanonicalCommandAdapter,
  AssistantCommandDefinition,
  AssistantCommandExecutionContext,
} from "./commandRegistry";

export const quoteDraftCreateCommandName = "quotes.create_draft" as const;
export const quoteDraftCreateCommandVersion = "v1" as const;
export const quoteDraftCreateConfirmationTtlMs = 5 * 60_000;

const quoteSourceLinkSchema = z.string().regex(/^\/quotes\/[^\s/]+$/);
const proposalFingerprintSchema = z.string().trim().regex(/^[a-f0-9]{64}$/i, "Proposal fingerprint must be a SHA-256 digest.");

/**
 * This intentionally contains only a reference to a durable, server-validated
 * quote proposal.  Product, option, price, tax, customer, and line-item data
 * must be loaded and revalidated by the canonical quote service at execution.
 */
export const quoteDraftCreateCommandInputSchema = z.object({
  quoteIntakeSessionId: z.string().trim().min(1).max(128),
  proposalFingerprint: proposalFingerprintSchema,
  proposalId: z.string().trim().min(1).max(128).optional(),
}).strict();
export type QuoteDraftCreateCommandInput = z.infer<typeof quoteDraftCreateCommandInputSchema>;

const quoteLinePreviewSchema = z.object({
  clientKey: z.string().min(1).max(128),
  productName: z.string().min(1).max(255),
  quantity: z.number().positive(),
  dimensions: z.object({ width: z.number().positive(), height: z.number().positive(), unit: z.string().min(1).max(16) }).strict().nullable(),
  parentClientKey: z.string().min(1).max(128).nullable(),
  lineSubtotalCents: z.number().int().min(0),
  taxCents: z.number().int().min(0),
  totalCents: z.number().int().min(0),
}).strict();

/** Exact server-priced preview; this schema is presentation data, never input. */
export const quoteDraftCreatePreviewSchema = z.object({
  quoteIntakeSessionId: z.string().min(1),
  proposalFingerprint: proposalFingerprintSchema,
  customerName: z.string().min(1).max(255),
  contactName: z.string().min(1).max(255).nullable(),
  quoteTitle: z.string().min(1).max(255).nullable(),
  lineItems: z.array(quoteLinePreviewSchema).min(1).max(100),
  subtotalCents: z.number().int().min(0),
  taxCents: z.number().int().min(0),
  totalCents: z.number().int().min(0),
  validationErrors: z.array(z.string().min(1).max(1_000)).max(50),
  warnings: z.array(z.string().min(1).max(1_000)).max(50),
  affectedQuoteCount: z.literal(1),
  downstreamActionsExcluded: z.tuple([
    z.literal("order_creation"),
    z.literal("production_job_creation"),
    z.literal("inventory_reservation"),
    z.literal("invoice_creation"),
    z.literal("email_sending"),
    z.literal("quote_acceptance_or_conversion"),
  ]),
}).strict();
export type QuoteDraftCreatePreview = z.infer<typeof quoteDraftCreatePreviewSchema>;

export const quoteDraftCreateCommandResultSchema = z.object({
  quote: z.object({
    id: z.string().min(1),
    displayNumber: z.string().min(1).max(64),
    status: z.literal("draft"),
    totalCents: z.number().int().min(0),
    sourceLink: quoteSourceLinkSchema,
  }).strict(),
  domainAuditReference: z.string().min(1).optional(),
}).strict();
export type QuoteDraftCreateCommandResult = z.infer<typeof quoteDraftCreateCommandResultSchema>;

/** The sole assistant-to-domain write boundary for draft quote creation. */
export interface QuoteDraftCreateCanonicalService {
  createDraft(input: QuoteDraftCreateCommandInput & {
    organizationId: string;
    actorUserId: string;
    assistantPlanId: string;
    idempotencyKey: string;
    correlationId: string;
  }): Promise<QuoteDraftCreateCommandResult>;
}

export function createQuoteDraftCreateCanonicalAdapter(
  service: QuoteDraftCreateCanonicalService,
): AssistantCanonicalCommandAdapter<QuoteDraftCreateCommandInput, QuoteDraftCreateCommandResult> {
  return {
    async execute(input: QuoteDraftCreateCommandInput, context: AssistantCommandExecutionContext) {
      const normalized = quoteDraftCreateCommandInputSchema.parse(input);
      const result = await service.createDraft({
        ...normalized,
        organizationId: context.organizationId,
        actorUserId: context.actorUserId,
        assistantPlanId: context.planId,
        idempotencyKey: context.idempotencyKey,
        correlationId: context.correlationId,
      });
      return quoteDraftCreateCommandResultSchema.parse(result);
    },
  };
}

export function createQuoteDraftCreateCommandDefinition(
  service: QuoteDraftCreateCanonicalService,
): AssistantCommandDefinition<QuoteDraftCreateCommandInput, QuoteDraftCreatePreview, QuoteDraftCreateCommandResult> {
  return {
    name: quoteDraftCreateCommandName,
    version: quoteDraftCreateCommandVersion,
    domain: "quotes",
    mode: "write",
    description: "Create exactly one server-validated draft quote through the canonical quote service.",
    risk: "high",
    requiredCapability: "assistant.quotes.create_draft",
    allowedRoles: ["owner", "admin", "manager", "employee"],
    inputSchema: quoteDraftCreateCommandInputSchema,
    previewSchema: quoteDraftCreatePreviewSchema,
    resultSchema: quoteDraftCreateCommandResultSchema,
    maxAffectedRecords: 1,
    bulkAllowed: false,
    confirmationRequired: true,
    reauthenticationRequired: false,
    confirmationExpiresInMs: quoteDraftCreateConfirmationTtlMs,
    idempotencyPolicy: "server_generated_with_request_hash",
    recordFingerprintStrategy: "stable_field_hash",
    transactionPolicy: "required",
    partialFailurePolicy: "forbid",
    auditCategory: "assistant_quote_draft_create",
    undoSupport: "metadata_only",
    abandonmentPolicy: "session_abandonment_only",
    testOnly: false,
    devEnabled: true,
    mainEnabled: true,
    adapter: createQuoteDraftCreateCanonicalAdapter(service),
  };
}
