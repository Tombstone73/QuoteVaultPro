import { z } from "zod";
import type {
  AssistantCanonicalCommandAdapter,
  AssistantCommandDefinition,
  AssistantCommandExecutionContext,
} from "./commandRegistry";

export const quoteDraftUpdateCommandName = "quotes.update_draft" as const;
export const quoteDraftUpdateCommandVersion = "v1" as const;
export const quoteDraftUpdateConfirmationTtlMs = 5 * 60_000;

const quoteSourceLinkSchema = z.string().regex(/^\/quotes\/[^\s/]+$/);
const fingerprintSchema = z.string().trim().regex(/^[a-f0-9]{64}$/i, "Fingerprint must be a SHA-256 digest.");

/**
 * A proposal reference is the only accepted update payload.  This rules out
 * arbitrary JSON patching, status forcing, client-provided prices/tax, and
 * model-selected workflow operations.
 */
export const quoteDraftUpdateCommandInputSchema = z.object({
  quoteId: z.string().trim().min(1).max(128),
  quoteIntakeSessionId: z.string().trim().min(1).max(128),
  proposalFingerprint: fingerprintSchema,
  expectedQuoteFingerprint: fingerprintSchema,
  proposalId: z.string().trim().min(1).max(128).optional(),
}).strict();
export type QuoteDraftUpdateCommandInput = z.infer<typeof quoteDraftUpdateCommandInputSchema>;

const quoteChangePreviewSchema = z.object({
  field: z.string().min(1).max(160),
  before: z.union([z.string().max(2_000), z.number().finite(), z.boolean(), z.null()]),
  after: z.union([z.string().max(2_000), z.number().finite(), z.boolean(), z.null()]),
}).strict();

export const quoteDraftUpdatePreviewSchema = z.object({
  quote: z.object({
    id: z.string().min(1),
    displayNumber: z.string().min(1).max(64),
    status: z.literal("draft"),
    sourceLink: quoteSourceLinkSchema,
  }).strict(),
  quoteIntakeSessionId: z.string().min(1),
  proposalFingerprint: fingerprintSchema,
  expectedQuoteFingerprint: fingerprintSchema,
  changes: z.array(quoteChangePreviewSchema).min(1).max(200),
  subtotalCentsBefore: z.number().int().min(0),
  subtotalCentsAfter: z.number().int().min(0),
  taxCentsBefore: z.number().int().min(0),
  taxCentsAfter: z.number().int().min(0),
  totalCentsBefore: z.number().int().min(0),
  totalCentsAfter: z.number().int().min(0),
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
export type QuoteDraftUpdatePreview = z.infer<typeof quoteDraftUpdatePreviewSchema>;

export const quoteDraftUpdateCommandResultSchema = z.object({
  quote: z.object({
    id: z.string().min(1),
    displayNumber: z.string().min(1).max(64),
    status: z.literal("draft"),
    totalCents: z.number().int().min(0),
    sourceLink: quoteSourceLinkSchema,
  }).strict(),
  domainAuditReference: z.string().min(1).optional(),
}).strict();
export type QuoteDraftUpdateCommandResult = z.infer<typeof quoteDraftUpdateCommandResultSchema>;

/** Canonical service must reject non-editable, stale, foreign, or repricing-invalid quotes. */
export interface QuoteDraftUpdateCanonicalService {
  updateDraft(input: QuoteDraftUpdateCommandInput & {
    organizationId: string;
    actorUserId: string;
    assistantPlanId: string;
    idempotencyKey: string;
    correlationId: string;
  }): Promise<QuoteDraftUpdateCommandResult>;
}

export function createQuoteDraftUpdateCanonicalAdapter(
  service: QuoteDraftUpdateCanonicalService,
): AssistantCanonicalCommandAdapter<QuoteDraftUpdateCommandInput, QuoteDraftUpdateCommandResult> {
  return {
    async execute(input: QuoteDraftUpdateCommandInput, context: AssistantCommandExecutionContext) {
      const normalized = quoteDraftUpdateCommandInputSchema.parse(input);
      const result = await service.updateDraft({
        ...normalized,
        organizationId: context.organizationId,
        actorUserId: context.actorUserId,
        assistantPlanId: context.planId,
        idempotencyKey: context.idempotencyKey,
        correlationId: context.correlationId,
      });
      return quoteDraftUpdateCommandResultSchema.parse(result);
    },
  };
}

export function createQuoteDraftUpdateCommandDefinition(
  service: QuoteDraftUpdateCanonicalService,
): AssistantCommandDefinition<QuoteDraftUpdateCommandInput, QuoteDraftUpdatePreview, QuoteDraftUpdateCommandResult> {
  return {
    name: quoteDraftUpdateCommandName,
    version: quoteDraftUpdateCommandVersion,
    domain: "quotes",
    mode: "write",
    description: "Apply one server-validated proposal to one canonical editable draft quote.",
    risk: "high",
    requiredCapability: "assistant.quotes.update_draft",
    allowedRoles: ["owner", "admin", "manager", "employee"],
    inputSchema: quoteDraftUpdateCommandInputSchema,
    previewSchema: quoteDraftUpdatePreviewSchema,
    resultSchema: quoteDraftUpdateCommandResultSchema,
    maxAffectedRecords: 1,
    bulkAllowed: false,
    confirmationRequired: true,
    reauthenticationRequired: false,
    confirmationExpiresInMs: quoteDraftUpdateConfirmationTtlMs,
    idempotencyPolicy: "server_generated_with_request_hash",
    recordFingerprintStrategy: "updated_at_and_critical_fields",
    transactionPolicy: "required",
    partialFailurePolicy: "forbid",
    auditCategory: "assistant_quote_draft_update",
    undoSupport: "metadata_only",
    abandonmentPolicy: "none",
    testOnly: false,
    devEnabled: true,
    mainEnabled: true,
    adapter: createQuoteDraftUpdateCanonicalAdapter(service),
  };
}
